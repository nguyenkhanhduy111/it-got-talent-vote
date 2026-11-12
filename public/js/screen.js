import { $, esc, fmtNum, fmtClock, fmtTime, ServerClock, api, uuid } from './common.js';
import { acceptState, cueDecision, diffRanking, isCloseRace, pickBanner } from './state-guard.js';
import { fillDust, fillWave } from './decor.js';
import { StageAudio } from './audio.js';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const screenKey = params.get('key') || '';
const clock = new ServerClock();
const stage = $('#stage');
let state = null;
let lastUpdate = 0;
let lastCueSeq = null;
let lastRoundId = null;
let lastLiveRows = null;
let lastTotal = null;
let banner = null;
let bannerTimer = null;
let lastTickSec = null;
let lastWhoosh = 0;
const VIEWS = { idle: 'v-idle', live: 'v-live', hidden: 'v-hidden', confirming: 'v-confirming', revealing: 'v-revealing', final: 'v-final' };
const RANK_NAME = { 1: 'NHẤT', 2: 'NHÌ', 3: 'BA', 4: 'TƯ' };

// ---------- khung hình: co giãn đồng đều, không kéo méo ----------
function fit() {
  const W = state?.settings.ledW || Number(params.get('w')) || 1920;
  const H = state?.settings.ledH || Number(params.get('h')) || 1080;
  stage.style.width = `${W}px`; stage.style.height = `${H}px`;
  stage.style.setProperty('--sx', `${Math.round(W * 0.05)}px`); stage.style.setProperty('--sy', `${Math.round(H * 0.05)}px`);
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.position = 'absolute'; stage.style.left = '50%'; stage.style.top = '50%';
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit);

// ---------- trang trí ----------
fillDust($('#dust'), 22); fillWave($('#wave'), 64);

// ---------- bảng hạng ----------
function tween(el, from, to, instant) {
  cancelAnimationFrame(el._raf);
  if (instant || from === to) { el.textContent = fmtNum(to); return; }
  const t0 = performance.now(); const ms = 420;
  const step = (t) => { const k = Math.min(1, (t - t0) / ms); el.textContent = fmtNum(Math.round(from + (to - from) * (1 - (1 - k) ** 3))); if (k < 1) el._raf = requestAnimationFrame(step); };
  el._raf = requestAnimationFrame(step);
}
class Board {
  constructor(el) { this.el = el; this.rows = new Map(); this.rh = 110; }
  update(rows, teams, { instant = false, changes = [], leaderId = null } = {}) {
    const byId = new Map(teams.map((t) => [t.id, t]));
    const n = Math.max(rows.length, 1); const gap = 14;
    const H = this.el.clientHeight || 700;
    this.rh = Math.max(56, Math.min(132, (H - (n - 1) * gap) / n));
    this.el.style.setProperty('--rh', `${this.rh}px`);
    const max = Math.max(1, ...rows.map((r) => r.votes));
    const chg = new Map(changes.map((c) => [c.teamId, c]));
    const seen = new Set();
    rows.forEach((r, i) => {
      const t = byId.get(r.teamId); if (!t) return;
      seen.add(r.teamId);
      let el = this.rows.get(r.teamId);
      if (!el) {
        el = document.createElement('div'); el.className = 'row';
        el.innerHTML = `<div class="rk"><b></b></div><img class="av" alt=""><div class="meta"><div class="nm"></div><div class="pf"></div><div class="bar"><span></span></div></div><div class="vt"><b>0</b><small>PHIẾU</small></div><div class="tag"></div>`;
        el.style.transition = 'none'; this.el.appendChild(el); this.rows.set(r.teamId, el); el._votes = 0;
        el.style.transform = `translateY(${i * (this.rh + gap)}px)`; void el.offsetHeight; el.style.transition = '';
      }
      el.classList.toggle('r1', r.rank === 1 && r.votes > 0); el.classList.toggle('r2', r.rank === 2); el.classList.toggle('r3', r.rank === 3);
      const rk = $('.rk', el); rk.innerHTML = `<b>${r.rank}</b>${r.tie ? '<em>ĐỒNG HẠNG</em>' : ''}`;
      const img = $('.av', el); if (img.getAttribute('src') !== t.avatar) img.src = t.avatar;
      $('.nm', el).textContent = t.name; $('.pf', el).textContent = t.perfTitle;
      $('.bar span', el).style.width = `${(r.votes / max) * 100}%`;
      tween($('.vt b', el), el._votes, r.votes, instant); el._votes = r.votes;
      el.style.transform = `translateY(${i * (this.rh + gap)}px)`;
      const c = chg.get(r.teamId);
      if (c && !instant) {
        const tag = $('.tag', el);
        tag.textContent = c.delta > 0 ? `▲ Tăng ${c.delta} hạng` : `▼ Xuống ${-c.delta} hạng`;
        tag.className = `tag show${c.delta < 0 ? ' down' : ''}`;
        clearTimeout(el._tagT); el._tagT = setTimeout(() => tag.classList.remove('show'), 3000);
        if (c.delta > 0) { el.classList.add('trail'); setTimeout(() => el.classList.remove('trail'), 1000); }
      }
      if (leaderId === r.teamId && !instant) { el.classList.add('lead-run'); setTimeout(() => el.classList.remove('lead-run'), 3300); }
    });
    for (const [id, el] of this.rows) if (!seen.has(id)) { el.remove(); this.rows.delete(id); }
  }
}
const liveBoard = new Board($('#board'));
const finalBoard = new Board($('#finalBoard'));

// ---------- banner ưu tiên ----------
function showBanner(kind, text, ms) {
  const cand = { kind, text, until: Date.now() + ms };
  const next = pickBanner(banner, cand, Date.now());
  if (next !== cand) return;
  banner = cand;
  const el = $('#banner'); el.className = `banner ${kind}`; el.textContent = text; el.hidden = false;
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { el.hidden = true; banner = null; }, ms);
}

// ---------- chờ: luân phiên hồ sơ ----------
let idleSig = ''; let idleIdx = 0; let idleSince = Date.now();
function renderProfiles(teams) {
  const sig = teams.map((t) => `${t.id}:${t.name}:${t.photo}`).join('|');
  if (sig === idleSig) return;
  idleSig = sig; idleIdx = 0; idleSince = Date.now();
  $('#profile').innerHTML = teams.map((t, i) => `<div class="pslide${i === 0 ? ' on' : ''}"><img class="ph" src="${esc(t.photo)}" alt=""><div><div class="code">${esc(t.code)}${t.isSample ? ' · DỮ LIỆU MẪU' : ''}</div><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div><div class="gn">${esc(t.genre)}${t.members ? ` · ${t.members} thành viên` : ''}</div><div class="bio">${esc(t.bio)}</div></div></div>`).join('');
  $('#profileDots').innerHTML = teams.map((_, i) => `<i class="${i === 0 ? 'on' : ''}"></i>`).join('');
}
function rotateProfiles() {
  const slides = document.querySelectorAll('.pslide'); if (slides.length < 2) return;
  const every = (state?.settings.rotateSec || 10) * 1000;
  if (Date.now() - idleSince < every) return;
  idleSince = Date.now(); idleIdx = (idleIdx + 1) % slides.length; // thứ tự cố định, thời lượng bằng nhau
  slides.forEach((s, i) => s.classList.toggle('on', i === idleIdx));
  document.querySelectorAll('#profileDots i').forEach((d, i) => d.classList.toggle('on', i === idleIdx));
}

// ---------- công bố ----------
const RANK_COLOR = { 1: 'var(--gold)', 2: 'var(--silver)', 3: 'var(--bronze)' };
let revealKey = '';
function renderReveal(s) {
  const key = `${s.round?.id}:${s.revealed.length}`;
  if (key === revealKey) return;
  const first = revealKey === '';
  revealKey = key;
  const last = s.revealed[s.revealed.length - 1];
  const byId = new Map(s.teams.map((t) => [t.id, t]));
  if (!last) { $('#reveal').innerHTML = ''; $('#revealStrip').innerHTML = ''; return; }
  const c = RANK_COLOR[last.rank] || 'var(--cyan)';
  const title = `${last.tie ? 'ĐỒNG HẠNG ' : 'HẠNG '}${RANK_NAME[last.rank] || last.rank}`;
  $('#reveal').className = `reveal${last.teamIds.length > 1 ? ' multi' : ''}`;
  $('#reveal').innerHTML = last.teamIds.map((id) => { const t = byId.get(id); if (!t) return ''; return `<div class="rcard" style="--c:${c}"><div class="medal" style="color:${c}">${title}</div><img class="photo" src="${esc(t.photo)}" alt=""><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div><div class="votes"><b>${fmtNum(last.votes)}</b> phiếu</div></div>`; }).join('');
  $('#revealStrip').innerHTML = s.revealed.slice(0, -1).reverse().map((g) => `<span class="rchip">${g.tie ? 'ĐH ' : ''}HẠNG ${g.rank} · ${g.teamIds.map((id) => esc(byId.get(id)?.name || '')).join(', ')}</span>`).join('');
  if (last.rank === 1 && !reduced() && !first) confetti(); else if (last.rank === 1 && !reduced()) confetti();
  showBanner('announce', title, 2500);
}
function reduced() { return stage.classList.contains('reduce'); }
let confettiRaf = 0;
function confetti() {
  const cv = $('#confetti'); const box = $('#content'); cv.width = box.clientWidth; cv.height = box.clientHeight;
  const g = cv.getContext('2d'); const cols = ['#FFD166', '#FFD58A', '#35D7FF', '#F46BA8', '#9A6CFF', '#FFF8EE'];
  const ps = Array.from({ length: 130 }, () => ({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6, w: 8 + Math.random() * 10, h: 5 + Math.random() * 8, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.15, c: cols[Math.floor(Math.random() * cols.length)] }));
  cancelAnimationFrame(confettiRaf); const t0 = performance.now();
  const step = (t) => {
    g.clearRect(0, 0, cv.width, cv.height);
    const age = t - t0; g.globalAlpha = age > 5000 ? Math.max(0, 1 - (age - 5000) / 1500) : 1;
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.r += p.vr; g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); g.restore(); }
    if (age < 6500) confettiRaf = requestAnimationFrame(step); else g.clearRect(0, 0, cv.width, cv.height);
  };
  confettiRaf = requestAnimationFrame(step);
}

// ---------- âm thanh ----------
const audio = new StageAudio();
const clientId = (() => { try { let v = sessionStorage.getItem('screenCid'); if (!v) { v = uuid().replace(/-/g, '').slice(0, 20); sessionStorage.setItem('screenCid', v); } return v; } catch { return uuid().replace(/-/g, '').slice(0, 20); } })();
let manifestLoaded = false;
const isOwner = () => !preview && audio.ready && state?.audio.ownerId === clientId;
function syncAudio() {
  if (!state) return;
  const a = state.audio;
  if (!isOwner()) { if (audio.ctx && (audio.musicOn)) audio.silence(); updateAudioBtn(); return; }
  if (!manifestLoaded) { manifestLoaded = true; api('/api/audio-manifest').then((m) => audio.loadManifest(m)).catch(() => {}); }
  audio.apply(a);
  const mode = state.display.mode;
  const want = a.enabled && !a.muted && a.musicOn && ['idle', 'live', 'hidden', 'confirming'].includes(mode);
  if (want && !audio.musicOn) audio.startMusic(); else if (!want && audio.musicOn) audio.stopMusic();
  const d = cueDecision(lastCueSeq, state.cue, clock.now());
  lastCueSeq = d.seq;
  if (d.play && a.enabled && !a.muted) audio.play(state.cue.name);
  updateAudioBtn();
}
function updateAudioBtn() {
  const btn = $('#audioBtn');
  btn.hidden = preview || !screenKey || isOwner();
}
$('#audioBtn').addEventListener('click', async () => {
  const btn = $('#audioBtn');
  try { await audio.unlock(); await api('/api/screen/claim-audio', { method: 'POST', body: { clientId, key: screenKey } }); lastCueSeq = state?.cue.seq ?? null; btn.textContent = '🔊 Đang kích hoạt…'; }
  catch (e) { btn.textContent = `⚠ ${e.message}`; }
});

// ---------- vẽ ----------
function handleState(s, fromStream = true) {
  if (!acceptState(state, s)) return;
  clock.sync(s.serverNow);
  lastUpdate = Date.now();
  const prev = state; state = s;
  if (!prev || prev.settings.ledW !== s.settings.ledW || prev.settings.ledH !== s.settings.ledH) fit();
  if (lastCueSeq === null && !isOwner()) lastCueSeq = s.cue.seq; // không phát cue cũ khi vừa tải
  render(prev, s);
  syncAudio();
}
function render(prev, s) {
  const mode = s.display.mode;
  stage.dataset.mode = mode;
  stage.classList.toggle('reduce', s.display.reduceFx || matchMedia('(prefers-reduced-motion: reduce)').matches);
  stage.classList.toggle('noqr', ['confirming', 'revealing', 'final', 'emergency'].includes(mode));
  $('#emergency').hidden = mode !== 'emergency';
  $('#demoRibbon').hidden = !s.demo;
  document.title = `${s.event.title} – màn hình LED`;
  $('#kicker').textContent = s.event.host || '';
  const nt = $('#notice'); nt.hidden = !s.display.notice; nt.textContent = s.display.notice;
  if (mode !== 'live' && mode !== 'revealing') { $('#banner').hidden = true; banner = null; clearTimeout(bannerTimer); } // không để lộ hiệu ứng cũ khi giữ kín/xác nhận
  const vis = VIEWS[mode] || 'v-idle';
  for (const id of Object.values(VIEWS)) $(`#${id}`).classList.toggle('on', id === vis);

  // QR cố định, không bị che
  const url = s.event.voteUrl; const img = $('#qrimg'); const want = `/api/qr.svg?u=${encodeURIComponent(url)}`;
  if (img.getAttribute('src') !== want) img.src = want;
  $('#qrurl').textContent = url.replace(/^https?:\/\//, '');
  const qs = $('#qrstatus'); const open = s.round?.status === 'open';
  qs.className = `qr-status${open ? ' open' : ''}`; qs.textContent = open ? 'VÒNG ĐANG MỞ' : 'SẮP MỞ BÌNH CHỌN';

  if (mode === 'idle' || (mode === 'hidden' && false)) renderProfiles(s.teams);
  if (mode === 'idle') renderProfiles(s.teams);

  // vòng mới -> xóa nhớ
  if ((s.round?.id ?? null) !== lastRoundId) { lastRoundId = s.round?.id ?? null; lastLiveRows = null; lastTotal = null; revealKey = ''; }

  if (mode === 'live' && s.results) {
    const rows = s.results.rows;
    const diff = diffRanking(lastLiveRows, rows);
    liveBoard.update(rows, s.teams, { instant: !lastLiveRows, changes: diff.changes, leaderId: diff.leaderChanged ? diff.newLeader : null });
    $('#totalVotes').textContent = fmtNum(s.results.total);
    $('#closeChip').hidden = !isCloseRace(rows, s.settings.closeMarginVotes);
    const byId = new Map(s.teams.map((t) => [t.id, t]));
    if (diff.leaderChanged) { showBanner('leader', `ĐỔI NGÔI DẪN ĐẦU · ${byId.get(diff.newLeader)?.name || ''}`, 2800); if (isOwner() && s.audio.enabled) audio.playLeader(Date.now()); }
    else if (diff.changes.some((c) => c.delta > 0)) {
      const c = diff.changes.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta)[0];
      showBanner('rankup', `${byId.get(c.teamId)?.name || ''} tăng ${c.delta} hạng`, 2200);
      if (isOwner() && s.audio.enabled && !s.audio.muted && Date.now() - lastWhoosh > 1500) { lastWhoosh = Date.now(); audio.play('whoosh'); }
    }
    if (lastTotal !== null && s.results.total > lastTotal && s.settings.showAnonToast) {
      const n = s.results.total - lastTotal; const an = $('#anon');
      an.textContent = n === 1 ? '● Một khán giả vừa bình chọn' : `● ${n} phiếu mới vừa được ghi nhận`; an.classList.add('show');
      clearTimeout(an._t); an._t = setTimeout(() => an.classList.remove('show'), 2600);
    }
    lastLiveRows = rows; lastTotal = s.results.total;
  } else { lastLiveRows = null; lastTotal = null; }

  if (mode === 'hidden') {
    $('#hiddenSub').textContent = 'Vẫn nhận phiếu đến hết giờ';
    $('#hiddenAv').innerHTML = s.teams.map((t) => `<img src="${esc(t.avatar)}" alt="">`).join('');
  }
  if (mode === 'revealing') renderReveal(s); else if (prev?.display.mode === 'revealing') { revealKey = ''; cancelAnimationFrame(confettiRaf); }
  if (mode === 'final' && s.results) finalBoard.update(s.results.rows, s.teams, { instant: true });
}

// ---------- đồng hồ & trạng thái kết nối (250 ms) ----------
function ui() {
  if (!state) return;
  const r = state.round; const t = $('#timer');
  if (r && r.status === 'open') {
    const rem = r.closesAt - clock.now();
    $('#timerLabel').textContent = 'CÒN LẠI'; $('#timerValue').textContent = fmtClock(rem);
    const last = rem <= 10000 && rem > 0; t.classList.toggle('last10', last); t.classList.toggle('beat', last); t.hidden = false;
    const sec = Math.ceil(rem / 1000);
    if (last && sec !== lastTickSec && isOwner() && state.display.countdownArmed && state.audio.enabled) { lastTickSec = sec; audio.play(sec <= 3 ? 'tick-final' : 'tick'); }
    if (!last) lastTickSec = null;
    if (state.display.mode === 'hidden') $('#hiddenSub').textContent = `Vẫn nhận phiếu đến hết giờ · còn ${fmtClock(rem)}`;
  } else if (r && r.status === 'closed') { $('#timerLabel').textContent = 'VÒNG BÌNH CHỌN'; $('#timerValue').textContent = 'ĐÃ KẾT THÚC'; t.classList.remove('last10', 'beat'); t.hidden = false; $('#timerValue').style.fontSize = '44px'; }
  else { t.hidden = true; }
  if (r?.status === 'open') $('#timerValue').style.fontSize = '';
  rotateProfiles();
}
setInterval(ui, 250);

// ---------- kết nối thời gian thực ----------
function setConn(ok) {
  const c = $('#conn');
  if (ok) { c.hidden = true; return; }
  c.hidden = false; c.textContent = `Đang kết nối lại… Cập nhật lần cuối ${lastUpdate ? fmtTime(lastUpdate) : '—'}`;
}
let es = null; let reconnectT = null;
function connect() {
  clearTimeout(reconnectT);
  es = new EventSource('/api/stream');
  es.addEventListener('state', (e) => { setConn(true); try { handleState(JSON.parse(e.data)); } catch { /* bỏ gói hỏng */ } });
  es.onopen = () => setConn(true);
  es.onerror = () => { setConn(false); if (es.readyState === 2) { reconnectT = setTimeout(connect, 2000); } };
}
// Dự phòng: nếu quá lâu không có gói nào, thử lấy trực tiếp (giữ dữ liệu cũ, không bịa số)
setInterval(async () => {
  if (Date.now() - lastUpdate > 20000) {
    try { handleState(await api('/api/public/state', { timeout: 5000 })); setConn(true); } catch { setConn(false); }
  }
}, 10000);

api('/api/public/state').then((s) => handleState(s)).catch(() => setConn(false));
connect();
fit();

// ---------- tiện ích vận hành ----------
let cursorT;
addEventListener('mousemove', () => { stage.classList.remove('nocursor'); clearTimeout(cursorT); cursorT = setTimeout(() => stage.classList.add('nocursor'), 3000); });
addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
  if ((e.key === 'a' || e.key === 'A') && !$('#audioBtn').hidden) $('#audioBtn').click();
});
