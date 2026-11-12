-- Đăng ký khán giả bằng họ tên + MSSV + SĐT + Gmail (xác nhận bằng mã gửi qua email).
ALTER TABLE attendees ADD COLUMN mssv TEXT;
ALTER TABLE attendees ADD COLUMN phone TEXT;
ALTER TABLE attendees ADD COLUMN email TEXT;
ALTER TABLE attendees ADD COLUMN email_norm TEXT;
CREATE UNIQUE INDEX attendees_mssv_u ON attendees (mssv) WHERE mssv IS NOT NULL;
CREATE UNIQUE INDEX attendees_phone_u ON attendees (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX attendees_email_u ON attendees (email_norm) WHERE email_norm IS NOT NULL;

CREATE TABLE reg_pending (
  email_norm TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  mssv       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  sent_at    INTEGER NOT NULL
);
