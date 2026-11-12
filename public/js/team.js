import { $, esc, api } from './common.js';
const id = location.pathname.split('/').pop();
const app = $('#app');
try {
  const [t, pub] = await Promise.all([api(`/api/teams/${encodeURIComponent(id)}`), api('/api/public/state')]);
  document.title = `${t.name} – IT Got Talent`;
  const open = pub.round?.status === 'open' && Date.now() < pub.round.closesAt + 60000;
  app.innerHTML = `<div class="card" style="padding:0;overflow:hidden"><img src="${esc(t.photo)}" alt="Ảnh biểu diễn của ${esc(t.name)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;background:#14204a">
    <div style="padding:16px 18px 18px"><div style="font-size:13px;font-weight:700;color:var(--cyan);letter-spacing:.1em">${esc(t.code)}${t.isSample ? ' · DỮ LIỆU MẪU' : ''}</div>
    <h1 style="margin-top:4px">${esc(t.name)}</h1><div style="color:var(--warm);font-weight:600;font-size:18px">${esc(t.perfTitle)}</div>
    <div class="facts">${t.genre ? `<span>${esc(t.genre)}</span>` : ''}${t.members ? `<span>${t.members} thành viên</span>` : ''}</div>
    <p>${esc(t.bio)}</p>${t.gallery.length ? `<div class="gallery">${t.gallery.map((u) => `<img src="${esc(u)}" alt="" loading="lazy">`).join('')}</div>` : ''}</div></div>
    <div class="stack">${open ? `<a class="btn gold block" href="/vote?pick=${t.id}">Bình chọn cho đội này</a>` : ''}<a class="btn ghost block" href="/vote">← Quay lại bình chọn</a></div>`;
} catch (e) {
  app.innerHTML = `<div class="card"><h2>Không tìm thấy đội</h2><p>${esc(e.message)}</p></div><a class="btn ghost block" href="/vote">← Quay lại</a>`;
}
