import { $, esc, api } from './common.js';

const codeEl = $('#code');
codeEl.addEventListener('input', () => { const raw = codeEl.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10); codeEl.value = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw; });
$('#voteForm').addEventListener('submit', (e) => { e.preventDefault(); const c = codeEl.value.trim(); location.href = c ? `/vote?code=${encodeURIComponent(c)}` : '/vote'; });

async function adminState() {
  try {
    const me = await api('/api/admin/me');
    $('#adminBox').innerHTML = `<p style="margin:0">Đã đăng nhập (${me.role === 'admin' ? 'quản trị viên' : 'vận hành sân khấu'}).</p><div class="stack" style="margin-top:10px"><a class="btn block" href="/admin">Vào trang quản trị</a><button class="btn ghost block" id="lo">Đăng xuất</button></div>`;
    $('#ledLink').href = `/screen?key=${encodeURIComponent(me.screenKey)}`; $('#ledLink').textContent = 'Mở màn hình LED (có điều khiển âm thanh)';
    $('#lo').onclick = async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); };
  } catch { /* chưa đăng nhập */ }
}
$('#adminForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const err = $('#adminErr'); err.hidden = true;
  try { await api('/api/admin/login', { method: 'POST', body: { password: $('#pw').value } }); location.href = '/admin'; }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

const s = await api('/api/public/state');
$('#ribbon').hidden = !s.demo;
$('#host').textContent = `${s.event.name} · ${s.event.host}`;
const r = s.round; const open = r?.status === 'open' && Date.now() < r.closesAt + 60000;
$('#status').innerHTML = r ? `<span class="status${open ? ' open' : ''}">${esc(r.name)} · ${open ? 'đang mở bình chọn' : r.status === 'draft' ? 'sắp mở' : 'đã kết thúc'}</span>` : '<span class="status">Chưa mở bình chọn</span>';
$('#teams').innerHTML = s.teams.map((t) => `<a class="tcard" href="/teams/${t.id}" style="display:block;text-decoration:none"><img class="ph" src="${esc(t.photo)}" alt="" loading="lazy">${t.isSample ? '<span class="sample">DỮ LIỆU MẪU</span>' : ''}<div class="info"><div class="code">${esc(t.code)}</div><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div><div class="gn">${esc(t.genre)}</div></div></a>`).join('');
adminState();
