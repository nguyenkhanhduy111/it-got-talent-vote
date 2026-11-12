-- Giai điệu tri ân / Music Vote Live - schema SQLite (node:sqlite)
-- Thời gian lưu dạng epoch milliseconds theo đồng hồ MÁY CHỦ.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);

CREATE TABLE teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,         -- mã đội / số báo danh
  name       TEXT NOT NULL,
  perf_title TEXT NOT NULL DEFAULT '',
  genre      TEXT NOT NULL DEFAULT '',
  members    INTEGER NOT NULL DEFAULT 0,
  bio        TEXT NOT NULL DEFAULT '',
  avatar_url TEXT,
  photo_url  TEXT,
  gallery    TEXT NOT NULL DEFAULT '[]',   -- JSON, tối đa 3 ảnh
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  is_sample  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  duration_sec  INTEGER NOT NULL DEFAULT 600,
  opened_at     INTEGER,
  closes_at     INTEGER,
  closed_at     INTEGER,
  hide_last_sec INTEGER NOT NULL DEFAULT 0,  -- giữ kín N giây cuối (0 = không)
  team_ids      TEXT,                        -- JSON mảng id đội; NULL = mọi đội đang tham gia (dùng cho vòng phụ)
  reveal_places INTEGER NOT NULL DEFAULT 4,
  locked_at     INTEGER,
  snapshot      TEXT                         -- JSON ảnh chụp kết quả khi khóa
);

CREATE TABLE attendees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  code_hash      TEXT NOT NULL UNIQUE,       -- HMAC-SHA256(pepper, mã); KHÔNG lưu mã gốc
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  token_ver      INTEGER NOT NULL DEFAULT 1,
  geo_exception  INTEGER NOT NULL DEFAULT 0,
  note           TEXT NOT NULL DEFAULT '',
  is_simulated   INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    INTEGER NOT NULL REFERENCES rounds(id),
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  team_id     INTEGER NOT NULL REFERENCES teams(id),
  idem_key    TEXT NOT NULL,
  receipt     TEXT NOT NULL,
  received_at INTEGER NOT NULL,              -- giờ máy chủ
  geo_result  TEXT NOT NULL,                 -- ok | exception | disabled | simulated (không lưu tọa độ)
  UNIQUE (round_id, attendee_id),            -- MỘT phiếu mỗi người mỗi vòng
  UNIQUE (attendee_id, idem_key)             -- gửi lại cùng mã yêu cầu -> cùng biên nhận
);
CREATE INDEX votes_round_team ON votes (round_id, team_id);

CREATE TABLE display (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  round_id        INTEGER,
  mode            TEXT NOT NULL DEFAULT 'idle',   -- idle|live|hidden|confirming|revealing|final
  reveal_step     INTEGER NOT NULL DEFAULT 0,
  notice          TEXT NOT NULL DEFAULT '',
  emergency       INTEGER NOT NULL DEFAULT 0,
  reduce_fx       INTEGER NOT NULL DEFAULT 0,
  countdown_armed INTEGER NOT NULL DEFAULT 0,
  audio           TEXT NOT NULL DEFAULT '{}',     -- JSON
  cue_seq         INTEGER NOT NULL DEFAULT 0,
  cue_name        TEXT NOT NULL DEFAULT '',
  cue_at          INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1
);
INSERT INTO display (id) VALUES (1);

CREATE TABLE audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     INTEGER NOT NULL,
  actor  TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
