// Tầng HTTP: định tuyến, xác thực, SSE, tệp tĩnh. Không dùng framework để giảm phụ thuộc.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { Store } from './store.js';
import { HttpError, RateLimiter, signToken, verifyToken, safeEqual, toCsv, parseCsv, parseRegistration, maskEmail } from './util.js';
import { makeMailer } from './mailer.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const PAGES = { '/': 'index.html', '/vote': 'vote.html', '/screen': 'screen.html', '/admin': 'admin.html' };
const TOKEN_TTL = 12 * 3600 * 1000;

export function createApp(overrides = {}) {
  const config = overrides.config;
  const clock = overrides.clock || { now: () => Date.now() };
  const store = new Store({ config, clock });
  const persist = overrides.makePersist ? overrides.makePersist(store) : null;
  const durable = async () => { if (!persist) return; try { await persist.durable(); } catch { throw new HttpError(503, 'PERSIST_FAIL', 'Hệ thống đang lưu dữ liệu, vui lòng thử lại sau giây lát.'); } };
  if (config.autoSeed) store.seedSampleTeams();
  if (config.demo) store.seedDemo();
  const limiter = new RateLimiter(clock);
  const mailer = overrides.mailer || makeMailer(config);
  const sse = new Set();
  const qrCache = new Map();

  // ---------- phát SSE ----------
  const broadcast = () => {
    if (!sse.size) return;
    const payload = `event: state\ndata: ${JSON.stringify(store.publicState())}\n\n`;
    for (const res of sse) { try { res.write(payload); } catch { sse.delete(res); } }
  };
  store.onChange(broadcast);
  const heartbeat = setInterval(() => { for (const res of sse) { try { res.write(': ping\n\n'); } catch { sse.delete(res); } } }, 15000);
  heartbeat.unref();
  let ticker = null;
  if (config.tick) { ticker = setInterval(() => { try { store.tick(); } catch (e) { console.error('tick lỗi', e); } }, 500); ticker.unref(); }

  // ---------- trợ giúp ----------
  const ipOf = (req) => (config.trustProxy && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split(/=(.*)/s)).filter((p) => p[0]).map((p) => [p[0], decodeURIComponent(p[1] || '')]));
  const securityHeaders = (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
  };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, headers); res.end(body); };
  const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'TOO_LARGE', 'Dữ liệu gửi lên quá lớn.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
  const adminAuth = (req) => {
    const t = parseCookies(req).adm;
    const p = verifyToken(config.sessionSecret, t, clock.now());
    return p && p.k === 'adm' ? p : null;
  };
  const requireRole = (req, role) => {
    const p = adminAuth(req);
    if (!p) throw new HttpError(401, 'UNAUTHORIZED', 'Cần đăng nhập quản trị.');
    if (role === 'admin' && p.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Tài khoản vận hành không có quyền thực hiện thao tác này.');
    return p;
  };
  const attendeeAuth = (req) => {
    const h = req.headers.authorization || '';
    const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    const p = verifyToken(config.sessionSecret, tok, clock.now());
    if (!p || p.k !== 'att') throw new HttpError(401, 'UNAUTHORIZED', 'Phiên tham dự đã hết hạn. Hãy nhập lại mã.');
    const a = store.attendeeRow(p.a);
    if (!a || a.status !== 'active' || a.token_ver !== p.v) throw new HttpError(401, 'UNAUTHORIZED', 'Mã tham dự không còn hiệu lực. Hãy đến bàn hỗ trợ.');
    return a;
  };

  // ---------- ảnh thay thế nhất quán ----------
  const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function placeholderSvg(code, name, kind) {
    const h = hue(code); const w = kind === 'photo' ? 1200 : 600; const hh = kind === 'photo' ? 900 : 600;
    const initials = esc((name || code).split(/\s+/).filter(Boolean).slice(-2).map((x) => x[0]).join('').toUpperCase());
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 42%)"/><stop offset="1" stop-color="hsl(${(h + 70) % 360} 65% 24%)"/></linearGradient><radialGradient id="r" cx=".3" cy=".25" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${hh}" fill="url(#g)"/><rect width="${w}" height="${hh}" fill="url(#r)"/><g fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="3">${[0, 1, 2, 3, 4].map((i) => `<path d="M0 ${hh * 0.62 + i * 16} C ${w * 0.3} ${hh * 0.5 + i * 16}, ${w * 0.6} ${hh * 0.75 + i * 16}, ${w} ${hh * 0.6 + i * 16}"/>`).join('')}</g><text x="50%" y="${kind === 'photo' ? '52%' : '56%'}" text-anchor="middle" font-family="Be Vietnam Pro, Segoe UI, Arial, sans-serif" font-weight="800" font-size="${kind === 'photo' ? 260 : 220}" fill="#fff" fill-opacity=".92">${initials}</text>${kind === 'photo' ? `<text x="50%" y="${hh - 40}" text-anchor="middle" font-family="Be Vietnam Pro, Segoe UI, Arial, sans-serif" font-size="30" letter-spacing="6" fill="#fff" fill-opacity=".6">ẢNH THAY THẾ • ${esc(code)}</text>` : ''}</svg>`;
  }
  async function qrSvg(url) {
    if (!qrCache.has(url)) qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } }));
    return qrCache.get(url);
  }

  // ---------- tuyến API ----------
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };
  const intParam = (v) => { const n = Number(v); if (!Number.isInteger(n)) throw new HttpError(400, 'BAD_ID', 'Mã không hợp lệ.'); return n; };

  // Công khai
  route('GET', '/api/public/state', async (c) => {
    const v = Number(c.query.get('v'));
    if (Number.isInteger(v) && v === store.version) return c.json(200, { unchanged: true, version: store.version, serverNow: clock.now() });
    return c.json(200, store.publicState());
  });
  route('GET', '/api/stream', async (c) => {
    if (sse.size >= 300) throw new HttpError(503, 'BUSY', 'Quá nhiều kết nối trực tiếp.');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(store.publicState())}\n\n`);
    sse.add(c.res);
    c.req.on('close', () => sse.delete(c.res));
    return 'stream';
  });
  route('GET', '/api/teams/:id', async (c) => {
    const t = store.teamRow(intParam(c.params.id));
    if (!t || !t.active) throw new HttpError(404, 'NO_TEAM', 'Không tìm thấy đội.');
    return c.json(200, store.teamPublic(t));
  });
  route('GET', '/api/audio-manifest', async (c) => {
    let files = [];
    try { files = fs.readdirSync(path.join(config.publicDir, 'audio')).filter((f) => /\.(mp3|ogg|wav|m4a)$/i.test(f)); } catch { /* chưa có */ }
    return c.json(200, Object.fromEntries(files.map((f) => [path.parse(f).name, `/audio/${f}`])));
  });
  route('GET', '/api/qr.svg', async (c) => {
    // QR chỉ trỏ tới URL bình chọn công khai đã cấu hình - không nhận URL tùy ý từ query.
    const svg = await qrSvg(`${store.effectivePublicUrl()}/vote`);
    return c.raw(200, svg, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-cache' });
  });
  route('GET', '/img/team/:file', async (c) => {
    const code = decodeURIComponent(c.params.file).replace(/\.svg$/, '').slice(0, 20);
    const kind = c.query.get('k') === 'photo' ? 'photo' : 'avatar';
    return c.raw(200, placeholderSvg(code, (c.query.get('n') || '').slice(0, 100), kind), { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
  });

  route('GET', '/healthz', async (c) => c.json(200, { ok: true, persist: persist ? persist.status() : null }));

  // Khán giả
  route('POST', '/api/checkin', async (c) => {
    const ip = ipOf(c.req);
    const key = `ci:${ip}`;
    if ((limiter.hits.get(key) || []).filter((t) => clock.now() - t < 300000).length >= 60) throw new HttpError(429, 'RATE_LIMIT', 'Bạn nhập sai quá nhiều lần. Vui lòng chờ vài phút hoặc đến bàn hỗ trợ.');
    const a = store.findAttendeeByCode(c.body?.code);
    // Thông báo lỗi chung: không phân biệt "sai" với "bị thu hồi", không lộ tên khi dò mã.
    if (!a || a.status !== 'active') { limiter.hit(key, 1e9, 300000); throw new HttpError(401, 'BAD_CODE', 'Mã không hợp lệ. Hãy kiểm tra lại hoặc đến bàn hỗ trợ.'); }
    const exp = clock.now() + TOKEN_TTL;
    return c.json(200, { token: signToken(config.sessionSecret, { k: 'att', a: a.id, v: a.token_ver, exp }), name: a.name, expiresAt: exp });
  });
  // Đăng ký tự khai: bước 1 gửi mã 6 số về Gmail, bước 2 nhập mã để vào bình chọn.
  route('POST', '/api/register', async (c) => {
    const ip = ipOf(c.req);
    if (!limiter.hit(`reg:${ip}`, 200, 600000)) throw new HttpError(429, 'RATE_LIMIT', 'Quá nhiều yêu cầu. Vui lòng chờ vài phút hoặc đến bàn hỗ trợ.');
    const info = parseRegistration(c.body);
    if (!limiter.hit(`regmail:${info.emailNorm}`, 6, 3600000)) throw new HttpError(429, 'RATE_LIMIT', 'Gmail này đã yêu cầu mã quá nhiều lần. Hãy thử lại sau.');
    const code = store.startRegistration(info);
    try {
      await mailer.send({
        to: info.email, subject: `Mã xác nhận bình chọn: ${code}`,
        text: `Xin chào ${info.name},\n\nMã xác nhận của bạn là: ${code}\nMã có hiệu lực trong 10 phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.\n\n${store.publicState().event.name}`,
        html: `<p>Xin chào <b>${info.name.replace(/[<>&"]/g, '')}</b>,</p><p>Mã xác nhận bình chọn của bạn là:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">${code}</p><p>Mã có hiệu lực trong 10 phút. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>`,
      });
    } catch (e) { store.cancelRegistration(info.emailNorm); throw e; }
    return c.json(200, { ok: true, email: maskEmail(info.email), expiresInSec: 600, resendAfterSec: 60 });
  });
  route('POST', '/api/verify', async (c) => {
    const ip = ipOf(c.req);
    if (!limiter.hit(`vf:${ip}`, 300, 600000)) throw new HttpError(429, 'RATE_LIMIT', 'Quá nhiều yêu cầu. Vui lòng chờ vài phút.');
    const b = c.body || {};
    const info = parseRegistration({ name: 'xx', mssv: '00000', phone: '0000000000', email: b.email });
    const a = store.completeRegistration(info.emailNorm, b.code);
    await durable();
    const exp = clock.now() + TOKEN_TTL;
    return c.json(200, { token: signToken(config.sessionSecret, { k: 'att', a: a.id, v: a.token_ver, exp }), name: a.name, expiresAt: exp });
  });
  route('GET', '/api/me', async (c) => {
    const a = attendeeAuth(c.req);
    return c.json(200, { name: a.name, vote: store.myVote(a.id), serverNow: clock.now() });
  });
  route('POST', '/api/vote', async (c) => {
    const a = attendeeAuth(c.req);
    if (!limiter.hit(`vote:${a.id}`, 30, 60000)) throw new HttpError(429, 'RATE_LIMIT', 'Gửi quá nhanh, hãy thử lại sau giây lát.');
    const b = c.body || {};
    const g = b.geo && typeof b.geo === 'object' ? { lat: b.geo.lat, lng: b.geo.lng, accuracy: b.geo.accuracy, ageMs: b.geo.ageMs } : null;
    const r = store.castVote({ attendeeId: a.id, teamId: b.teamId, idemKey: b.idemKey, roundId: b.roundId, geo: g });
    await durable(); // chỉ xác nhận phiếu sau khi đã lưu bền (kể cả khi gửi lại)
    const { status, ...receipt } = r;
    return c.json(status, { ok: true, receipt });
  });

  // Âm thanh sân khấu - chỉ máy giữ SCREEN_KEY mới nhận quyền phát
  route('POST', '/api/screen/claim-audio', async (c) => {
    if (!limiter.hit(`claim:${ipOf(c.req)}`, 20, 60000)) throw new HttpError(429, 'RATE_LIMIT', 'Thử quá nhiều lần.');
    if (!c.body || typeof c.body.key !== 'string' || !safeEqual(c.body.key, config.screenKey)) throw new HttpError(403, 'BAD_KEY', 'Khóa màn hình không đúng.');
    if (typeof c.body.clientId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(c.body.clientId)) throw new HttpError(400, 'BAD_CLIENT', 'Mã máy không hợp lệ.');
    store.setAudio({ ownerId: c.body.clientId }, 'screen');
    return c.json(200, { ok: true });
  });

  // Đăng nhập quản trị
  route('POST', '/api/admin/login', async (c) => {
    const ip = ipOf(c.req);
    const key = `adm:${ip}`;
    if ((limiter.hits.get(key) || []).filter((t) => clock.now() - t < 600000).length >= 10) throw new HttpError(429, 'RATE_LIMIT', 'Đăng nhập sai quá nhiều lần. Chờ 10 phút.');
    const pw = typeof c.body?.password === 'string' ? c.body.password : '';
    let role = null;
    if (safeEqual(pw, config.adminPassword)) role = 'admin';
    else if (config.operatorPassword && safeEqual(pw, config.operatorPassword)) role = 'operator';
    if (!role) { limiter.hit(key, 1e9, 600000); throw new HttpError(401, 'BAD_LOGIN', 'Sai mật khẩu.'); }
    const tok = signToken(config.sessionSecret, { k: 'adm', role, exp: clock.now() + 12 * 3600 * 1000 });
    store.audit(role, 'login', ip);
    return c.json(200, { ok: true, role }, { 'Set-Cookie': `adm=${encodeURIComponent(tok)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${config.cookieSecure ? '; Secure' : ''}` });
  });
  route('POST', '/api/admin/logout', async (c) => c.json(200, { ok: true }, { 'Set-Cookie': 'adm=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' }));
  route('GET', '/api/admin/me', async (c) => {
    const p = requireRole(c.req, 'operator');
    return c.json(200, { role: p.role, demo: config.demo, screenKey: config.screenKey, publicUrl: store.effectivePublicUrl() });
  });

  // Quản trị - vận hành sân khấu (operator + admin)
  const op = (method, p, fn) => route(method, p, async (c) => { const who = requireRole(c.req, 'operator'); const out = (await fn(c, who.role)) ?? { ok: true }; if (method !== 'GET') await durable(); return c.json(200, out); });
  const adm = (method, p, fn) => route(method, p, async (c) => { const who = requireRole(c.req, 'admin'); const out = (await fn(c, who.role)) ?? { ok: true }; if (method !== 'GET') await durable(); return c.json(200, out); });

  op('GET', '/api/admin/overview', () => store.adminOverview());
  op('GET', '/api/admin/rounds', () => store.listRounds().map((r) => store.roundJson(r)));
  op('POST', '/api/admin/rounds/:id/open', (c, who) => { store.openRound(intParam(c.params.id), who, { durationSec: c.body?.durationSec }); });
  op('POST', '/api/admin/rounds/:id/extend', (c, who) => { store.extendRound(intParam(c.params.id), c.body?.seconds, who, c.body?.reason); });
  op('POST', '/api/admin/rounds/:id/close', (c, who) => { store.closeRound(intParam(c.params.id), who); });
  op('POST', '/api/admin/rounds/:id/lock', (c, who) => store.lockRound(intParam(c.params.id), who));
  op('POST', '/api/admin/reveal/next', (_c, who) => store.revealNext(who));
  op('POST', '/api/admin/reveal/prev', (_c, who) => { store.revealPrev(who); });
  op('POST', '/api/admin/reveal/final', (_c, who) => { store.showFinal(who); });
  op('POST', '/api/admin/display/mode', (c, who) => { store.setMode(c.body?.mode, who); });
  op('POST', '/api/admin/display/flags', (c, who) => { store.setDisplayFlags(c.body || {}, who); });
  op('POST', '/api/admin/audio', (c, who) => { store.setAudio(c.body || {}, who); });
  op('POST', '/api/admin/cue', (c, who) => { store.playCue(c.body?.name, who); });

  // Quản trị - chỉ admin
  adm('GET', '/api/admin/teams', () => store.listTeams().map((t) => ({ ...store.teamPublic(t), active: !!t.active, sortOrder: t.sort_order, avatarUrl: t.avatar_url, photoUrl: t.photo_url })));
  adm('POST', '/api/admin/teams', (c, who) => store.teamPublic(store.createTeam(c.body || {}, who)));
  adm('POST', '/api/admin/teams/reorder', (c, who) => { store.reorderTeams(c.body?.ids, who); });
  adm('PUT', '/api/admin/teams/:id', (c, who) => store.teamPublic(store.updateTeam(intParam(c.params.id), c.body || {}, who)));
  adm('DELETE', '/api/admin/teams/:id', (c, who) => { store.deleteTeam(intParam(c.params.id), who); });
  route('POST', '/api/admin/upload', async (c) => {
    const who = requireRole(c.req, 'admin');
    const buf = c.rawBody;
    let ext = null;
    if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ext = 'png';
    else if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) ext = 'jpg';
    else if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') ext = 'webp';
    if (!ext) throw new HttpError(415, 'BAD_IMAGE', 'Chỉ nhận ảnh PNG, JPG hoặc WEBP.');
    const name = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.uploadsDir, name), buf);
    store.audit(who.role, 'upload', name);
    return c.json(201, { url: `/uploads/${name}` });
  });
  adm('POST', '/api/admin/rounds', (c, who) => store.roundJson(store.createRound(c.body || {}, who)));
  adm('PUT', '/api/admin/rounds/:id', (c, who) => store.roundJson(store.updateRound(intParam(c.params.id), c.body || {}, who)));
  adm('DELETE', '/api/admin/rounds/:id', (c, who) => { store.deleteRound(intParam(c.params.id), who); });
  adm('POST', '/api/admin/rounds/:id/unlock', (c, who) => { store.unlockRound(intParam(c.params.id), who, c.body?.reason); });
  adm('GET', '/api/admin/attendees', (c) => { const r = store.currentRound(); return store.listAttendees(r?.id); });
  adm('POST', '/api/admin/attendees', (c, who) => {
    let names = c.body?.names;
    if (typeof c.body?.csv === 'string') {
      const rows = parseCsv(c.body.csv);
      if (rows.length && /^(name|họ tên|ho ten|tên|ten)$/i.test(rows[0][0].trim())) rows.shift();
      names = rows.map((r) => r[0]);
    }
    return { created: store.createAttendees(names, who) };
  });
  adm('POST', '/api/admin/attendees/:id/status', (c, who) => { store.setAttendeeStatus(intParam(c.params.id), c.body?.status, who); });
  adm('POST', '/api/admin/attendees/:id/regen', (c, who) => store.regenCode(intParam(c.params.id), who));
  adm('POST', '/api/admin/attendees/:id/geo-exception', (c, who) => { store.setGeoException(intParam(c.params.id), !!c.body?.on, c.body?.reason, who); });
  adm('GET', '/api/admin/settings', () => store.settings());
  adm('PUT', '/api/admin/settings', (c, who) => store.updateSettings(c.body || {}, who));
  adm('GET', '/api/admin/audit', () => store.auditList(300));
  route('GET', '/api/admin/export/results.csv', async (c) => {
    const who = requireRole(c.req, 'admin');
    const id = c.query.get('round') ? intParam(c.query.get('round')) : store.currentRound()?.id;
    if (!id) throw new HttpError(404, 'NO_ROUND', 'Chưa có vòng.');
    store.audit(who.role, 'export.results', String(id));
    return c.raw(200, toCsv(store.resultsCsvRows(id)), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ket-qua-vong-${id}.csv"` });
  });
  route('GET', '/api/admin/export/attendance.csv', async (c) => {
    const who = requireRole(c.req, 'admin');
    const id = c.query.get('round') ? intParam(c.query.get('round')) : store.currentRound()?.id;
    store.audit(who.role, 'export.attendance', String(id));
    const rows = [['ID', 'Họ tên', 'Trạng thái', 'Ngoại lệ vị trí', 'Đã bình chọn vòng này'], ...store.listAttendees(id).filter((a) => !a.simulated).map((a) => [a.id, a.name, a.status, a.geoException ? 'Có' : '', a.voted ? 'Có' : 'Chưa'])];
    return c.raw(200, toCsv(rows), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tham-du-vong-${id}.csv"` });
  });
  // Mô phỏng (chỉ demo)
  adm('POST', '/api/admin/demo/simulate', (c) => ({ added: store.demoSimulate(Math.min(Math.max(Number(c.body?.count) || 1, 1), 200)) }));
  adm('POST', '/api/admin/demo/auto', (c) => ({ on: store.demoAutoSet(!!c.body?.on) }));

  // ---------- tệp tĩnh ----------
  function serveFile(req, res, file, extra = {}) {
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (!st.isFile()) return false;
    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const cache = extra.cache || (ext === '.html' ? 'no-cache' : 'public, max-age=60');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, ...(extra.headers || {}) });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
    return true;
  }
  function inside(base, target) { const rel = path.relative(base, target); return rel && !rel.startsWith('..') && !path.isAbsolute(rel); }

  // ---------- máy chủ ----------
  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://x');
    try {
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'BAD_URL', 'Đường dẫn không hợp lệ.'); }
      if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);

      const matched = routes.find((r) => r.method === req.method && r.re.test(pathname));
      if (matched || pathname.startsWith('/api/')) {
        if (!matched) throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy.');
        const m = matched.re.exec(pathname);
        const params = Object.fromEntries(matched.keys.map((k, i) => [k, m[i + 1]]));
        let body; let rawBody;
        if (req.method === 'POST' || req.method === 'PUT') {
          const ct = (req.headers['content-type'] || '').split(';')[0].trim();
          if (pathname === '/api/admin/upload') { rawBody = await readBody(req, 4 * 1024 * 1024); }
          else {
            const raw = await readBody(req, 2 * 1024 * 1024);
            if (raw.length) {
              if (ct !== 'application/json') throw new HttpError(415, 'BAD_TYPE', 'Chỉ nhận application/json.');
              try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'BAD_JSON', 'JSON không hợp lệ.'); }
            }
          }
        }
        const c = {
          req, res, params, query: url.searchParams, body, rawBody,
          json: (status, obj, headers) => json(res, status, obj, headers),
          raw: (status, data, headers) => send(res, status, data, headers),
        };
        const out = await matched.handler(c);
        if (out === 'stream') return;
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'METHOD', 'Phương thức không được hỗ trợ.');
      if (PAGES[pathname]) { if (serveFile(req, res, path.join(config.publicDir, PAGES[pathname]))) return; }
      if (/^\/teams\/[^/]+$/.test(pathname)) { if (serveFile(req, res, path.join(config.publicDir, 'team.html'))) return; }
      if (pathname.startsWith('/uploads/')) {
        const f = path.join(config.uploadsDir, path.basename(pathname));
        if (serveFile(req, res, f, { cache: 'public, max-age=300', headers: { 'Content-Security-Policy': "default-src 'none'; sandbox" } })) return;
      } else {
        const f = path.join(config.publicDir, pathname);
        if (inside(config.publicDir, f) && serveFile(req, res, f)) return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy trang.');
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* */ } return; }
      if (e instanceof HttpError) return json(res, e.status, { ok: false, error: { code: e.code, message: e.message, ...(e.extra || {}) } });
      console.error('Lỗi không mong đợi:', e);
      return json(res, 500, { ok: false, error: { code: 'INTERNAL', message: 'Lỗi máy chủ. Vui lòng thử lại.' } });
    }
  });
  server.headersTimeout = 20000;

  return {
    config, store, server, clock, persist,
    listen: () => new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server.address().port))),
    close: () => new Promise((resolve) => {
      clearInterval(heartbeat); clearInterval(ticker);
      for (const res of sse) { try { res.end(); } catch { /* */ } }
      Promise.resolve(persist?.close()).finally(() => server.close(() => { store.close(); resolve(); }));
      server.closeAllConnections?.();
    }),
  };
}
