export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtNum = (n) => new Intl.NumberFormat('vi-VN').format(n);
export const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};
export const fmtTime = (ms) => new Date(ms).toLocaleTimeString('vi-VN', { hour12: false });

/** Đồng hồ đồng bộ theo giờ máy chủ (nguồn chính cho thời hạn). */
export class ServerClock {
  constructor() { this.offset = 0; this.ready = false; }
  sync(serverNow, sentAt = Date.now()) {
    // dùng độ lệch nhỏ nhất quan sát được để giảm ảnh hưởng độ trễ mạng
    const off = serverNow - Date.now();
    if (!this.ready || Math.abs(off) < Math.abs(this.offset) + 1500) this.offset = off;
    this.ready = true;
  }
  now() { return Date.now() + this.offset; }
}

export async function api(path, { method = 'GET', body, token, headers = {}, raw, timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method, signal: ctl.signal, credentials: 'same-origin',
      headers: { ...(raw ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error(data?.error?.message || `Lỗi ${res.status}`); e.status = res.status; e.code = data?.error?.code; e.data = data?.error; throw e; }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') { const err = new Error('Mạng chậm hoặc mất kết nối.'); err.network = true; throw err; }
    if (!e.status) { e.network = true; e.message = 'Không kết nối được máy chủ.'; }
    throw e;
  } finally { clearTimeout(timer); }
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* chế độ riêng tư */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};
