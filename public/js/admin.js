import { $, $$, esc, fmtNum, fmtClock, fmtTime, api } from './common.js';

const A = { me: null, tab: 'stage', ov: null, rounds: [], teams: [], atts: [], settings: null, audit: [], newCodes: null, timer: null, selRound: null, filter: '' };
const root = $('#root');
const TABS = [['stage', 'Sân khấu'], ['rounds', 'Vòng bình chọn'], ['teams', 'Đội'], ['people', 'Người tham dự'], ['settings', 'Cài đặt'], ['log', 'Nhật ký & xuất dữ liệu']];
const OPERATOR_TABS = ['stage'];

function toast(msg, err = false) {
  const d = document.createElement('div'); if (err) d.className = 'err'; d.textContent = msg; $('#toast').appendChild(d); setTimeout(() => d.remove(), err ? 6000 : 2800);
}
async function call(path, method = 'GET', body) {
  try { return await api(path, { method, body }); }
  catch (e) { if (e.status === 401 && A.me) { A.me = null; renderLogin(); } toast(e.message, true); throw e; }
}
const post = (p, b) => call(p, 'POST', b);

// ---------- đăng nhập ----------
function renderLogin(msg = '') {
  clearInterval(A.timer);
  root.innerHTML = `<div class="login panel"><img src="/brand/logo-itgt.png" alt=""><h2>Quản trị bình chọn</h2><p class="muted">Vòng Chung Kết · 15/11/2026</p>${msg ? `<div class="warns">${esc(msg)}</div>` : ''}
    <form id="lf"><div class="row" style="justify-content:center"><input type="password" id="pw" placeholder="Mật khẩu" autocomplete="current-password" style="width:100%" required autofocus></div><button class="b pri" style="width:100%;margin-top:8px">Đăng nhập</button></form></div>`;
  $('#lf').onsubmit = async (e) => { e.preventDefault(); try { await post('/api/admin/login', { password: $('#pw').value }); boot(); } catch { /* đã báo */ } };
}

// ---------- khung ----------
async function boot() {
  try { A.me = await api('/api/admin/me'); } catch { return renderLogin(); }
  if (!OPERATOR_TABS.includes(A.tab) && A.me.role !== 'admin') A.tab = 'stage';
  shell();
}
function shell() {
  const tabs = TABS.filter(([k]) => A.me.role === 'admin' || OPERATOR_TABS.includes(k));
  root.innerHTML = `<div class="bar"><img src="/brand/logo-itgt.png" alt=""><div><div class="t">Quản trị · Vòng Chung Kết 15/11/2026</div><div class="muted">Vai trò: ${A.me.role === 'admin' ? 'Quản trị viên' : 'Vận hành sân khấu'}</div></div>${A.me.demo ? '<span class="badge demo">CHẾ ĐỘ MÔ PHỎNG</span>' : '<span class="badge ok">DỮ LIỆU THẬT</span>'}
    <div class="sp"></div><a class="b" href="/">← Trang tổng</a><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-current="${A.tab === k}">${l}</button>`).join('')}</div><button class="b" id="logout">Đăng xuất</button></div><div id="main"></div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => { A.tab = b.dataset.tab; shell(); }));
  $('#logout').onclick = async () => { await post('/api/admin/logout'); A.me = null; renderLogin(); };
  clearInterval(A.timer);
  ({ stage: tabStage, rounds: tabRounds, teams: tabTeams, people: tabPeople, settings: tabSettings, log: tabLog })[A.tab]();
}

// ---------- SÂN KHẤU ----------
async function tabStage() {
  const m = $('#main');
  const rounds = await call('/api/admin/rounds'); A.rounds = rounds;
  m.innerHTML = `<div id="warns"></div><div class="grid"><div>
    <div class="panel"><h3>Xem trước màn hình LED (/screen)</h3><div class="preview" id="pv"><iframe src="/screen?preview=1" title="Xem trước LED"></iframe></div>
      <div class="row"><a class="b" id="ledlink" target="_blank" rel="noopener">Mở /screen cho máy nối LED ↗</a><button class="b" id="copyled">Sao chép link LED (có khóa âm thanh)</button><a class="b" href="/api/qr.svg" target="_blank">Xem mã QR ↗</a></div>
      <div class="muted">Mở link LED trên máy nối LED, bấm F để toàn màn hình, bấm “Kích hoạt âm thanh” một lần. Chỉ tab đó phát âm thanh.</div></div>
    <div class="panel"><h3>Kiểm đếm thật (đối soát — không phụ thuộc trạng thái giữ kín)</h3><div id="counts"></div></div>
    <div id="demoPanel"></div></div>
  <div>
    <div class="panel"><h3>Vòng bình chọn</h3><div id="roundInfo"></div>
      <div class="row"><select id="selRound"></select><label>Thời lượng (giây)</label><input id="dur" type="number" min="10" style="width:90px"></div>
      <div class="row"><button class="b pri" data-a="open">▶ Mở vòng</button><button class="b" data-a="ext60">+1 phút</button><button class="b" data-a="ext300">+5 phút</button><button class="b dng" data-a="close">■ Đóng ngay</button></div>
      <div class="row"><button class="b gold" data-a="lock">🔒 Khóa kết quả</button>${A.me.role === 'admin' ? '<button class="b" data-a="unlock">Mở khóa (có lý do)</button>' : ''}</div></div>
    <div class="panel"><h3>Công bố giải</h3><div id="revealInfo"></div><div class="row"><button class="b gold" data-a="rnext">Công bố tiếp ▶</button><button class="b" data-a="rprev">◀ Lùi</button><button class="b pri" data-a="rfinal">Tổng kết</button></div></div>
    <div class="panel"><h3>Hiển thị trên LED</h3><div class="row"><button class="b" data-a="hide">Giữ kín kết quả</button><button class="b" data-a="show">Hiện kết quả trực tiếp</button><button class="b" data-a="idle">Chế độ chờ (giới thiệu đội)</button></div>
      <div class="row"><input id="notice" maxlength="200" placeholder="Thông báo hiện trên LED/điện thoại" style="flex:1;min-width:200px"><button class="b" data-a="notice">Gửi</button><button class="b" data-a="noticeclr">Xóa</button></div>
      <div class="row"><button class="b" id="fxBtn" data-a="fx">Giảm hiệu ứng</button><button class="b dng" id="emBtn" data-a="emergency">⚠ Chế độ khẩn cấp</button></div></div>
    <div class="panel"><h3>Âm thanh sân khấu</h3><div class="muted" id="audioOwner"></div>
      <div class="row"><button class="b" data-a="aen" id="aen">Bật âm thanh sân khấu</button><button class="b dng" data-a="amute" id="amute">Tắt tiếng tức thì</button><button class="b" data-a="aduck" id="aduck">MC đang nói (giảm nhạc)</button><button class="b" data-a="amusic" id="amusic">Nhạc nền</button><button class="b" data-a="acd" id="acd">Đếm ngược 10 giây</button></div>
      <div class="row"><label>Tổng</label><input type="range" min="0" max="1" step="0.05" data-vol="master"><label>Nhạc nền</label><input type="range" min="0" max="1" step="0.05" data-vol="music"><label>Hiệu ứng</label><input type="range" min="0" max="1" step="0.05" data-vol="fx"></div>
      <div class="row">${[['open', 'Mở vòng'], ['whoosh', 'Vượt hạng'], ['leader', 'Đổi ngôi đầu'], ['close', 'Chốt'], ['place4', 'Hạng tư'], ['place3', 'Hạng ba'], ['place2', 'Hạng nhì'], ['place1', 'Hạng nhất'], ['test', 'Thử âm'], ['stop', '■ Dừng']].map(([k, l]) => `<button class="b" data-cue="${k}">${l}</button>`).join('')}</div>
      <div class="muted">Âm thanh tổng hợp chỉ để demo. Thay bằng file có bản quyền: đặt vào <code>public/audio/&lt;cue&gt;.mp3</code>.</div></div>
  </div></div>`;
  const fit = () => { const pv = $('#pv'); if (pv) $('iframe', pv).style.transform = `scale(${pv.clientWidth / 1920})`; };
  fit(); addEventListener('resize', fit);
  const led = `/screen?key=${encodeURIComponent(A.me.screenKey)}`; $('#ledlink').href = led;
  $('#copyled').onclick = () => navigator.clipboard?.writeText(new URL(led, location.origin).href).then(() => toast('Đã sao chép link LED.'));
  m.onclick = onStageClick;
  $$('[data-vol]').forEach((r) => (r.oninput = () => post('/api/admin/audio', { [r.dataset.vol]: Number(r.value) })));
  await refreshStage();
  A.timer = setInterval(refreshStage, 1500);
}
function fmtRoundStatus(r) { if (!r) return 'Chưa chọn vòng.'; const st = { draft: 'Nháp', open: 'ĐANG MỞ', closed: 'Đã đóng' }[r.effectiveStatus || r.status]; return `${esc(r.name)} — <b>${st}</b>${r.locked ? ' · <span class="badge ok">ĐÃ KHÓA</span>' : ''}`; }
async function refreshStage() {
  let ov; try { ov = await api('/api/admin/overview'); } catch { return; }
  if (!$('#counts')) return;
  A.ov = ov; const off = ov.serverNow - Date.now();
  $('#warns').innerHTML = ov.warnings.length ? `<ul class="warns">${ov.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
  const r = ov.round; const rem = r && r.effectiveStatus === 'open' ? r.closesAt - (Date.now() + off) : null;
  $('#roundInfo').innerHTML = `${fmtRoundStatus(r)}${rem !== null ? `<div class="big">${fmtClock(rem)}</div>` : ''}<div class="muted">Hiển thị LED: <b>${ov.display.mode}</b> · phiếu hợp lệ: <b>${fmtNum(ov.totals.votes)}</b> · người tham dự: ${fmtNum(ov.totals.active)}</div>`;
  const sel = $('#selRound'); const drafts = A.rounds.filter((x) => x.status === 'draft');
  const keep = sel.value;
  sel.innerHTML = A.rounds.map((x) => `<option value="${x.id}">${esc(x.name)} (${{ draft: 'nháp', open: 'mở', closed: 'đóng' }[x.status]})</option>`).join('');
  sel.value = keep || (r ? String(r.id) : drafts[0] ? String(drafts[0].id) : '');
  if (!$('#dur').value) { const cur = A.rounds.find((x) => String(x.id) === sel.value); if (cur) $('#dur').value = cur.durationSec; }
  sel.onchange = () => { const cur = A.rounds.find((x) => String(x.id) === sel.value); if (cur) $('#dur').value = cur.durationSec; };
  const maxV = Math.max(1, ...ov.realCounts.map((x) => x.votes));
  $('#counts').innerHTML = `<table><tr><th>Hạng</th><th>Đội</th><th class="n">Phiếu</th><th></th></tr>${ov.realCounts.map((x) => `<tr><td>${x.rank}${x.tie ? ' <span class="badge warn">đồng hạng</span>' : ''}</td><td>${esc(x.team.code)} · ${esc(x.team.name)}</td><td class="n">${fmtNum(x.votes)}</td><td style="width:35%"><div style="height:8px;border-radius:6px;background:linear-gradient(90deg,var(--cyan),var(--violet));width:${(x.votes / maxV) * 100}%"></div></td></tr>`).join('')}</table><div class="muted" style="margin-top:6px">Tổng: <b>${fmtNum(ov.totals.votes)}</b> phiếu hợp lệ</div>`;
  const nr = ov.nextReveal;
  $('#revealInfo').innerHTML = `Đã công bố ${ov.display.revealStep}/${ov.display.revealTotal} hạng.${nr ? `<div style="margin-top:6px">Sắp công bố: <b>Hạng ${nr.rank}</b> — ${nr.teams.map((t) => esc(t.name)).join(', ')} (${fmtNum(nr.votes)} phiếu)</div>` : ''}`;
  const au = ov.audio;
  $('#audioOwner').textContent = au.ownerId ? 'Đã có máy phát âm thanh sân khấu (tab LED đã kích hoạt).' : 'Chưa có máy nào kích hoạt âm thanh. Mở link LED có khóa và bấm “Kích hoạt âm thanh”.';
  const setOn = (id, on) => $(id).classList.toggle('on', !!on);
  setOn('#aen', au.enabled); setOn('#amute', au.muted); setOn('#aduck', au.ducked); setOn('#amusic', au.musicOn); setOn('#acd', ov.display.countdownArmed);
  $('#fxBtn').classList.toggle('on', ov.display.reduceFx); $('#emBtn').classList.toggle('on', ov.display.emergency);
  $$('[data-vol]').forEach((r2) => { if (document.activeElement !== r2) r2.value = au[r2.dataset.vol]; });
  const dp = $('#demoPanel');
  if (ov.demo && !dp.innerHTML) { dp.innerHTML = `<div class="panel"><h3>Mô phỏng (chỉ có ở chế độ demo)</h3><div class="row"><button class="b" data-a="sim10">+10 phiếu mô phỏng</button><button class="b" data-a="sim50">+50</button><button class="b pri" data-a="autoon">Tự động chạy đua</button><button class="b" data-a="autooff">Dừng</button></div><div class="muted">Phiếu mô phỏng nằm trong CSDL demo riêng, có nhãn MÔ PHỎNG, không lẫn dữ liệu thật. Mã khán giả demo: DEMO0001…DEMO0010 (dùng ở /vote).</div></div>`; }
}
async function onStageClick(e) {
  const cue = e.target.closest('[data-cue]'); if (cue) return post('/api/admin/cue', { name: cue.dataset.cue }).catch(() => {});
  const b = e.target.closest('[data-a]'); if (!b) return;
  const id = Number($('#selRound').value); const a = b.dataset.a; const ov = A.ov;
  const cid = ov?.round?.id ?? id;
  const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); refreshStage(); } catch { /* đã báo */ } };
  switch (a) {
    case 'open': if (!id) return toast('Chưa chọn vòng.', true); if (!confirm('Mở vòng bình chọn ngay bây giờ?')) return; return run(() => post(`/api/admin/rounds/${id}/open`, { durationSec: Number($('#dur').value) || undefined }), 'Đã mở vòng.');
    case 'ext60': return run(() => post(`/api/admin/rounds/${cid}/extend`, { seconds: 60, reason: 'vận hành' }), 'Đã gia hạn +1 phút.');
    case 'ext300': return run(() => post(`/api/admin/rounds/${cid}/extend`, { seconds: 300, reason: 'vận hành' }), 'Đã gia hạn +5 phút.');
    case 'close': if (!confirm('Đóng vòng ngay? Phiếu gửi sau thời điểm này sẽ không được nhận.')) return; return run(() => post(`/api/admin/rounds/${cid}/close`), 'Đã đóng vòng.');
    case 'lock': if (!confirm('Khóa kết quả? Hãy đối soát tổng phiếu trước.')) return; return run(() => post(`/api/admin/rounds/${cid}/lock`), 'Đã khóa kết quả.');
    case 'unlock': { const reason = prompt('Lý do mở khóa (bắt buộc, ghi vào nhật ký):'); if (!reason) return; return run(() => post(`/api/admin/rounds/${cid}/unlock`, { reason }), 'Đã mở khóa.'); }
    case 'rnext': return run(() => post('/api/admin/reveal/next'), 'Đã công bố.');
    case 'rprev': return run(() => post('/api/admin/reveal/prev'));
    case 'rfinal': return run(() => post('/api/admin/reveal/final'), 'Đã chuyển sang tổng kết.');
    case 'hide': return run(() => post('/api/admin/display/mode', { mode: 'hidden' }));
    case 'show': return run(() => post('/api/admin/display/mode', { mode: 'live' }));
    case 'idle': return run(() => post('/api/admin/display/mode', { mode: 'idle' }));
    case 'notice': return run(() => post('/api/admin/display/flags', { notice: $('#notice').value }), 'Đã gửi thông báo.');
    case 'noticeclr': $('#notice').value = ''; return run(() => post('/api/admin/display/flags', { notice: '' }));
    case 'fx': return run(() => post('/api/admin/display/flags', { reduceFx: !ov.display.reduceFx }));
    case 'emergency': if (!ov.display.emergency && !confirm('Bật chế độ khẩn cấp? LED sẽ hiện thông báo tạm dừng.')) return; return run(() => post('/api/admin/display/flags', { emergency: !ov.display.emergency }));
    case 'aen': return run(() => post('/api/admin/audio', { enabled: !ov.audio.enabled }));
    case 'amute': return run(() => post('/api/admin/audio', { muted: !ov.audio.muted }));
    case 'aduck': return run(() => post('/api/admin/audio', { ducked: !ov.audio.ducked }));
    case 'amusic': return run(() => post('/api/admin/audio', { musicOn: !ov.audio.musicOn }));
    case 'acd': return run(() => post('/api/admin/display/flags', { countdownArmed: !ov.display.countdownArmed }));
    case 'sim10': return run(() => post('/api/admin/demo/simulate', { count: 10 }));
    case 'sim50': return run(() => post('/api/admin/demo/simulate', { count: 50 }));
    case 'autoon': return run(() => post('/api/admin/demo/auto', { on: true }), 'Đang tự động chạy đua.');
    case 'autooff': return run(() => post('/api/admin/demo/auto', { on: false }));
  }
}

// ---------- VÒNG ----------
async function tabRounds() {
  const [rounds, teams] = await Promise.all([call('/api/admin/rounds'), call('/api/admin/teams')]);
  const m = $('#main');
  m.innerHTML = `<div class="panel"><h3>Tạo vòng mới</h3><div class="row"><input id="rn" placeholder="Tên vòng, ví dụ: Vòng Chung Kết 15/11/2026" style="min-width:320px"><label>Thời lượng (giây)</label><input id="rd" type="number" value="600" style="width:90px"><label>Giữ kín N giây cuối</label><input id="rh" type="number" value="0" style="width:80px"><label>Số hạng công bố</label><input id="rp" type="number" value="4" min="1" max="10" style="width:70px"><button class="b pri" id="rc">Tạo vòng</button></div>
    <div class="muted">Vòng phụ khi đồng phiếu: tạo vòng mới và chỉ tích các đội đồng hạng (sửa danh sách đội trong vòng nháp).</div></div>
    <div class="panel"><table><tr><th>ID</th><th>Tên</th><th>Trạng thái</th><th>Thời lượng</th><th>Giữ kín</th><th>Đội tham gia</th><th></th></tr>${rounds.map((r) => `<tr data-r="${r.id}"><td>${r.id}</td><td>${esc(r.name)}</td><td>${{ draft: 'Nháp', open: 'Đang mở', closed: 'Đã đóng' }[r.status]}${r.locked ? ' 🔒' : ''}</td><td>${r.durationSec}s</td><td>${r.hideLastSec}s</td><td>${r.teamIds ? r.teamIds.length + ' đội chọn' : 'Tất cả đội tham gia'}</td><td>${r.status === 'draft' ? `<button class="b" data-edit="${r.id}">Sửa</button><button class="b dng" data-del="${r.id}">Xóa</button>` : `<button class="b" data-ren="${r.id}">Đổi tên</button>`}</td></tr>`).join('')}</table></div><div id="editor"></div>`;
  $('#rc').onclick = async () => { await post('/api/admin/rounds', { name: $('#rn').value || 'Vòng mới', durationSec: Number($('#rd').value), hideLastSec: Number($('#rh').value), revealPlaces: Number($('#rp').value) }); toast('Đã tạo vòng.'); tabRounds(); };
  m.onclick = async (e) => {
    const del = e.target.closest('[data-del]'); if (del && confirm('Xóa vòng nháp này?')) { await call(`/api/admin/rounds/${del.dataset.del}`, 'DELETE'); return tabRounds(); }
    const ren = e.target.closest('[data-ren]'); if (ren) { const n = prompt('Tên mới'); if (n) { await call(`/api/admin/rounds/${ren.dataset.ren}`, 'PUT', { name: n }); tabRounds(); } return; }
    const ed = e.target.closest('[data-edit]'); if (!ed) return;
    const r = rounds.find((x) => x.id === Number(ed.dataset.edit));
    $('#editor').innerHTML = `<div class="panel"><h3>Sửa vòng #${r.id}</h3><div class="row"><input id="en" value="${esc(r.name)}" style="min-width:300px"><label>Thời lượng (giây)</label><input id="ed" type="number" value="${r.durationSec}" style="width:90px"><label>Giữ kín (giây)</label><input id="eh" type="number" value="${r.hideLastSec}" style="width:80px"><label>Số hạng công bố</label><input id="ep" type="number" value="${r.revealPlaces}" style="width:70px"></div>
      <div class="row"><label><input type="checkbox" id="eall" ${r.teamIds ? '' : 'checked'}> Tất cả đội đang tham gia</label></div><div class="row" id="eteams">${teams.filter((t) => t.active).map((t) => `<label><input type="checkbox" data-t="${t.id}" ${r.teamIds?.includes(t.id) ? 'checked' : ''}> ${esc(t.code)} ${esc(t.name)}</label>`).join(' ')}</div><button class="b pri" id="esave">Lưu</button></div>`;
    $('#esave').onclick = async () => { const ids = $('#eall').checked ? null : $$('#eteams [data-t]').filter((c) => c.checked).map((c) => Number(c.dataset.t)); await call(`/api/admin/rounds/${r.id}`, 'PUT', { name: $('#en').value, durationSec: Number($('#ed').value), hideLastSec: Number($('#eh').value), revealPlaces: Number($('#ep').value), teamIds: ids }); toast('Đã lưu.'); tabRounds(); };
  };
}

// ---------- ĐỘI ----------
async function tabTeams() {
  A.teams = await call('/api/admin/teams');
  const m = $('#main');
  const card = (t) => `<div class="tc" data-id="${t.id}"><img class="pv" src="${esc(t.photo)}" alt="">${t.isSample ? '<span class="badge warn">DỮ LIỆU MẪU</span>' : ''}
    <div class="f"><label>Mã đội</label><input data-k="code" value="${esc(t.code)}"></div><div class="f"><label>Tên đội</label><input data-k="name" value="${esc(t.name)}"></div>
    <div class="f"><label>Tên tiết mục</label><input data-k="perfTitle" value="${esc(t.perfTitle)}"></div><div class="f"><label>Thể loại</label><input data-k="genre" value="${esc(t.genre)}"></div>
    <div class="f"><label>Số thành viên</label><input data-k="members" type="number" min="0" value="${t.members}"></div><div class="f"><label>Giới thiệu ngắn</label><textarea data-k="bio">${esc(t.bio)}</textarea></div>
    <div class="row"><label>Ảnh đại diện <input type="file" accept="image/png,image/jpeg,image/webp" data-up="avatarUrl"></label></div><div class="row"><label>Ảnh biểu diễn <input type="file" accept="image/png,image/jpeg,image/webp" data-up="photoUrl"></label></div>
    <div class="row"><label>Thư viện (tối đa 3) <input type="file" accept="image/png,image/jpeg,image/webp" multiple data-up="gallery"></label></div><div class="thumbs">${t.gallery.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>
    <div class="row"><label><input type="checkbox" data-k="active" ${t.active ? 'checked' : ''}> Tham gia vòng bình chọn</label></div>
    <div class="row"><button class="b pri" data-save>Lưu</button><button class="b" data-mv="-1">↑</button><button class="b" data-mv="1">↓</button><button class="b dng" data-rm>Xóa</button></div></div>`;
  m.innerHTML = `<div class="panel"><h3>Thêm đội</h3><div class="row"><input id="nc" placeholder="Mã đội (T07)" style="width:110px"><input id="nn" placeholder="Tên đội" style="min-width:220px"><input id="np" placeholder="Tên tiết mục" style="min-width:220px"><button class="b pri" id="nadd">Thêm</button></div><div class="muted">Ảnh chưa có sẽ dùng ảnh thay thế nhất quán theo mã đội. Thứ tự hiển thị theo số thứ tự (nút ↑ ↓), không ưu tiên đội dẫn đầu.</div></div><div class="cards">${A.teams.map(card).join('')}</div>`;
  $('#nadd').onclick = async () => { await post('/api/admin/teams', { code: $('#nc').value, name: $('#nn').value, perfTitle: $('#np').value }); toast('Đã thêm đội.'); tabTeams(); };
  m.onclick = async (e) => {
    const c = e.target.closest('.tc'); if (!c) return; const id = Number(c.dataset.id);
    if (e.target.closest('[data-save]')) {
      const body = {}; $$('[data-k]', c).forEach((i) => { body[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? Number(i.value) : i.value; });
      await call(`/api/admin/teams/${id}`, 'PUT', body); toast('Đã lưu.'); return tabTeams();
    }
    if (e.target.closest('[data-rm]')) { if (confirm('Xóa đội này?')) { await call(`/api/admin/teams/${id}`, 'DELETE'); tabTeams(); } return; }
    const mv = e.target.closest('[data-mv]');
    if (mv) { const ids = A.teams.map((t) => t.id); const i = ids.indexOf(id); const j = i + Number(mv.dataset.mv); if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; await post('/api/admin/teams/reorder', { ids }); tabTeams(); }
  };
  m.onchange = async (e) => {
    const f = e.target.closest('[data-up]'); if (!f || !f.files.length) return;
    const c = f.closest('.tc'); const id = Number(c.dataset.id); const key = f.dataset.up;
    try {
      const urls = [];
      for (const file of [...f.files].slice(0, 3)) { const r = await api('/api/admin/upload', { method: 'POST', body: file, raw: true, headers: { 'Content-Type': file.type } }); urls.push(r.url); }
      await call(`/api/admin/teams/${id}`, 'PUT', key === 'gallery' ? { gallery: urls } : { [key]: urls[0] }); toast('Đã tải ảnh lên.'); tabTeams();
    } catch { /* đã báo */ }
  };
}

// ---------- NGƯỜI THAM DỰ ----------
async function tabPeople() {
  A.atts = await call('/api/admin/attendees');
  const m = $('#main');
  const rows = A.atts.filter((a) => !A.filter || [a.name, a.mssv, a.phone, a.email].some((x) => (x || '').toLowerCase().includes(A.filter.toLowerCase())));
  m.innerHTML = `<div class="grid"><div><div class="panel"><h3>Cấp mã check-in</h3>
    <div class="row"><input id="an" placeholder="Họ tên một người" style="min-width:240px"><button class="b pri" id="aadd">Cấp mã</button></div>
    <div class="row"><label>Hoặc nhập danh sách (mỗi dòng một họ tên, hoặc CSV cột đầu là họ tên)</label></div><textarea id="acsv" placeholder="Nguyễn Văn A&#10;Trần Thị B"></textarea>
    <div class="row"><input type="file" id="afile" accept=".csv,.txt"><button class="b pri" id="aimp">Nhập & cấp mã</button></div>
    <div class="muted">Mã được tạo ngẫu nhiên (10 ký tự), CSDL chỉ lưu bản băm. <b>Mã chỉ hiện MỘT lần</b> ngay sau khi tạo — hãy tải CSV/in ngay. Mã chỉ chứng minh quyền dùng vé, không xác minh danh tính tuyệt đối.</div></div>
    <div id="newcodes"></div></div>
    <div><div class="panel"><h3>Danh sách (${A.atts.length})</h3><div class="row"><input id="afil" placeholder="Tìm theo tên / MSSV / SĐT / Gmail" value="${esc(A.filter)}" style="min-width:260px"> <button class="b gold" id="aexp">Tải danh sách CSV</button></div><div style="max-height:620px;overflow:auto"><table><tr><th>ID</th><th>Tên</th><th>MSSV</th><th>SĐT</th><th>Gmail</th><th>Trạng thái</th><th>Đã bình chọn</th><th></th></tr>${rows.slice(0, 400).map((a) => `<tr data-id="${a.id}"><td>${a.id}</td><td>${esc(a.name)}${a.simulated ? ' <span class="badge demo">MÔ PHỎNG</span>' : ''}${a.geoException ? ' <span class="badge warn" title="' + esc(a.note) + '">ngoại lệ vị trí</span>' : ''}</td><td>${esc(a.mssv || '')}</td><td>${esc(a.phone || '')}</td><td>${esc(a.email || '')}</td><td>${a.status === 'active' ? 'Hoạt động' : '<b>Đã thu hồi</b>'}</td><td>${a.voted ? '✓' : ''}</td><td><button class="b" data-regen>Cấp lại mã</button> <button class="b" data-rev>${a.status === 'active' ? 'Thu hồi' : 'Khôi phục'}</button> <button class="b" data-geo>${a.geoException ? 'Bỏ ngoại lệ' : 'Ngoại lệ vị trí'}</button></td></tr>`).join('')}</table></div></div></div></div>`;
  const showCodes = (list) => {
    A.newCodes = list;
    $('#newcodes').innerHTML = `<div class="panel" id="printable"><h3>Mã vừa tạo — chỉ hiện một lần</h3><div class="row"><button class="b gold" id="dl">Tải CSV</button><button class="b" id="pr">In</button></div><table class="codes"><tr><th>Họ tên</th><th>Mã</th></tr>${list.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.code)}</td></tr>`).join('')}</table></div>`;
    $('#dl').onclick = () => { const csv = '﻿Họ tên,Mã tham dự\r\n' + list.map((x) => `"${x.name.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}",${x.code}`).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'ma-tham-du.csv'; a.click(); };
    $('#pr').onclick = () => print();
  };
  if (A.newCodes) showCodes(A.newCodes);
  $('#aadd').onclick = async () => { if (!$('#an').value.trim()) return; const r = await post('/api/admin/attendees', { names: [$('#an').value] }); showCodes(r.created); const t = await call('/api/admin/attendees'); A.atts = t; toast('Đã cấp mã.'); };
  $('#aimp').onclick = async () => { const csv = $('#acsv').value; if (!csv.trim()) return; const r = await post('/api/admin/attendees', { csv }); toast(`Đã cấp ${r.created.length} mã.`); A.newCodes = r.created; tabPeople(); };
  $('#aexp').onclick = () => { const q = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`; const csv = '\ufeffID,Họ tên,MSSV,SĐT,Gmail,Trạng thái,Đã bình chọn vòng hiện tại\r\n' + A.atts.filter((a) => !a.simulated).map((a) => [a.id, a.name, a.mssv, a.phone, a.email, a.status, a.voted ? 'Có' : 'Không'].map(q).join(',')).join('\r\n'); const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); l.download = 'khan-gia.csv'; l.click(); };
  $('#afile').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#acsv').value = await f.text(); };
  $('#afil').oninput = (e) => { A.filter = e.target.value; clearTimeout(A.ft); A.ft = setTimeout(tabPeople, 250); };
  m.onclick = async (e) => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return; const id = Number(tr.dataset.id); const a = A.atts.find((x) => x.id === id);
    if (e.target.closest('[data-regen]')) { if (!confirm(`Cấp lại mã cho ${a.name}? Mã cũ sẽ vô hiệu.`)) return; const r = await post(`/api/admin/attendees/${id}/regen`); A.newCodes = [r]; return tabPeople(); }
    if (e.target.closest('[data-rev]')) { await post(`/api/admin/attendees/${id}/status`, { status: a.status === 'active' ? 'revoked' : 'active' }); return tabPeople(); }
    if (e.target.closest('[data-geo]')) { if (a.geoException) await post(`/api/admin/attendees/${id}/geo-exception`, { on: false }); else { const reason = prompt('Đã kiểm tra trực tiếp người này. Ghi lý do ngoại lệ vị trí (bắt buộc):'); if (!reason) return; await post(`/api/admin/attendees/${id}/geo-exception`, { on: true, reason }); } tabPeople(); }
  };
}

// ---------- CÀI ĐẶT ----------
async function tabSettings() {
  const s = await call('/api/admin/settings'); const m = $('#main');
  const F = [['eventName', 'Dòng chào mừng', 's'], ['eventTitle', 'Tên chương trình', 's'], ['eventHost', 'Đơn vị tổ chức', 's'], ['eventTagline', 'Dòng phụ', 's'], ['publicUrl', 'URL công khai (HTTPS) — QR trỏ tới đây + /vote', 's'], ['venueName', 'Tên hội trường', 's'], ['venueLat', 'Vĩ độ hội trường', 'n'], ['venueLng', 'Kinh độ hội trường', 'n'], ['venueConfirmed', 'Đã xác nhận tọa độ hội trường', 'b'], ['locationEnabled', 'Bật kiểm tra vị trí', 'b'], ['radiusM', 'Bán kính cho phép (mét)', 'n'], ['accuracyMaxM', 'Sai số GPS tối đa (mét)', 'n'], ['geoMaxAgeSec', 'Tuổi tối đa của phép đo vị trí (giây)', 'n'], ['closeMarginVotes', 'Ngưỡng “bám đuổi sát nút” (số phiếu)', 'n'], ['rotateSec', 'Chu kỳ luân phiên hồ sơ đội (giây)', 'n'], ['coalesceMs', 'Gộp cập nhật LED (ms)', 'n'], ['ledW', 'Độ phân giải LED — rộng (px)', 'n'], ['ledH', 'Độ phân giải LED — cao (px)', 'n'], ['showAnonToast', 'Hiện “Một khán giả vừa bình chọn”', 'b']];
  m.innerHTML = `<div class="panel" style="max-width:760px"><h3>Cài đặt sự kiện</h3>${F.map(([k, l, t]) => `<div class="row" style="justify-content:space-between"><label for="s_${k}" style="flex:1">${l}</label>${t === 'b' ? `<input type="checkbox" id="s_${k}" ${s[k] ? 'checked' : ''}>` : `<input id="s_${k}" type="${t === 'n' ? 'number' : 'text'}" step="any" value="${esc(s[k])}" style="width:${t === 'n' ? '150px' : '340px'}">`}</div>`).join('')}<button class="b pri" id="ssave" style="margin-top:10px">Lưu cài đặt</button>
    <p class="muted">Mật khẩu quản trị/vận hành, khóa phiên và khóa băm mã đặt qua biến môi trường (xem README). Không lưu trong trang này.</p></div>`;
  $('#ssave').onclick = async () => { const body = {}; for (const [k, , t] of F) { const el = $(`#s_${k}`); body[k] = t === 'b' ? el.checked : t === 'n' ? Number(el.value) : el.value; } await call('/api/admin/settings', 'PUT', body); toast('Đã lưu cài đặt.'); };
}

// ---------- NHẬT KÝ ----------
async function tabLog() {
  const [log, rounds] = await Promise.all([call('/api/admin/audit'), call('/api/admin/rounds')]); const m = $('#main');
  m.innerHTML = `<div class="panel"><h3>Xuất dữ liệu (an toàn formula injection)</h3><div class="row"><select id="xr">${rounds.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select><a class="b" id="x1">Kết quả vòng (CSV)</a><a class="b" id="x2">Danh sách tham dự & trạng thái bình chọn (CSV)</a></div><div class="muted">Không xuất lựa chọn của từng người và không xuất mã tham dự.</div></div>
    <div class="panel"><h3>Nhật ký thao tác (300 gần nhất)</h3><div style="max-height:600px;overflow:auto"><table><tr><th>Giờ</th><th>Người thực hiện</th><th>Hành động</th><th>Chi tiết</th></tr>${log.map((l) => `<tr><td>${fmtTime(l.at)}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}</td><td>${esc(l.detail)}</td></tr>`).join('')}</table></div></div>`;
  const upd = () => { $('#x1').href = `/api/admin/export/results.csv?round=${$('#xr').value}`; $('#x2').href = `/api/admin/export/attendance.csv?round=${$('#xr').value}`; }; $('#xr').onchange = upd; upd();
}

boot();
