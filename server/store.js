// Lớp nghiệp vụ + truy cập dữ liệu. Mọi thao tác ghi quan trọng nằm trong giao dịch.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, evaluateGeo, rankRows, revealGroups, generateCode, hashCode, normalizeCode, formatCode } from './util.js';

export const SETTING_DEFS = {
  eventName: { t: 's', max: 200, def: 'CHÀO MỪNG NGÀY NHÀ GIÁO VIỆT NAM 20/11' },
  eventTitle: { t: 's', max: 80, def: 'IT GOT TALENT' },
  eventHost: { t: 's', max: 200, def: 'Khoa Công nghệ Thông tin – Trường Đại học Quy Nhơn' },
  eventTagline: { t: 's', max: 120, def: 'Nốt nhạc Tri ân' },
  publicUrl: { t: 's', max: 300, def: '' },
  venueName: { t: 's', max: 120, def: 'Hội trường (CẦN XÁC NHẬN)' },
  venueLat: { t: 'n', min: -90, max: 90, def: 13.7765 },
  venueLng: { t: 'n', min: -180, max: 180, def: 109.2237 },
  venueConfirmed: { t: 'b', def: false },
  radiusM: { t: 'n', min: 50, max: 100000, def: 5000 },
  locationEnabled: { t: 'b', def: true },
  accuracyMaxM: { t: 'n', min: 10, max: 20000, def: 1000 },
  geoMaxAgeSec: { t: 'n', min: 5, max: 600, def: 120 },
  closeMarginVotes: { t: 'n', min: 0, max: 1000, def: 3 },
  rotateSec: { t: 'n', min: 4, max: 60, def: 10 },
  coalesceMs: { t: 'n', min: 0, max: 5000, def: 1000 },
  ledW: { t: 'n', min: 640, max: 7680, def: 1920 },
  ledH: { t: 'n', min: 360, max: 4320, def: 1080 },
  showAnonToast: { t: 'b', def: true },
};

const DEFAULT_AUDIO = { enabled: false, muted: false, master: 0.8, music: 0.45, fx: 0.9, ducked: false, musicOn: true, ownerId: null };
const MODES = ['idle', 'live', 'hidden', 'confirming', 'revealing', 'final'];

const SAMPLE_TEAMS = [
  ['T01', 'Đội Sao Mai', 'Tiếng hát tri ân (mẫu)', 'Hợp xướng', 24],
  ['T02', 'Đội Hướng Dương', 'Người gieo mầm xanh (mẫu)', 'Múa đương đại', 12],
  ['T03', 'Đội Cánh Buồm', 'Bến đỗ tuổi thơ (mẫu)', 'Nhạc cụ dân tộc', 8],
  ['T04', 'Đội Nốt Nhạc Xanh', 'Giai điệu bục giảng (mẫu)', 'Hát solo – song ca', 6],
  ['T05', 'Đội Bình Minh', 'Ánh sáng từ trang vở (mẫu)', 'Rap – Hip-hop', 10],
  ['T06', 'Đội Phù Sa', 'Ơn thầy nghĩa mẹ (mẫu)', 'Kịch hát', 15],
];

export class Store {
  constructor({ config, clock }) {
    this.config = config;
    this.clock = clock;
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
    this.db = new DatabaseSync(config.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.migrate();
    this._settings = null;
    this._cache = null;
    this._timer = null;
    this._sig = null;
    this.version = this.db.prepare('SELECT version FROM display WHERE id=1').get().version;
    this.listeners = new Set();
    this.demoAuto = null;
  }

  // ---------- nền tảng ----------
  migrate() {
    const v = this.db.prepare('PRAGMA user_version').get().user_version;
    if (v < 1) {
      const sql = fs.readFileSync(path.join(this.config.root, 'migrations', '001_init.sql'), 'utf8');
      this.db.exec('BEGIN');
      try { this.db.exec(sql); this.db.exec('PRAGMA user_version = 1'); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
    if (this.db.prepare('PRAGMA user_version').get().user_version < 2) {
      const sql = fs.readFileSync(path.join(this.config.root, 'migrations', '002_registration.sql'), 'utf8');
      this.db.exec('BEGIN');
      try { this.db.exec(sql); this.db.exec('PRAGMA user_version = 2'); this.db.exec('COMMIT'); }
      catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }
  /** Giao dịch ghi (BEGIN IMMEDIATE) - serialize với mọi ghi khác. */
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); this.afterCommit?.(); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* đã rollback */ } throw e; }
  }
  close() { clearTimeout(this._timer); clearInterval(this.demoAuto); try { this.db.close(); } catch { /* */ } }
  audit(actor, action, detail = '') {
    this.db.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?,?,?,?)').run(this.clock.now(), actor, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
    this.afterCommit?.();
  }
  auditList(limit = 200) { return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit); }

  // ---------- phát cập nhật ----------
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  flush() {
    clearTimeout(this._timer); this._timer = null;
    this.version += 1;
    this.db.prepare('UPDATE display SET version=? WHERE id=1').run(this.version);
    this.afterCommit?.();
    this._cache = null;
    for (const fn of this.listeners) { try { fn(); } catch { /* người nghe lỗi không làm hỏng luồng */ } }
  }
  /** Gộp nhiều thay đổi phiếu trong coalesceMs rồi phát một lần (luôn mang trạng thái mới nhất). */
  markDirty() {
    const ms = this.settings().coalesceMs;
    if (ms <= 0) return this.flush();
    if (!this._timer) { this._timer = setTimeout(() => this.flush(), ms); this._timer.unref?.(); }
  }

  // ---------- cài đặt ----------
  settings() {
    if (this._settings) return this._settings;
    const out = {};
    const rows = Object.fromEntries(this.db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
    for (const [k, d] of Object.entries(SETTING_DEFS)) out[k] = k in rows ? JSON.parse(rows[k]) : d.def;
    this._settings = out;
    return out;
  }
  geoConfig() {
    const s = this.settings();
    return { locationEnabled: s.locationEnabled, geoMaxAgeSec: s.geoMaxAgeSec, accuracyMaxM: s.accuracyMaxM, radiusM: s.radiusM, venueLat: s.venueLat, venueLng: s.venueLng };
  }
  effectivePublicUrl() { return (this.settings().publicUrl || this.config.publicUrl).replace(/\/+$/, ''); }
  updateSettings(patch, actor) {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      const d = SETTING_DEFS[k];
      if (!d) continue;
      if (d.t === 's') {
        if (typeof v !== 'string' || v.length > d.max) throw new HttpError(400, 'BAD_SETTING', `Giá trị "${k}" không hợp lệ.`);
        if (k === 'publicUrl' && v && !/^https?:\/\/[^\s/]+/i.test(v)) throw new HttpError(400, 'BAD_SETTING', 'URL công khai phải bắt đầu bằng http:// hoặc https://');
        clean[k] = v.trim();
      } else if (d.t === 'n') {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < d.min || v > d.max) throw new HttpError(400, 'BAD_SETTING', `Giá trị "${k}" phải trong khoảng ${d.min}–${d.max}.`);
        clean[k] = v;
      } else {
        if (typeof v !== 'boolean') throw new HttpError(400, 'BAD_SETTING', `Giá trị "${k}" phải là đúng/sai.`);
        clean[k] = v;
      }
    }
    this.tx(() => {
      const st = this.db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const [k, v] of Object.entries(clean)) st.run(k, JSON.stringify(v));
      this.audit(actor, 'settings.update', Object.keys(clean).join(','));
    });
    this._settings = null;
    this.flush();
    return this.settings();
  }

  // ---------- đội ----------
  teamRow(id) { return this.db.prepare('SELECT * FROM teams WHERE id=?').get(id); }
  listTeams({ activeOnly = false } = {}) {
    return this.db.prepare(`SELECT * FROM teams ${activeOnly ? 'WHERE active=1' : ''} ORDER BY sort_order, id`).all();
  }
  teamPublic(t) {
    const g = JSON.parse(t.gallery || '[]');
    const ph = (k) => `/img/team/${encodeURIComponent(t.code)}.svg?k=${k}&n=${encodeURIComponent(t.name)}`;
    return {
      id: t.id, code: t.code, name: t.name, perfTitle: t.perf_title, genre: t.genre, members: t.members, bio: t.bio,
      avatar: t.avatar_url || ph('avatar'), photo: t.photo_url || t.avatar_url || ph('photo'),
      gallery: g, isSample: !!t.is_sample,
    };
  }
  _teamInput(b, partial = false) {
    const out = {};
    const str = (k, max, req = false) => {
      if (b[k] === undefined) { if (req && !partial) throw new HttpError(400, 'BAD_TEAM', `Thiếu "${k}".`); return; }
      if (typeof b[k] !== 'string' || b[k].length > max || (req && !b[k].trim())) throw new HttpError(400, 'BAD_TEAM', `"${k}" không hợp lệ.`);
      out[k] = b[k].trim();
    };
    str('code', 20, true); str('name', 100, true); str('perfTitle', 150); str('genre', 80); str('bio', 1200);
    if (b.members !== undefined) {
      if (!Number.isInteger(b.members) || b.members < 0 || b.members > 999) throw new HttpError(400, 'BAD_TEAM', 'Số thành viên không hợp lệ.');
      out.members = b.members;
    }
    for (const k of ['avatarUrl', 'photoUrl']) {
      if (b[k] !== undefined) {
        if (b[k] !== null && (typeof b[k] !== 'string' || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(b[k]))) throw new HttpError(400, 'BAD_TEAM', 'Ảnh phải là file đã tải lên.');
        out[k] = b[k];
      }
    }
    if (b.gallery !== undefined) {
      if (!Array.isArray(b.gallery) || b.gallery.length > 3 || b.gallery.some((u) => typeof u !== 'string' || !/^\/uploads\/[A-Za-z0-9._-]+$/.test(u))) throw new HttpError(400, 'BAD_TEAM', 'Thư viện tối đa 3 ảnh đã tải lên.');
      out.gallery = JSON.stringify(b.gallery);
    }
    if (b.active !== undefined) out.active = b.active ? 1 : 0;
    return out;
  }
  hasOpenRound() { return !!this.db.prepare("SELECT 1 FROM rounds WHERE status='open'").get(); }
  createTeam(b, actor) {
    const d = this._teamInput(b);
    const id = this.tx(() => {
      const max = this.db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM teams').get().m;
      try {
        const r = this.db.prepare('INSERT INTO teams (code,name,perf_title,genre,members,bio,avatar_url,photo_url,gallery,sort_order,active,is_sample) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)')
          .run(d.code, d.name, d.perfTitle || '', d.genre || '', d.members || 0, d.bio || '', d.avatarUrl ?? null, d.photoUrl ?? null, d.gallery || '[]', max + 1, d.active ?? 1);
        this.audit(actor, 'team.create', d.code);
        return Number(r.lastInsertRowid);
      } catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'DUP_TEAM', 'Mã đội đã tồn tại.'); throw e; }
    });
    this.flush();
    return this.teamRow(id);
  }
  updateTeam(id, b, actor) {
    const d = this._teamInput(b, true);
    if (!this.teamRow(id)) throw new HttpError(404, 'NO_TEAM', 'Không tìm thấy đội.');
    if (d.active === 0 && this.hasOpenRound()) throw new HttpError(409, 'ROUND_OPEN', 'Không thể ngừng tham gia của đội khi đang có vòng mở.');
    const map = { code: 'code', name: 'name', perfTitle: 'perf_title', genre: 'genre', members: 'members', bio: 'bio', avatarUrl: 'avatar_url', photoUrl: 'photo_url', gallery: 'gallery', active: 'active' };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) if (k in d) { sets.push(`${col}=?`); vals.push(d[k]); }
    if (!sets.length) return this.teamRow(id);
    this.tx(() => {
      try { this.db.prepare(`UPDATE teams SET ${sets.join(',')}, is_sample=0 WHERE id=?`).run(...vals, id); }
      catch (e) { if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'DUP_TEAM', 'Mã đội đã tồn tại.'); throw e; }
      this.audit(actor, 'team.update', `${id}:${Object.keys(d).join(',')}`);
    });
    this.flush();
    return this.teamRow(id);
  }
  deleteTeam(id, actor) {
    if (this.hasOpenRound()) throw new HttpError(409, 'ROUND_OPEN', 'Không thể xóa đội khi đang có vòng mở.');
    this.tx(() => {
      if (this.db.prepare('SELECT 1 FROM votes WHERE team_id=?').get(id)) throw new HttpError(409, 'HAS_VOTES', 'Đội đã có phiếu, chỉ có thể ngừng tham gia, không xóa.');
      this.db.prepare('DELETE FROM teams WHERE id=?').run(id);
      this.audit(actor, 'team.delete', String(id));
    });
    this.flush();
  }
  reorderTeams(ids, actor) {
    if (!Array.isArray(ids) || ids.some((x) => !Number.isInteger(x))) throw new HttpError(400, 'BAD_ORDER', 'Danh sách thứ tự không hợp lệ.');
    this.tx(() => {
      const st = this.db.prepare('UPDATE teams SET sort_order=? WHERE id=?');
      ids.forEach((id, i) => st.run(i + 1, id));
      this.audit(actor, 'team.reorder', ids.join(','));
    });
    this.flush();
  }
  seedSampleTeams() {
    if (this.db.prepare('SELECT COUNT(*) c FROM teams').get().c) return false;
    this.tx(() => {
      const st = this.db.prepare("INSERT INTO teams (code,name,perf_title,genre,members,bio,sort_order,active,is_sample) VALUES (?,?,?,?,?,?,?,1,1)");
      SAMPLE_TEAMS.forEach(([code, name, perf, genre, n], i) => st.run(code, name, perf, genre, n, 'DỮ LIỆU MẪU – thay bằng phần giới thiệu thật của đội trong trang quản trị.', i + 1));
      this.audit('system', 'seed.teams', String(SAMPLE_TEAMS.length));
    });
    return true;
  }

  // ---------- vòng ----------
  roundRow(id) { return this.db.prepare('SELECT * FROM rounds WHERE id=?').get(id); }
  listRounds() { return this.db.prepare('SELECT * FROM rounds ORDER BY id').all(); }
  roundTeamIds(r) {
    const active = this.listTeams({ activeOnly: true }).map((t) => t.id);
    if (!r || !r.team_ids) return active;
    const ids = JSON.parse(r.team_ids);
    return active.filter((id) => ids.includes(id));
  }
  _roundInput(b) {
    const out = {};
    if (b.name !== undefined) { if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 100) throw new HttpError(400, 'BAD_ROUND', 'Tên vòng không hợp lệ.'); out.name = b.name.trim(); }
    const int = (k, min, max, label) => { if (b[k] !== undefined) { if (!Number.isInteger(b[k]) || b[k] < min || b[k] > max) throw new HttpError(400, 'BAD_ROUND', `${label} phải là số nguyên ${min}–${max}.`); out[k] = b[k]; } };
    int('durationSec', 10, 86400, 'Thời lượng'); int('hideLastSec', 0, 600, 'Giữ kín'); int('revealPlaces', 1, 10, 'Số hạng công bố');
    if (b.teamIds !== undefined) {
      if (b.teamIds !== null && (!Array.isArray(b.teamIds) || b.teamIds.some((x) => !Number.isInteger(x)))) throw new HttpError(400, 'BAD_ROUND', 'Danh sách đội không hợp lệ.');
      out.teamIds = b.teamIds === null ? null : JSON.stringify(b.teamIds);
    }
    return out;
  }
  createRound(b, actor) {
    const d = this._roundInput({ name: 'Vòng mới', ...b });
    const id = this.tx(() => {
      const r = this.db.prepare('INSERT INTO rounds (name,duration_sec,hide_last_sec,team_ids,reveal_places) VALUES (?,?,?,?,?)')
        .run(d.name, d.durationSec ?? 600, d.hideLastSec ?? 0, d.teamIds ?? null, d.revealPlaces ?? 4);
      this.audit(actor, 'round.create', d.name);
      return Number(r.lastInsertRowid);
    });
    this.flush();
    return this.roundRow(id);
  }
  updateRound(id, b, actor) {
    const r = this.roundRow(id);
    if (!r) throw new HttpError(404, 'NO_ROUND', 'Không tìm thấy vòng.');
    const d = this._roundInput(b);
    if (r.status !== 'draft') { for (const k of ['durationSec', 'teamIds']) if (k in d) throw new HttpError(409, 'ROUND_LOCKED', 'Chỉ sửa được thời lượng và danh sách đội khi vòng còn ở trạng thái nháp.'); }
    const map = { name: 'name', durationSec: 'duration_sec', hideLastSec: 'hide_last_sec', revealPlaces: 'reveal_places', teamIds: 'team_ids' };
    const sets = []; const vals = [];
    for (const [k, col] of Object.entries(map)) if (k in d) { sets.push(`${col}=?`); vals.push(d[k]); }
    if (sets.length) {
      this.tx(() => { this.db.prepare(`UPDATE rounds SET ${sets.join(',')} WHERE id=?`).run(...vals, id); this.audit(actor, 'round.update', `${id}:${Object.keys(d).join(',')}`); });
      this.flush();
    }
    return this.roundRow(id);
  }
  deleteRound(id, actor) {
    this.tx(() => {
      const r = this.roundRow(id);
      if (!r) throw new HttpError(404, 'NO_ROUND', 'Không tìm thấy vòng.');
      if (r.status !== 'draft') throw new HttpError(409, 'ROUND_LOCKED', 'Chỉ xóa được vòng nháp.');
      this.db.prepare('DELETE FROM rounds WHERE id=?').run(id);
      this.db.prepare('UPDATE display SET round_id=NULL WHERE round_id=?').run(id);
      this.audit(actor, 'round.delete', String(id));
    });
    this.flush();
  }
  getDisplay() {
    const d = this.db.prepare('SELECT * FROM display WHERE id=1').get();
    d.audioObj = { ...DEFAULT_AUDIO, ...JSON.parse(d.audio || '{}') };
    return d;
  }
  currentRound() { const d = this.getDisplay(); return d.round_id ? this.roundRow(d.round_id) : null; }
  _emitCue(name) {
    this.db.prepare('UPDATE display SET cue_seq=cue_seq+1, cue_name=?, cue_at=? WHERE id=1').run(name, this.clock.now());
  }

  openRound(id, actor, { durationSec } = {}) {
    this.tx(() => {
      const r = this.roundRow(id);
      if (!r) throw new HttpError(404, 'NO_ROUND', 'Không tìm thấy vòng.');
      if (r.status !== 'draft') throw new HttpError(409, 'ROUND_STATE', 'Chỉ mở được vòng ở trạng thái nháp.');
      if (this.hasOpenRound()) throw new HttpError(409, 'ROUND_OPEN', 'Đang có vòng khác mở.');
      if (this.roundTeamIds(r).length < 2) throw new HttpError(409, 'FEW_TEAMS', 'Cần ít nhất 2 đội tham gia để mở vòng.');
      const now = this.clock.now();
      const dur = durationSec ?? r.duration_sec;
      if (!Number.isInteger(dur) || dur < 10) throw new HttpError(400, 'BAD_ROUND', 'Thời lượng không hợp lệ.');
      this.db.prepare("UPDATE rounds SET status='open', opened_at=?, closes_at=?, closed_at=NULL, locked_at=NULL, snapshot=NULL WHERE id=?").run(now, now + dur * 1000, id);
      this.db.prepare("UPDATE display SET round_id=?, mode='live', reveal_step=0 WHERE id=1").run(id);
      this._emitCue('open');
      this.audit(actor, 'round.open', `${id} dur=${dur}s`);
    });
    this.flush();
  }
  extendRound(id, sec, actor, reason = '') {
    if (!Number.isInteger(sec) || sec < 10 || sec > 3600) throw new HttpError(400, 'BAD_EXTEND', 'Gia hạn 10–3600 giây.');
    this.tx(() => {
      const r = this.roundRow(id);
      if (!r || r.status !== 'open') throw new HttpError(409, 'ROUND_STATE', 'Chỉ gia hạn được vòng đang mở.');
      if (this.clock.now() >= r.closes_at) throw new HttpError(409, 'ROUND_CLOSED', 'Vòng đã hết giờ.');
      this.db.prepare('UPDATE rounds SET closes_at=closes_at+? WHERE id=?').run(sec * 1000, id);
      this.audit(actor, 'round.extend', `${id} +${sec}s ${reason}`);
    });
    this.flush();
  }
  closeRound(id, actor, { auto = false } = {}) {
    this.tx(() => {
      const r = this.roundRow(id);
      if (!r || r.status !== 'open') throw new HttpError(409, 'ROUND_STATE', 'Vòng không ở trạng thái mở.');
      const now = this.clock.now();
      this.db.prepare("UPDATE rounds SET status='closed', closed_at=?, closes_at=MIN(closes_at, ?) WHERE id=?").run(now, now, id);
      this.db.prepare("UPDATE display SET mode='confirming', reveal_step=0 WHERE id=1 AND round_id=?").run(id);
      this._emitCue('close');
      this.audit(actor, auto ? 'round.autoclose' : 'round.close', String(id));
    });
    this.flush();
  }
  /** Khóa kết quả: đối soát tổng phiếu, lưu ảnh chụp. */
  lockRound(id, actor) {
    const snap = this.tx(() => {
      const r = this.roundRow(id);
      if (!r || r.status !== 'closed') throw new HttpError(409, 'ROUND_STATE', 'Chỉ khóa được vòng đã đóng.');
      if (r.locked_at) throw new HttpError(409, 'ALREADY_LOCKED', 'Kết quả đã được khóa.');
      const counts = this.countsFor(id);
      const teamIds = this.roundTeamIds(r);
      const all = this.db.prepare('SELECT team_id FROM votes WHERE round_id=?').all(id);
      const rows = teamIds.map((tid) => ({ teamId: tid, votes: counts.get(tid) || 0, sortOrder: this.teamRow(tid).sort_order }));
      const total = rows.reduce((s, x) => s + x.votes, 0);
      if (total !== all.length) throw new HttpError(500, 'RECONCILE_FAIL', `Đối soát lệch: tổng theo đội ${total} ≠ số phiếu ${all.length}.`);
      const ranked = rankRows(rows);
      const snapshot = { total, rows: ranked, lockedAt: this.clock.now() };
      this.db.prepare('UPDATE rounds SET locked_at=?, snapshot=? WHERE id=?').run(snapshot.lockedAt, JSON.stringify(snapshot), id);
      this.audit(actor, 'round.lock', `${id} total=${total}`);
      return snapshot;
    });
    this.flush();
    return snap;
  }
  unlockRound(id, actor, reason) {
    if (typeof reason !== 'string' || reason.trim().length < 5) throw new HttpError(400, 'REASON_REQUIRED', 'Cần ghi rõ lý do (ít nhất 5 ký tự).');
    this.tx(() => {
      const r = this.roundRow(id);
      if (!r || !r.locked_at) throw new HttpError(409, 'ROUND_STATE', 'Vòng chưa khóa.');
      this.db.prepare('UPDATE rounds SET locked_at=NULL, snapshot=NULL WHERE id=?').run(id);
      this.db.prepare("UPDATE display SET mode='confirming', reveal_step=0 WHERE id=1 AND round_id=?").run(id);
      this.audit(actor, 'round.unlock', `${id}: ${reason.trim()}`);
    });
    this.flush();
  }
  /** Danh sách bước công bố của vòng đã khóa. */
  revealPlan(r) {
    if (!r?.snapshot) return [];
    const snap = JSON.parse(r.snapshot);
    return revealGroups(snap.rows, r.reveal_places);
  }
  revealNext(actor) {
    let info;
    this.tx(() => {
      const d = this.getDisplay();
      const r = d.round_id ? this.roundRow(d.round_id) : null;
      if (!r || !r.locked_at) throw new HttpError(409, 'NOT_LOCKED', 'Cần khóa kết quả trước khi công bố.');
      const snap = JSON.parse(r.snapshot);
      if (snap.total === 0) throw new HttpError(409, 'NO_VOTES', 'Vòng chưa có phiếu nào để công bố.');
      const plan = this.revealPlan(r);
      if (d.reveal_step >= plan.length) throw new HttpError(409, 'REVEAL_DONE', 'Đã công bố hết các hạng.');
      const g = plan[d.reveal_step];
      this.db.prepare("UPDATE display SET mode='revealing', reveal_step=reveal_step+1 WHERE id=1").run();
      this._emitCue(`place${Math.min(g.rank, 4)}`);
      this.audit(actor, 'reveal.next', `rank ${g.rank} teams ${g.teamIds.join(',')}`);
      info = { step: d.reveal_step + 1, total: plan.length, rank: g.rank };
    });
    this.flush();
    return info;
  }
  revealPrev(actor) {
    this.tx(() => {
      const d = this.getDisplay();
      if (d.mode !== 'revealing' && d.mode !== 'final') throw new HttpError(409, 'NOT_REVEALING', 'Chưa ở chế độ công bố.');
      const step = Math.max(0, d.reveal_step - 1);
      this.db.prepare("UPDATE display SET mode=?, reveal_step=? WHERE id=1").run(step === 0 ? 'confirming' : 'revealing', step);
      this.audit(actor, 'reveal.prev', String(step));
    });
    this.flush();
  }
  showFinal(actor) {
    this.tx(() => {
      const d = this.getDisplay();
      const r = d.round_id ? this.roundRow(d.round_id) : null;
      if (!r?.locked_at) throw new HttpError(409, 'NOT_LOCKED', 'Cần khóa kết quả trước.');
      if (d.reveal_step < this.revealPlan(r).length) throw new HttpError(409, 'REVEAL_PENDING', 'Hãy công bố hết các hạng trước khi tổng kết.');
      this.db.prepare("UPDATE display SET mode='final' WHERE id=1").run();
      this.audit(actor, 'display.final', String(r.id));
    });
    this.flush();
  }
  setMode(mode, actor) {
    if (!MODES.includes(mode)) throw new HttpError(400, 'BAD_MODE', 'Chế độ không hợp lệ.');
    this.tx(() => {
      const d = this.getDisplay();
      const r = d.round_id ? this.roundRow(d.round_id) : null;
      const open = r && r.status === 'open';
      if (mode === 'live' && !open) throw new HttpError(409, 'NO_OPEN_ROUND', 'Chỉ hiện bảng trực tiếp khi vòng đang mở.');
      if (mode === 'hidden' && !open) throw new HttpError(409, 'NO_OPEN_ROUND', 'Chỉ giữ kín khi vòng đang mở.');
      if (mode === 'idle' && open) throw new HttpError(409, 'ROUND_OPEN', 'Vòng đang mở. Hãy dùng "Giữ kín kết quả" nếu muốn ẩn bảng hạng.');
      if (['confirming', 'revealing', 'final'].includes(mode)) throw new HttpError(409, 'USE_FLOW', 'Dùng các nút Đóng vòng / Khóa / Công bố / Tổng kết.');
      this.db.prepare('UPDATE display SET mode=? WHERE id=1').run(mode);
      this.audit(actor, 'display.mode', mode);
    });
    this.flush();
  }
  setDisplayFlags(patch, actor) {
    const sets = []; const vals = [];
    if (patch.notice !== undefined) { if (typeof patch.notice !== 'string' || patch.notice.length > 200) throw new HttpError(400, 'BAD_NOTICE', 'Thông báo tối đa 200 ký tự.'); sets.push('notice=?'); vals.push(patch.notice.trim()); }
    if (patch.emergency !== undefined) { sets.push('emergency=?'); vals.push(patch.emergency ? 1 : 0); }
    if (patch.reduceFx !== undefined) { sets.push('reduce_fx=?'); vals.push(patch.reduceFx ? 1 : 0); }
    if (patch.countdownArmed !== undefined) { sets.push('countdown_armed=?'); vals.push(patch.countdownArmed ? 1 : 0); }
    if (!sets.length) return;
    this.tx(() => { this.db.prepare(`UPDATE display SET ${sets.join(',')} WHERE id=1`).run(...vals); this.audit(actor, 'display.flags', JSON.stringify(patch)); });
    this.flush();
  }
  setAudio(patch, actor) {
    const cur = this.getDisplay().audioObj;
    const next = { ...cur };
    for (const k of ['enabled', 'muted', 'ducked', 'musicOn']) if (patch[k] !== undefined) next[k] = !!patch[k];
    for (const k of ['master', 'music', 'fx']) if (patch[k] !== undefined) { if (typeof patch[k] !== 'number' || patch[k] < 0 || patch[k] > 1) throw new HttpError(400, 'BAD_AUDIO', 'Âm lượng 0–1.'); next[k] = patch[k]; }
    if (patch.ownerId !== undefined) next.ownerId = patch.ownerId === null ? null : String(patch.ownerId).slice(0, 64);
    this.db.prepare('UPDATE display SET audio=? WHERE id=1').run(JSON.stringify(next));
    if (actor) this.audit(actor, 'audio.update', JSON.stringify(patch));
    this.flush();
  }
  playCue(name, actor) {
    const ok = ['open', 'close', 'leader', 'whoosh', 'place4', 'place3', 'place2', 'place1', 'test', 'stop'];
    if (!ok.includes(name)) throw new HttpError(400, 'BAD_CUE', 'Cue không hợp lệ.');
    this.tx(() => { this._emitCue(name); this.audit(actor, 'audio.cue', name); });
    this.flush();
  }

  // ---------- người tham dự ----------
  createAttendees(names, actor, { simulated = false } = {}) {
    if (!Array.isArray(names) || !names.length) throw new HttpError(400, 'NO_NAMES', 'Chưa có tên người tham dự.');
    if (names.length > 5000) throw new HttpError(400, 'TOO_MANY', 'Tối đa 5000 người mỗi lần.');
    const out = [];
    this.tx(() => {
      const st = this.db.prepare('INSERT INTO attendees (name, code_hash, is_simulated, created_at) VALUES (?,?,?,?)');
      for (const raw of names) {
        const name = String(raw ?? '').trim().slice(0, 100);
        if (!name) continue;
        for (let tries = 0; tries < 5; tries++) {
          const code = generateCode(10);
          try {
            const r = st.run(name, hashCode(this.config.codePepper, code), simulated ? 1 : 0, this.clock.now());
            out.push({ id: Number(r.lastInsertRowid), name, code: formatCode(code) });
            break;
          } catch (e) { if (!/UNIQUE/.test(e.message) || tries === 4) throw e; }
        }
      }
      this.audit(actor, 'attendee.create', `${out.length}`);
    });
    return out;
  }
  createAttendeeWithCode(name, code, actor) {
    const r = this.db.prepare('INSERT INTO attendees (name, code_hash, created_at) VALUES (?,?,?)').run(name, hashCode(this.config.codePepper, code), this.clock.now());
    this.audit(actor, 'attendee.create', '1 (mã cố định)');
    return Number(r.lastInsertRowid);
  }
  findAttendeeByCode(code) {
    if (normalizeCode(code).length < 6) return null;
    return this.db.prepare('SELECT * FROM attendees WHERE code_hash=?').get(hashCode(this.config.codePepper, code)) || null;
  }
  // ---------- đăng ký tự khai (họ tên + MSSV + SĐT + Gmail) ----------
  /** Bước 1: kiểm tra trùng, tạo mã 6 số chờ xác nhận. Trả về mã (để gửi email). */
  startRegistration(info) {
    return this.tx(() => {
      const now = this.clock.now();
      const rows = this.db.prepare('SELECT * FROM attendees WHERE mssv=? OR phone=? OR email_norm=?').all(info.mssv, info.phone, info.emailNorm);
      const ids = new Set(rows.map((r) => r.id));
      if (ids.size > 1 || (ids.size === 1 && !(rows[0].mssv === info.mssv && rows[0].phone === info.phone && rows[0].email_norm === info.emailNorm))) {
        throw new HttpError(409, 'DUPLICATE', 'MSSV, số điện thoại hoặc Gmail này đã được dùng để đăng ký. Mỗi người chỉ được bình chọn một lần. Nếu bạn nghĩ đây là nhầm lẫn, hãy đến bàn hỗ trợ.');
      }
      if (rows[0] && rows[0].status !== 'active') throw new HttpError(403, 'REVOKED', 'Tài khoản này không được phép bình chọn. Hãy đến bàn hỗ trợ.');
      const old = this.db.prepare('SELECT sent_at FROM reg_pending WHERE email_norm=?').get(info.emailNorm);
      if (old && now - old.sent_at < 60000) throw new HttpError(429, 'TOO_SOON', `Vui lòng chờ ${Math.ceil((60000 - (now - old.sent_at)) / 1000)} giây rồi bấm gửi lại mã.`);
      const code = String(crypto.randomInt(100000, 1000000));
      this.db.prepare(`INSERT INTO reg_pending (email_norm,name,mssv,phone,email,code_hash,expires_at,attempts,sent_at) VALUES (?,?,?,?,?,?,?,0,?)
        ON CONFLICT(email_norm) DO UPDATE SET name=excluded.name, mssv=excluded.mssv, phone=excluded.phone, email=excluded.email, code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at`)
        .run(info.emailNorm, info.name, info.mssv, info.phone, info.email, hashCode(this.config.codePepper, code), now + 10 * 60000, now);
      return code;
    });
  }
  cancelRegistration(emailNorm) { this.db.prepare('DELETE FROM reg_pending WHERE email_norm=?').run(emailNorm); this.markDirty(); }
  /** Bước 2: kiểm tra mã 6 số, tạo (hoặc lấy lại) người tham dự. */
  completeRegistration(emailNorm, code) {
    const res = this.tx(() => {
      const now = this.clock.now();
      const p = this.db.prepare('SELECT * FROM reg_pending WHERE email_norm=?').get(emailNorm);
      if (!p || p.expires_at < now) return { err: ['CODE_EXPIRED', 400, 'Mã đã hết hạn hoặc chưa được gửi. Hãy bấm gửi lại mã.'] };
      if (p.attempts >= 5) { this.db.prepare('DELETE FROM reg_pending WHERE email_norm=?').run(emailNorm); return { err: ['TOO_MANY', 429, 'Nhập sai quá nhiều lần. Hãy bấm gửi lại mã mới.'] }; }
      if (hashCode(this.config.codePepper, String(code ?? '')) !== p.code_hash) {
        this.db.prepare('UPDATE reg_pending SET attempts=attempts+1 WHERE email_norm=?').run(emailNorm);
        return { err: ['BAD_CODE', 401, 'Mã không đúng. Hãy kiểm tra lại.'] };
      }
      let a = this.db.prepare('SELECT * FROM attendees WHERE mssv=? AND phone=? AND email_norm=?').get(p.mssv, p.phone, p.email_norm);
      if (!a) {
        try {
          const r = this.db.prepare('INSERT INTO attendees (name, code_hash, mssv, phone, email, email_norm, created_at) VALUES (?,?,?,?,?,?,?)')
            .run(p.name, hashCode(this.config.codePepper, generateCode(16)), p.mssv, p.phone, p.email, p.email_norm, now);
          a = this.attendeeRow(Number(r.lastInsertRowid));
          this.audit('khán giả', 'attendee.register', p.mssv);
        } catch (e) {
          if (/UNIQUE/.test(e.message)) { this.db.prepare('DELETE FROM reg_pending WHERE email_norm=?').run(emailNorm); return { err: ['DUPLICATE', 409, 'MSSV, số điện thoại hoặc Gmail này đã được dùng để đăng ký.'] }; }
          throw e;
        }
      } else if (a.status !== 'active') return { err: ['REVOKED', 403, 'Tài khoản này không được phép bình chọn. Hãy đến bàn hỗ trợ.'] };
      this.db.prepare('DELETE FROM reg_pending WHERE email_norm=?').run(emailNorm);
      return { a };
    });
    if (res.err) throw new HttpError(res.err[1], res.err[0], res.err[2]);
    this.markDirty();
    return res.a;
  }
  attendeeRow(id) { return this.db.prepare('SELECT * FROM attendees WHERE id=?').get(id); }
  listAttendees(roundId) {
    return this.db.prepare(`SELECT a.id, a.name, a.mssv, a.phone, a.email, a.status, a.geo_exception AS geoException, a.note, a.is_simulated AS simulated, a.created_at AS createdAt,
        (SELECT 1 FROM votes v WHERE v.attendee_id=a.id AND v.round_id=?) AS voted FROM attendees a ORDER BY a.id`).all(roundId ?? -1)
      .map((a) => ({ ...a, voted: !!a.voted, geoException: !!a.geoException, simulated: !!a.simulated }));
  }
  setAttendeeStatus(id, status, actor) {
    if (!['active', 'revoked'].includes(status)) throw new HttpError(400, 'BAD_STATUS', 'Trạng thái không hợp lệ.');
    this.tx(() => {
      const r = this.db.prepare('UPDATE attendees SET status=?, token_ver=token_ver+1 WHERE id=?').run(status, id);
      if (!r.changes) throw new HttpError(404, 'NO_ATTENDEE', 'Không tìm thấy người tham dự.');
      this.audit(actor, `attendee.${status}`, String(id));
    });
  }
  regenCode(id, actor) {
    return this.tx(() => {
      const a = this.attendeeRow(id);
      if (!a) throw new HttpError(404, 'NO_ATTENDEE', 'Không tìm thấy người tham dự.');
      const code = generateCode(10);
      this.db.prepare("UPDATE attendees SET code_hash=?, token_ver=token_ver+1, status='active' WHERE id=?").run(hashCode(this.config.codePepper, code), id);
      this.audit(actor, 'attendee.regen', String(id));
      return { id, name: a.name, code: formatCode(code) };
    });
  }
  setGeoException(id, on, reason, actor) {
    if (on && (typeof reason !== 'string' || reason.trim().length < 5)) throw new HttpError(400, 'REASON_REQUIRED', 'Cần ghi lý do kiểm tra trực tiếp (ít nhất 5 ký tự).');
    this.tx(() => {
      const r = this.db.prepare('UPDATE attendees SET geo_exception=?, note=? WHERE id=?').run(on ? 1 : 0, on ? reason.trim().slice(0, 200) : '', id);
      if (!r.changes) throw new HttpError(404, 'NO_ATTENDEE', 'Không tìm thấy người tham dự.');
      this.audit(actor, on ? 'attendee.geo_exception.on' : 'attendee.geo_exception.off', `${id}: ${reason || ''}`);
    });
  }

  // ---------- bình chọn ----------
  countsFor(roundId) {
    const m = new Map();
    for (const r of this.db.prepare('SELECT team_id, COUNT(*) c FROM votes WHERE round_id=? GROUP BY team_id').all(roundId)) m.set(r.team_id, r.c);
    return m;
  }
  /**
   * Ghi một phiếu - nguyên tử, idempotent, không tin dữ liệu thời gian/tổng phiếu từ client.
   */
  castVote({ attendeeId, teamId, idemKey, roundId, geo, simulated = false }) {
    if (typeof idemKey !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(idemKey)) throw new HttpError(400, 'BAD_IDEM', 'Mã yêu cầu không hợp lệ.');
    if (!Number.isInteger(teamId)) throw new HttpError(400, 'BAD_TEAM', 'Đội không hợp lệ.');
    const result = this.tx(() => {
      const now = this.clock.now();
      const att = this.attendeeRow(attendeeId);
      if (!att || att.status !== 'active') throw new HttpError(401, 'UNAUTHORIZED', 'Mã tham dự không còn hiệu lực.');
      const round = this.currentRound();
      if (!round) throw new HttpError(409, 'NO_ROUND', 'Chưa có vòng bình chọn nào.');
      if (roundId !== undefined && roundId !== null && roundId !== round.id) throw new HttpError(409, 'ROUND_CHANGED', 'Vòng bình chọn đã thay đổi. Hãy tải lại trang.');
      const mk = (v, duplicate) => ({ receipt: v.receipt, teamId: v.team_id, teamName: this.teamRow(v.team_id)?.name || '', receivedAt: v.received_at, roundId: round.id, duplicate });
      const existing = this.db.prepare('SELECT * FROM votes WHERE round_id=? AND attendee_id=?').get(round.id, attendeeId);
      if (existing) {
        if (existing.idem_key === idemKey) return { ...mk(existing, true), status: 200 };
        throw new HttpError(409, 'ALREADY_VOTED', 'Bạn đã bình chọn trong vòng này.', { receipt: mk(existing, true) });
      }
      if (round.status === 'draft') throw new HttpError(409, 'NOT_OPEN', 'Vòng bình chọn chưa mở.');
      if (round.status !== 'open' || now >= round.closes_at) throw new HttpError(409, 'ROUND_CLOSED', 'Vòng bình chọn đã kết thúc.');
      const allowed = this.roundTeamIds(round);
      if (!allowed.includes(teamId)) throw new HttpError(400, 'BAD_TEAM', 'Đội này không có trong vòng bình chọn.');
      const g = simulated ? { ok: true, result: 'simulated' } : evaluateGeo(this.geoConfig(), geo, { exception: !!att.geo_exception });
      if (!g.ok) throw new HttpError(403, g.code, g.message);
      const receipt = crypto.randomBytes(6).toString('hex').toUpperCase();
      this.db.prepare('INSERT INTO votes (round_id, attendee_id, team_id, idem_key, receipt, received_at, geo_result) VALUES (?,?,?,?,?,?,?)')
        .run(round.id, attendeeId, teamId, idemKey, receipt, now, g.result);
      return { receipt, teamId, teamName: this.teamRow(teamId).name, receivedAt: now, roundId: round.id, duplicate: false, status: 201 };
    });
    if (!result.duplicate) this.markDirty();
    return result;
  }
  /** Vòng hiện tại cho điện thoại + phiếu của chính người dùng. */
  myVote(attendeeId) {
    const round = this.currentRound();
    if (!round) return null;
    const v = this.db.prepare('SELECT * FROM votes WHERE round_id=? AND attendee_id=?').get(round.id, attendeeId);
    return v ? { receipt: v.receipt, teamId: v.team_id, teamName: this.teamRow(v.team_id)?.name || '', receivedAt: v.received_at } : null;
  }

  // ---------- trạng thái công khai ----------
  effectiveStatus(r, now) { return r && r.status === 'open' && now >= r.closes_at ? 'closed' : r?.status; }
  effectiveMode(d, r, now) {
    if (d.emergency) return 'emergency';
    if (r && r.status === 'open' && d.mode === 'live') {
      if (now >= r.closes_at) return 'confirming';
      if (r.hide_last_sec > 0 && now >= r.closes_at - r.hide_last_sec * 1000) return 'hidden';
    }
    return d.mode;
  }
  _signature() {
    const now = this.clock.now();
    const d = this.getDisplay();
    const r = d.round_id ? this.roundRow(d.round_id) : null;
    return `${this.effectiveMode(d, r, now)}|${this.effectiveStatus(r, now)}`;
  }
  /** Gọi định kỳ: tự đóng vòng khi hết giờ máy chủ, và phát khi chuyển pha theo thời gian (giữ kín...). */
  tick() {
    const now = this.clock.now();
    const d = this.getDisplay();
    const r = d.round_id ? this.roundRow(d.round_id) : null;
    if (r && r.status === 'open' && now >= r.closes_at) { this.closeRound(r.id, 'system', { auto: true }); this._sig = this._signature(); return; }
    const sig = this._signature();
    if (this._sig !== null && sig !== this._sig) this.flush();
    this._sig = sig;
  }

  publicState() {
    if (!this._cache) this._cache = this._buildPublic();
    return { ...this._cache, serverNow: this.clock.now() };
  }
  _buildPublic() {
    const now = this.clock.now();
    const s = this.settings();
    const d = this.getDisplay();
    const r = d.round_id ? this.roundRow(d.round_id) : null;
    const mode = this.effectiveMode(d, r, now);
    const teamIds = this.roundTeamIds(r);
    const teams = this.listTeams({ activeOnly: true }).filter((t) => teamIds.includes(t.id)).map((t) => this.teamPublic(t));
    const sortOf = Object.fromEntries(this.listTeams().map((t) => [t.id, t.sort_order]));
    let results = null;
    let revealed = [];
    let plan = [];
    if (r) {
      if (mode === 'live') {
        const counts = this.countsFor(r.id);
        const rows = rankRows(teamIds.map((id) => ({ teamId: id, votes: counts.get(id) || 0, sortOrder: sortOf[id] })));
        results = { total: rows.reduce((a, x) => a + x.votes, 0), rows };
      } else if ((mode === 'final' || mode === 'revealing') && r.snapshot) {
        const snap = JSON.parse(r.snapshot);
        plan = revealGroups(snap.rows, r.reveal_places);
        if (mode === 'final') results = { total: snap.total, rows: snap.rows };
        else {
          const shown = plan.slice(0, d.reveal_step);
          revealed = shown.map((g) => ({ rank: g.rank, votes: g.votes, tie: g.teamIds.length > 1, teamIds: g.teamIds }));
        }
      }
    }
    return {
      version: this.version,
      demo: this.config.demo,
      event: { name: s.eventName, title: s.eventTitle, tagline: s.eventTagline, host: s.eventHost, voteUrl: `${this.effectivePublicUrl()}/vote`, siteUrl: this.effectivePublicUrl() },
      settings: { locationEnabled: s.locationEnabled, accuracyMaxM: s.accuracyMaxM, closeMarginVotes: s.closeMarginVotes, rotateSec: s.rotateSec, ledW: s.ledW, ledH: s.ledH, showAnonToast: s.showAnonToast },
      round: r ? { id: r.id, name: r.name, status: this.effectiveStatus(r, now), closesAt: r.closes_at, hideLastSec: r.hide_last_sec, locked: !!r.locked_at } : null,
      display: { mode, reveal: { step: d.reveal_step, total: plan.length }, notice: d.notice, reduceFx: !!d.reduce_fx, countdownArmed: !!d.countdown_armed },
      audio: d.audioObj,
      cue: { seq: d.cue_seq, name: d.cue_name, at: d.cue_at },
      teams, results, revealed,
    };
  }

  // ---------- quản trị ----------
  adminOverview() {
    const now = this.clock.now();
    const d = this.getDisplay();
    const r = d.round_id ? this.roundRow(d.round_id) : null;
    const teamIds = this.roundTeamIds(r);
    const counts = r ? this.countsFor(r.id) : new Map();
    const sortOf = Object.fromEntries(this.listTeams().map((t) => [t.id, t.sort_order]));
    const rows = rankRows(teamIds.map((id) => ({ teamId: id, votes: counts.get(id) || 0, sortOrder: sortOf[id] })));
    const att = this.db.prepare("SELECT COUNT(*) total, SUM(status='active') active, SUM(is_simulated) sim FROM attendees").get();
    const votes = r ? this.db.prepare('SELECT COUNT(*) c FROM votes WHERE round_id=?').get(r.id).c : 0;
    const plan = this.revealPlan(r);
    const s = this.settings();
    const warnings = [];
    if (!s.venueConfirmed) warnings.push('Tọa độ hội trường chưa được xác nhận (đang là giá trị mẫu). Vào Cài đặt để nhập tọa độ thật và tích "đã xác nhận".');
    if (!/^https:/.test(this.effectivePublicUrl()) && !this.config.demo && !/localhost|127\./.test(this.effectivePublicUrl())) warnings.push('URL công khai chưa dùng HTTPS: điện thoại sẽ không cho phép chia sẻ vị trí.');
    if (this.config.generatedAdminPassword) warnings.push('Đang dùng mật khẩu quản trị tự sinh. Hãy đặt ADMIN_PASSWORD trong biến môi trường.');
    if (!this.config.operatorPassword) warnings.push('Chưa đặt OPERATOR_PASSWORD: tài khoản vận hành sân khấu (quyền hạn chế) đang tắt.');
    return {
      serverNow: now, demo: this.config.demo, version: this.version,
      round: r ? { ...this.roundJson(r), effectiveStatus: this.effectiveStatus(r, now) } : null,
      display: { mode: this.effectiveMode(d, r, now), rawMode: d.mode, revealStep: d.reveal_step, revealTotal: plan.length, notice: d.notice, emergency: !!d.emergency, reduceFx: !!d.reduce_fx, countdownArmed: !!d.countdown_armed },
      audio: d.audioObj,
      realCounts: rows.map((x) => ({ ...x, team: this.teamPublic(this.teamRow(x.teamId)) })),
      totals: { votes, attendees: att.total, active: att.active || 0, simulated: att.sim || 0 },
      nextReveal: plan[d.reveal_step] ? { ...plan[d.reveal_step], teams: plan[d.reveal_step].teamIds.map((id) => this.teamPublic(this.teamRow(id))) } : null,
      warnings,
    };
  }
  roundJson(r) {
    return { id: r.id, name: r.name, status: r.status, durationSec: r.duration_sec, openedAt: r.opened_at, closesAt: r.closes_at, closedAt: r.closed_at, hideLastSec: r.hide_last_sec, teamIds: r.team_ids ? JSON.parse(r.team_ids) : null, revealPlaces: r.reveal_places, locked: !!r.locked_at, lockedAt: r.locked_at };
  }
  resultsCsvRows(roundId) {
    const r = this.roundRow(roundId);
    if (!r) throw new HttpError(404, 'NO_ROUND', 'Không tìm thấy vòng.');
    const counts = this.countsFor(roundId);
    const sortOf = Object.fromEntries(this.listTeams().map((t) => [t.id, t.sort_order]));
    const rows = rankRows(this.roundTeamIds(r).map((id) => ({ teamId: id, votes: counts.get(id) || 0, sortOrder: sortOf[id] })));
    return [['Hạng', 'Mã đội', 'Tên đội', 'Tiết mục', 'Số phiếu hợp lệ', 'Đồng hạng'], ...rows.map((x) => { const t = this.teamRow(x.teamId); return [x.rank, t.code, t.name, t.perf_title, x.votes, x.tie ? 'Có' : 'Không']; })];
  }

  // ---------- demo (chỉ chạy khi DEMO_MODE) ----------
  seedDemo() {
    if (!this.config.demo) throw new HttpError(403, 'NOT_DEMO', 'Chỉ dùng được ở chế độ demo.');
    if (!this.db.prepare('SELECT COUNT(*) c FROM rounds').get().c) {
      this.tx(() => {
        this.db.prepare('INSERT INTO rounds (name,duration_sec,hide_last_sec,reveal_places) VALUES (?,?,?,?)').run('Vòng Chung Kết 15/11/2026 (MÔ PHỎNG)', 180, 20, 4);
        this.audit('system', 'seed.demo.round', '');
      });
    }
    if (!this.db.prepare('SELECT COUNT(*) c FROM attendees WHERE is_simulated=0').get().c) {
      for (let i = 1; i <= 10; i++) this.createAttendeeWithCode(`Khán giả mẫu ${String(i).padStart(2, '0')}`, `DEMO${String(i).padStart(4, '0')}`, 'system');
    }
  }
  demoSimulate(count = 1, bias = null) {
    if (!this.config.demo) throw new HttpError(403, 'NOT_DEMO', 'Chức năng mô phỏng chỉ có ở chế độ demo.');
    const r = this.currentRound();
    if (!r || r.status !== 'open') throw new HttpError(409, 'ROUND_STATE', 'Cần có vòng đang mở.');
    const teamIds = this.roundTeamIds(r);
    let added = 0;
    for (let i = 0; i < count; i++) {
      const [a] = this.createAttendees([`MÔ PHỎNG ${crypto.randomBytes(3).toString('hex')}`], 'demo', { simulated: true });
      const pickIdx = bias !== null && Math.random() < 0.6 ? bias % teamIds.length : Math.floor(Math.random() * teamIds.length);
      try { this.castVote({ attendeeId: a.id, teamId: teamIds[pickIdx], idemKey: crypto.randomUUID(), simulated: true }); added++; } catch { break; }
    }
    return added;
  }
  demoAutoSet(on) {
    clearInterval(this.demoAuto); this.demoAuto = null;
    if (!on) return false;
    let n = 0; let focus = 0;
    this.demoAuto = setInterval(() => {
      n++; if (n % 18 === 0) focus = (focus + 1 + Math.floor(Math.random() * 3)) % 6; // đổi đội được ưu ái để có vượt hạng thật
      try { this.demoSimulate(1 + (Math.random() < 0.3 ? 1 : 0), focus); } catch { clearInterval(this.demoAuto); this.demoAuto = null; }
    }, 350);
    this.demoAuto.unref?.();
    return true;
  }
}
