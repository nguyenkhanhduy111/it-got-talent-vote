// Tiện ích thuần (không phụ thuộc DB) - có kiểm thử riêng.
import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Khoảng cách haversine (mét). */
export function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Kiểm tra vị trí phía máy chủ.
 * geo = { lat, lng, accuracy, ageMs }  (ageMs: tuổi của phép đo, tính bằng đồng hồ thiết bị để tránh lệch giờ)
 * Trả { ok, code?, message?, result }
 */
export function evaluateGeo(cfg, geo, { exception = false } = {}) {
  if (!cfg.locationEnabled) return { ok: true, result: 'disabled' };
  if (exception) return { ok: true, result: 'exception' };
  if (!geo || typeof geo !== 'object') {
    return { ok: false, code: 'GPS_REQUIRED', message: 'Cần chia sẻ vị trí để bình chọn.' };
  }
  const { lat, lng, accuracy, ageMs } = geo;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!num(lat) || !num(lng) || !num(accuracy) || !num(ageMs) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0 || ageMs < 0) {
    return { ok: false, code: 'GPS_INVALID', message: 'Dữ liệu vị trí không hợp lệ. Hãy thử lấy lại vị trí.' };
  }
  if (ageMs > cfg.geoMaxAgeSec * 1000) {
    return { ok: false, code: 'GPS_STALE', message: 'Vị trí đã cũ. Hãy lấy lại vị trí rồi gửi lại.' };
  }
  if (accuracy > cfg.accuracyMaxM) {
    return { ok: false, code: 'GPS_INACCURATE', message: `Vị trí chưa đủ chính xác (sai số khoảng ${Math.round(accuracy)} m). Hãy bật GPS/Wi-Fi rồi lấy lại vị trí.` };
  }
  const d = haversineM(lat, lng, cfg.venueLat, cfg.venueLng);
  if (d > cfg.radiusM) {
    return { ok: false, code: 'OUT_OF_RANGE', message: 'Bạn đang ở ngoài khu vực được phép bình chọn. Nếu bạn đang ở hội trường, hãy đến bàn hỗ trợ.' };
  }
  return { ok: true, result: 'ok' };
}

/**
 * Xếp hạng theo tổng phiếu giảm dần. Đồng phiếu => đồng hạng (1,2,2,4).
 * Thứ tự hiển thị khi đồng phiếu theo sortOrder chỉ để ổn định, KHÔNG phải tiêu chí thắng.
 * rows: [{teamId, votes, sortOrder}]
 */
export function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.votes - a.votes || a.sortOrder - b.sortOrder || a.teamId - b.teamId);
  let rank = 0;
  let prev = null;
  return sorted.map((r, i) => {
    if (prev === null || r.votes !== prev) rank = i + 1;
    prev = r.votes;
    return { teamId: r.teamId, votes: r.votes, rank };
  }).map((r, _i, arr) => ({ ...r, tie: arr.filter((x) => x.rank === r.rank).length > 1 }));
}

/**
 * Các bước công bố: nhóm theo hạng, chỉ lấy hạng <= places, công bố từ hạng thấp lên cao.
 * Trả mảng nhóm [{rank, votes, teamIds}] theo thứ tự công bố.
 */
export function revealGroups(ranked, places) {
  const byRank = new Map();
  for (const r of ranked) {
    if (r.rank > places) continue;
    if (!byRank.has(r.rank)) byRank.set(r.rank, { rank: r.rank, votes: r.votes, teamIds: [] });
    byRank.get(r.rank).teamIds.push(r.teamId);
  }
  return [...byRank.values()].sort((a, b) => b.rank - a.rank);
}

/** Chống formula injection khi xuất CSV/Excel. */
export function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
export function toCsv(rows) {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Đọc CSV đơn giản (có ngoặc kép). Trả mảng hàng -> mảng ô. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I,O,0,1 dễ nhầm; 32 ký tự
export function generateCode(len = 10) {
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}
export const normalizeCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatCode = (c) => (c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : c);
export const hashCode = (pepper, code) => crypto.createHmac('sha256', pepper).update(normalizeCode(code)).digest('hex');

const b64u = (b) => Buffer.from(b).toString('base64url');
export function signToken(secret, payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken(secret, token, nowMs) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const exp = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(exp);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp < nowMs) return null;
    return p;
  } catch { return null; }
}
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Giới hạn tần suất theo cửa sổ trượt (bộ nhớ). */
export class RateLimiter {
  constructor(clock) { this.clock = clock; this.hits = new Map(); }
  /** Trả true nếu CÒN trong hạn mức (và ghi nhận 1 lần). */
  hit(key, max, windowMs) {
    const now = this.clock.now();
    const arr = (this.hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { this.hits.set(key, arr); return false; }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 20000) this.sweep(windowMs);
    return true;
  }
  sweep(windowMs) {
    const now = this.clock.now();
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < windowMs)) this.hits.delete(k);
  }
}

// ---------- đăng ký khán giả ----------
export function parseRegistration(b) {
  b = b && typeof b === 'object' ? b : {};
  const name = String(b.name ?? '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'BAD_NAME', 'Vui lòng nhập họ và tên (2–100 ký tự).');
  const mssv = String(b.mssv ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (mssv.length < 5 || mssv.length > 15) throw new HttpError(400, 'BAD_MSSV', 'MSSV không hợp lệ (5–15 chữ/số).');
  let phone = String(b.phone ?? '').replace(/[\s.\-()]/g, '');
  if (phone.startsWith('+84')) phone = '0' + phone.slice(3); else if (phone.startsWith('84') && phone.length === 11) phone = '0' + phone.slice(2);
  if (!/^0\d{9}$/.test(phone)) throw new HttpError(400, 'BAD_PHONE', 'Số điện thoại không hợp lệ (10 số, bắt đầu bằng 0).');
  const email = String(b.email ?? '').trim().toLowerCase();
  const m = email.match(/^([a-z0-9._+-]{1,64})@(gmail\.com|googlemail\.com)$/);
  if (!m) throw new HttpError(400, 'BAD_EMAIL', 'Vui lòng nhập địa chỉ Gmail hợp lệ (đuôi @gmail.com).');
  // Gmail bỏ qua dấu chấm và phần sau dấu +, nên chuẩn hoá để chặn dùng nhiều bí danh của cùng một hộp thư.
  const local = m[1].split('+')[0].replace(/\./g, '');
  if (!local) throw new HttpError(400, 'BAD_EMAIL', 'Vui lòng nhập địa chỉ Gmail hợp lệ (đuôi @gmail.com).');
  return { name, mssv, phone, email, emailNorm: `${local}@gmail.com` };
}
export const maskEmail = (e) => e.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2');
