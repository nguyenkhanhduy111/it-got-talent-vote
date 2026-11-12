import { $, $$, esc, fmtNum, fmtClock, ServerClock, api, uuid, store } from './common.js';
import { ting } from './audio.js';

const clock = new ServerClock();
const app = $('#app');
const S = {
  view: 'welcome', pub: null, token: store.get('gdta.token'), name: store.get('gdta.name'), myVote: null,
  geo: null, geoErr: null, geoBusy: false, sel: null, busy: false, err: null, info: null, codeDraft: '', reg: { name: '', mssv: '', phone: '', email: '', emailMasked: '' }, pending: store.get('gdta.pending'),
  prefs: { sound: store.get('gdta.sound', false), vib: store.get('gdta.vib', false), reduce: store.get('gdta.reduce', matchMedia('(prefers-reduced-motion: reduce)').matches) },
  pick: new URLSearchParams(location.search).get('pick'), receipt: null,
};
const prefsInit = () => { $('#pSound').checked = S.prefs.sound; $('#pVib').checked = S.prefs.vib; $('#pReduce').checked = S.prefs.reduce; document.body.classList.toggle('reduce', S.prefs.reduce); };
$('#pSound').onchange = (e) => { S.prefs.sound = e.target.checked; store.set('gdta.sound', S.prefs.sound); if (S.prefs.sound) ting(); };
$('#pVib').onchange = (e) => { S.prefs.vib = e.target.checked; store.set('gdta.vib', S.prefs.vib); if (S.prefs.vib) navigator.vibrate?.(40); };
$('#pReduce').onchange = (e) => { S.prefs.reduce = e.target.checked; store.set('gdta.reduce', S.prefs.reduce); prefsInit(); };
prefsInit();

const round = () => S.pub?.round || null;
const isOpen = () => { const r = round(); return !!r && r.status === 'open' && clock.now() < r.closesAt; };
const teamById = (id) => S.pub?.teams.find((t) => t.id === id);
const go = (v) => { S.view = v; S.err = null; render(); window.scrollTo(0, 0); };
const errMsg = (m) => `<div class="msg err" role="alert">${esc(m)}</div>`;
const infoMsg = (m) => `<div class="msg info">${esc(m)}</div>`;

function statusChip() {
  const r = round();
  if (!r) return '<span class="status">Chưa có vòng bình chọn</span>';
  if (r.status === 'draft') return `<span class="status">${esc(r.name)} · sắp mở</span>`;
  if (isOpen()) return `<span class="status open">${esc(r.name)} · đang mở</span>`;
  return `<span class="status">${esc(r.name)} · đã kết thúc</span>`;
}
const timeBlock = () => { const r = round(); return isOpen() ? `<div class="bigtime" id="tleft">${fmtClock(r.closesAt - clock.now())}</div><p style="margin:0">thời gian còn lại (theo giờ máy chủ)</p>` : ''; };

// ---------- các màn hình ----------
const V = {
  welcome() {
    const r = round();
    let cta;
    if (S.myVote) cta = '<button class="btn block" data-act="follow">Xem phiếu của tôi</button>';
    else if (!r || r.status === 'draft') cta = '<button class="btn block" disabled>Chưa mở bình chọn</button>';
    else if (!isOpen()) cta = '<button class="btn block ghost" data-act="follow">Xem kết quả</button>';
    else cta = '<button class="btn block" data-act="join">Tham gia bình chọn</button>';
    return `<div class="card"><h1>${esc(S.pub?.event.name || '')}</h1><p>${esc(S.pub?.event.tagline || '')}</p>${statusChip()}${timeBlock()}</div>
      <div class="card"><h2>Cách bình chọn</h2><ol class="steps"><li>Điền họ tên, MSSV, số điện thoại và Gmail, rồi nhập mã xác nhận 6 số gửi về Gmail của bạn.</li><li>Cho phép chia sẻ vị trí để kiểm tra bạn đang ở khu vực sự kiện.</li><li>Chọn một đội, kiểm tra lại và xác nhận. Mỗi người một phiếu mỗi vòng.</li></ol></div>${cta}`;
  },
  code() {
    const R = S.reg, L = 'display:block;margin:12px 0 4px;font-weight:600', F = 'style="text-align:left;text-transform:none;letter-spacing:normal;font-size:18px"';
    return `<div class="card"><h2>Thông tin người bình chọn</h2><p>Điền đúng thông tin của bạn. Mỗi MSSV, số điện thoại và Gmail chỉ được bình chọn một lần.</p>${S.err ? errMsg(S.err) : ''}
      <form id="regForm" autocomplete="on" novalidate>
      <label style="${L}" for="r_name">Họ và tên</label><input class="field" ${F} id="r_name" autocomplete="name" maxlength="100" value="${esc(R.name)}">
      <label style="${L}" for="r_mssv">Mã số sinh viên (MSSV)</label><input class="field" ${F} id="r_mssv" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="15" value="${esc(R.mssv)}">
      <label style="${L}" for="r_phone">Số điện thoại</label><input class="field" ${F} id="r_phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="15" value="${esc(R.phone)}">
      <label style="${L}" for="r_email">Gmail (để nhận mã xác nhận)</label><input class="field" ${F} id="r_email" type="email" inputmode="email" autocapitalize="none" autocomplete="email" spellcheck="false" maxlength="80" placeholder="ten@gmail.com" value="${esc(R.email)}">
      <button class="btn block" type="submit" style="margin-top:16px" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>Đang gửi mã…' : 'Gửi mã xác nhận'}</button></form></div>
      <a class="link" href="/">← Về trang tổng</a>`;
  },
  verify() {
    return `<div class="card"><h2>Nhập mã xác nhận</h2><p>Mã gồm 6 số đã gửi tới <b>${esc(S.reg.emailMasked)}</b>. Mã có hiệu lực 10 phút. Nếu chưa thấy, hãy kiểm tra mục Thư rác (Spam) hoặc Quảng cáo.</p>${S.err ? errMsg(S.err) : ''}${S.info ? infoMsg(S.info) : ''}
      <form id="verifyForm" autocomplete="off"><input class="field" id="v_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" aria-label="Mã xác nhận" style="letter-spacing:8px;text-align:center;font-size:24px">
      <button class="btn block" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>Đang kiểm tra' : 'Xác nhận và bình chọn'}</button></form>
      <div class="stack" style="margin-top:10px"><button class="btn block ghost" data-act="resend" ${S.busy ? 'disabled' : ''}>Gửi lại mã</button><button class="btn block ghost" data-act="editinfo">Sửa thông tin</button></div></div>`;
  },
  confirmName() {
    return `<div class="card"><h2>Xác nhận người tham dự</h2><p>Mã này được đăng ký cho:</p><div style="font-size:26px;font-weight:800;margin:6px 0 16px">${esc(S.name)}</div><p>Đây có đúng là bạn không?</p>
      <div class="stack"><button class="btn block" data-act="nameok">Đúng, tiếp tục</button><button class="btn block ghost" data-act="notme">Không phải tôi</button></div></div>`;
  },
  location() {
    const max = S.pub?.settings.accuracyMaxM;
    let note = '';
    if (S.geoErr) note = `<div class="msg err" role="alert">${esc(S.geoErr.msg)}</div>${S.geoErr.help ? `<div class="msg info">${S.geoErr.help}</div>` : ''}`;
    return `<div class="card"><h2>Chia sẻ vị trí</h2><p>Chúng tôi cần vị trí của bạn <b>một lần</b> để kiểm tra bạn đang ở khu vực sự kiện (bán kính cho phép do ban tổ chức đặt). Chúng tôi không lưu tọa độ chính xác, chỉ lưu kết quả kiểm tra.</p>${note}
      <button class="btn block" data-act="getgeo" ${S.geoBusy ? 'disabled' : ''}>${S.geoBusy ? '<span class="spinner"></span>Đang xác định vị trí…' : S.geoErr ? 'Thử lại' : 'Cho phép vị trí'}</button>
      ${max ? `<p style="margin-top:10px;font-size:13px;color:var(--muted)">Sai số GPS cần ≤ ${fmtNum(max)} m. Nên bật GPS và Wi-Fi.</p>` : ''}</div>
      <p style="font-size:14px">Gặp lỗi GPS? Hãy đến bàn hỗ trợ để được kiểm tra trực tiếp.</p>`;
  },
  pick() {
    const teams = S.pub?.teams || [];
    const cards = teams.map((t) => `<div class="tcard" role="button" tabindex="0" data-act="select" data-id="${t.id}" aria-pressed="${S.sel === t.id}" aria-label="Chọn ${esc(t.name)}">
      <img class="ph" src="${esc(t.photo)}" alt="" loading="lazy">${t.isSample ? '<span class="sample">DỮ LIỆU MẪU</span>' : ''}<span class="tick">✓</span>
      <div class="info"><div class="code">${esc(t.code)}</div><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div><div class="gn">${esc(t.genre)}${t.members ? ` · ${t.members} thành viên` : ''}</div>
      <a class="detail" href="/teams/${t.id}?from=vote" data-stop>Xem chi tiết →</a></div></div>`).join('');
    return `<div class="card"><span style="color:var(--muted);font-size:14px">Xin chào,</span><div style="font-weight:800;font-size:20px">${esc(S.name)}</div>${statusChip()}${timeBlock()}</div>
      <h2 style="margin:6px 2px 10px">Chọn một đội</h2>${S.err ? errMsg(S.err) : ''}<div class="teams">${cards}</div>
      <div class="sticky"><div class="in"><button class="btn block" data-act="topick" ${S.sel ? '' : 'disabled'}>${S.sel ? `Tiếp tục với “${esc(teamById(S.sel)?.name || '')}”` : 'Hãy chọn một đội'}</button></div></div>`;
  },
  confirm() {
    const t = teamById(S.sel); if (!t) return '<div class="card">Không tìm thấy đội.</div>';
    const pend = S.pending && S.pending.teamId === S.sel;
    return `<div class="card pickedpreview"><h2>Xác nhận bình chọn</h2><img src="${esc(t.photo)}" alt=""><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div></div>
      ${S.err ? errMsg(S.err) : ''}
      ${S.offline ? '<div class="msg warn" role="alert"><b>Phiếu CHƯA được ghi nhận.</b> Lựa chọn của bạn đang được giữ trên máy. Hãy bấm gửi lại khi có mạng — hệ thống dùng cùng mã yêu cầu nên sẽ không tạo phiếu trùng.</div>' : '<div class="msg info">Sau khi gửi, phiếu <b>không thể thay đổi</b>.</div>'}
      <div class="stack"><button class="btn gold block" data-act="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? '<span class="spinner"></span>Đang gửi…' : pend ? 'Gửi lại phiếu' : 'Xác nhận bình chọn'}</button>
      <button class="btn ghost block" data-act="rechoose" ${S.busy ? 'disabled' : ''}>Chọn lại</button></div>`;
  },
  success() {
    const rc = S.receipt;
    return `<div class="success"><div class="ringok" aria-hidden="true">✓</div><h1>Phiếu của bạn đã được ghi nhận</h1><p>Bạn đã bình chọn cho <b style="color:var(--ivory)">${esc(rc.teamName)}</b>.</p><p>Mã biên nhận: <span class="receipt">${esc(rc.receipt)}</span></p></div>
      <div class="stack" style="margin-top:14px"><button class="btn block" data-act="follow">Theo dõi kết quả</button></div>`;
  },
  follow() {
    const r = round(); const me = S.myVote;
    const res = S.pub?.results; const hidden = !res && !S.pub?.revealed.length;
    let body = '';
    if (res) {
      body = `<div class="res">${res.rows.map((x) => { const t = teamById(x.teamId); return `<div class="r${me && me.teamId === x.teamId ? ' me' : ''}"><b class="rk">${x.rank}</b><span class="n">${esc(t?.name || '')}</span><span class="v">${fmtNum(x.votes)}</span></div>`; }).join('')}</div><p style="margin-top:10px;font-size:14px">Tổng phiếu hợp lệ: ${fmtNum(res.total)}</p>`;
    } else if (S.pub?.revealed.length) {
      body = `<div class="res">${S.pub.revealed.slice().reverse().map((g) => `<div class="r"><b class="rk">${g.rank}</b><span class="n">${g.teamIds.map((id) => esc(teamById(id)?.name || '')).join(', ')}</span><span class="v">${fmtNum(g.votes)}</span></div>`).join('')}</div>`;
    } else body = infoMsg(r?.status === 'open' ? 'Kết quả đang được giữ kín hoặc chưa công khai. Hãy theo dõi trên màn hình sân khấu.' : 'Kết quả sẽ được công bố trên sân khấu.');
    return `<div class="card"><h2>${me ? 'Bạn đã bình chọn' : 'Trạng thái bình chọn'}</h2>${statusChip()}${timeBlock()}${me ? `<p style="margin-top:10px">Đội bạn chọn: <b style="color:var(--ivory)">${esc(me.teamName)}</b><br>Mã biên nhận: <span class="receipt">${esc(me.receipt)}</span></p>` : ''}${me ? '<p style="font-size:14px">Mỗi người chỉ được một phiếu mỗi vòng, không thể gửi thêm.</p>' : ''}</div>
      <div class="card"><h2>Kết quả</h2>${body}</div>${!me && isOpen() ? '<button class="btn block" data-act="join">Bình chọn ngay</button>' : ''}`;
  },
  closed() {
    return `<div class="card"><h2>Vòng bình chọn đã kết thúc</h2><p>Phiếu gửi sau thời hạn của máy chủ không được tính. Xin cảm ơn bạn đã tham gia!</p></div><button class="btn block ghost" data-act="follow">Xem trạng thái</button>`;
  },
  outofrange() {
    return `<div class="card"><h2>Ngoài khu vực bình chọn</h2>${S.err ? errMsg(S.err) : ''}<p>Hệ thống thấy vị trí của bạn nằm ngoài khu vực được phép. Nếu bạn đang ở hội trường, hãy đến <b>bàn hỗ trợ</b> để được kiểm tra trực tiếp.</p></div><button class="btn block ghost" data-act="getgeo-again">Thử lấy lại vị trí</button>`;
  },
};

function render() {
  const rb = $('#ribbon'); rb.hidden = !S.pub?.demo;
  app.innerHTML = (V[S.view] || V.welcome)();
  if (S.view === 'verify') $('#v_code')?.focus();
}

// ---------- hành vi ----------
async function afterLogin() {
  try { const me = await api('/api/me', { token: S.token }); clock.sync(me.serverNow); S.myVote = me.vote; S.name = me.name; store.set('gdta.name', me.name); }
  catch (e) { if (e.status === 401) { logout(); S.err = e.message; return go('code'); } }
}
function logout() { S.token = null; S.name = null; S.myVote = null; store.del('gdta.token'); store.del('gdta.name'); }
async function nextStep() {
  if (S.myVote) return go('follow');
  if (!isOpen()) return go('closed');
  if (S.pub?.settings.locationEnabled && !geoFresh()) return go('location');
  S.sel = S.sel || (S.pick && teamById(Number(S.pick)) ? Number(S.pick) : null);
  go('pick');
}
const geoFresh = () => S.geo && Date.now() - S.geo.measuredAt < 10 * 60 * 1000;

const GEO_HELP = {
  1: { msg: 'Bạn đã từ chối quyền vị trí.', help: 'Hãy mở <b>Cài đặt trình duyệt → Quyền của trang web → Vị trí → Cho phép</b>, rồi bấm “Thử lại”. Trên iPhone: Cài đặt → Quyền riêng tư → Dịch vụ định vị.' },
  2: { msg: 'Không xác định được vị trí. Hãy bật GPS/Wi-Fi.', help: '' },
  3: { msg: 'Xác định vị trí quá lâu. Hãy thử lại ở nơi thoáng hơn.', help: '' },
};
function measure(timeout = 15000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 2, message: 'Trình duyệt không hỗ trợ định vị.' });
    if (!isSecureContext) return reject({ code: 2, message: 'Trang cần chạy qua HTTPS để dùng vị trí.' });
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, posTs: p.timestamp, measuredAt: Date.now() }), reject, { enableHighAccuracy: true, timeout, maximumAge: 0 });
  });
}
async function getGeo(thenView = 'pick') {
  S.geoBusy = true; S.geoErr = null; render();
  try {
    const g = await measure();
    const max = S.pub?.settings.accuracyMaxM;
    if (max && g.accuracy > max) { S.geo = null; S.geoErr = { msg: `Vị trí chưa đủ chính xác (sai số khoảng ${Math.round(g.accuracy)} m).`, help: 'Hãy bật GPS và Wi-Fi, ra nơi thoáng rồi bấm “Thử lại”.' }; }
    else { S.geo = g; }
  } catch (e) { S.geoErr = GEO_HELP[e.code] || { msg: e.message || 'Không lấy được vị trí.', help: '' }; }
  S.geoBusy = false;
  if (S.geo) { S.sel = S.sel || (S.pick && teamById(Number(S.pick)) ? Number(S.pick) : null); return go(thenView); }
  render();
}

async function submit() {
  if (S.busy) return;
  S.busy = true; S.err = null; render();
  try {
    if (!S.pending || S.pending.teamId !== S.sel || S.pending.roundId !== round()?.id) { S.pending = { teamId: S.sel, roundId: round()?.id, idemKey: uuid() }; store.set('gdta.pending', S.pending); }
    let geo;
    if (S.pub?.settings.locationEnabled) {
      if (!S.geo || Date.now() - S.geo.measuredAt > 45000) { S.geo = await measure().catch((e) => { throw Object.assign(new Error((GEO_HELP[e.code] || {}).msg || e.message), { geoFail: true }); }); }
      geo = { lat: S.geo.lat, lng: S.geo.lng, accuracy: S.geo.accuracy, ageMs: Math.max(0, Date.now() - S.geo.posTs) };
    }
    const r = await api('/api/vote', { method: 'POST', token: S.token, body: { roundId: S.pending.roundId, teamId: S.pending.teamId, idemKey: S.pending.idemKey, geo } });
    // chỉ báo thành công SAU khi máy chủ xác nhận
    S.receipt = r.receipt; S.myVote = { receipt: r.receipt.receipt, teamId: r.receipt.teamId, teamName: r.receipt.teamName };
    S.pending = null; store.del('gdta.pending'); S.offline = false; S.busy = false;
    if (S.prefs.sound) ting(); if (S.prefs.vib) navigator.vibrate?.([60]);
    return go('success');
  } catch (e) {
    S.busy = false;
    if (e.network) { S.offline = true; S.err = 'Mất kết nối hoặc mạng quá chậm — phiếu chưa được xác nhận.'; return render(); }
    S.offline = false;
    if (e.geoFail) { S.geoErr = { msg: e.message, help: '' }; S.geo = null; return go('location'); }
    switch (e.code) {
      case 'ALREADY_VOTED': { const rc = e.data?.receipt; S.myVote = rc ? { receipt: rc.receipt, teamId: rc.teamId, teamName: rc.teamName } : S.myVote; S.pending = null; store.del('gdta.pending'); return go('follow'); }
      case 'ROUND_CLOSED': case 'NOT_OPEN': S.pending = null; store.del('gdta.pending'); return go('closed');
      case 'UNAUTHORIZED': logout(); S.err = e.message; return go('code');
      case 'OUT_OF_RANGE': S.err = e.message; return go('outofrange');
      case 'GPS_REQUIRED': case 'GPS_INVALID': case 'GPS_STALE': case 'GPS_INACCURATE': S.geo = null; S.geoErr = { msg: e.message, help: 'Hãy bấm “Thử lại” để lấy vị trí mới.' }; return go('location');
      case 'ROUND_CHANGED': S.pending = null; store.del('gdta.pending'); await poll(true); return go('welcome');
      default: S.err = e.message; return render();
    }
  }
}

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-stop]')) return; // liên kết "Xem chi tiết"
  const el = e.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'join') { if (S.token) { if (!S.name) await afterLogin(); return nextStep(); } return go('code'); }
  if (act === 'back') return go('welcome');
  if (act === 'follow') return go('follow');
  if (act === 'nameok') return nextStep();
  if (act === 'editinfo') return go('code');
  if (act === 'resend') return doRegister(true);
  if (act === 'notme') { logout(); S.codeDraft = ''; return go('code'); }
  if (act === 'getgeo' || act === 'getgeo-again') return getGeo(act === 'getgeo-again' ? 'pick' : 'pick');
  if (act === 'select') { S.sel = Number(el.dataset.id); return render(); }
  if (act === 'topick') return go('confirm');
  if (act === 'rechoose') { if (S.pending) { S.pending = null; store.del('gdta.pending'); } S.offline = false; return go('pick'); }
  if (act === 'submit') return submit();
});
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('.tcard')) { e.preventDefault(); e.target.click(); } });
async function doCheckin(code) {
  if (S.busy) return;
  S.busy = true; S.err = null; render();
  try {
    const r = await api('/api/checkin', { method: 'POST', body: { code } });
    S.token = r.token; S.name = r.name; store.set('gdta.token', r.token); store.set('gdta.name', r.name);
    S.busy = false; await afterLogin(); go(S.myVote ? 'follow' : 'confirmName');
  } catch (err) { S.busy = false; S.err = err.message; S.view = 'code'; render(); }
}
async function doRegister(resend = false) {
  if (S.busy) return;
  if (!resend) { const v = (id) => $(id)?.value ?? ''; S.reg = { ...S.reg, name: v('#r_name'), mssv: v('#r_mssv'), phone: v('#r_phone'), email: v('#r_email') }; }
  S.busy = true; S.err = null; S.info = null; render();
  try {
    const r = await api('/api/register', { method: 'POST', body: { name: S.reg.name, mssv: S.reg.mssv, phone: S.reg.phone, email: S.reg.email }, timeout: 25000 });
    S.reg.emailMasked = r.email; S.busy = false;
    if (resend) { S.view = 'verify'; S.info = 'Đã gửi lại mã vào Gmail của bạn.'; render(); } else go('verify');
  } catch (err) { S.busy = false; S.err = err.message; S.view = resend ? 'verify' : 'code'; render(); }
}
async function doVerify() {
  if (S.busy) return;
  const code = ($('#v_code')?.value || '').replace(/\D/g, '');
  if (code.length !== 6) { S.err = 'Vui lòng nhập đủ 6 số.'; S.info = null; return render(); }
  S.busy = true; S.err = null; S.info = null; render();
  try {
    const r = await api('/api/verify', { method: 'POST', body: { email: S.reg.email, code } });
    S.token = r.token; S.name = r.name; store.set('gdta.token', r.token); store.set('gdta.name', r.name);
    S.busy = false; await afterLogin(); await nextStep();
  } catch (err) { S.busy = false; S.err = err.message; S.view = 'verify'; render(); }
}
document.addEventListener('submit', (e) => {
  if (e.target.id === 'regForm') { e.preventDefault(); doRegister(); }
  else if (e.target.id === 'verifyForm') { e.preventDefault(); doVerify(); }
});
addEventListener('online', () => { if (S.view === 'confirm' && S.offline && S.pending) submit(); });

// ---------- đồng bộ trạng thái công khai ----------
async function poll(force = false) {
  try {
    const s = await api(`/api/public/state${!force && S.pub ? `?v=${S.pub.version}` : ''}`, { timeout: 8000 });
    clock.sync(s.serverNow);
    if (!s.unchanged && (!S.pub || s.version >= S.pub.version)) {
      const prevRound = S.pub?.round?.id;
      S.pub = s;
      if (prevRound !== undefined && prevRound !== s.round?.id && S.token) { S.myVote = null; afterLogin().then(() => render()); }
      if (S.view === 'welcome' || S.view === 'follow' || S.view === 'pick') render();
      // nếu vòng hết giờ khi đang chọn -> báo ngay
      if (['pick', 'confirm'].includes(S.view) && !isOpen() && !S.myVote) { go('closed'); }
    }
  } catch { /* mất mạng tạm thời: giữ nguyên màn hình */ }
}
setInterval(() => { poll(); }, 4000);
setInterval(() => { const el = $('#tleft'); const r = round(); if (el && r) el.textContent = fmtClock(r.closesAt - clock.now()); if (r && ['pick', 'confirm', 'welcome'].includes(S.view) && r.status === 'open' && clock.now() >= r.closesAt && !S.busy) { if (S.view !== 'welcome') go('closed'); else render(); } }, 500);

// Không dùng top-level await để chạy được trên trình duyệt điện thoại/Zalo/Facebook cũ.
async function main() {
  await poll(true);
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) { history.replaceState(null, '', location.pathname + (S.pick ? `?pick=${encodeURIComponent(S.pick)}` : '')); }
  if (S.token) await afterLogin();
  if (urlCode) { S.codeDraft = urlCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); S.codeDraft = S.codeDraft.length > 5 ? `${S.codeDraft.slice(0, 5)}-${S.codeDraft.slice(5)}` : S.codeDraft; await doCheckin(S.codeDraft); }
  else if (S.pick && S.token && S.name && !S.myVote && isOpen()) { await nextStep(); } else render();
}
main().catch((e) => { console.error(e); const a = document.getElementById('app'); if (a) a.innerHTML = '<div class="card"><h2>Không tải được trang</h2><p>Vui lòng tải lại trang. Nếu vẫn lỗi, hãy mở bằng Chrome hoặc Safari.</p></div>'; });
