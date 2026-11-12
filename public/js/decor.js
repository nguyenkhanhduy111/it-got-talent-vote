// Element tri ân vẽ bằng SVG nét mảnh: sách mở -> khuông nhạc, nét phấn, hoa & cánh hoa.
export const bookStaffSvg = (cls = '') => `
<svg class="deco ${cls}" viewBox="0 0 360 90" aria-hidden="true">
  <g transform="translate(6,22)">
    <path class="fillsoft" d="M2 38 C 18 28, 36 28, 52 38 L52 6 C 36 -4, 18 -4, 2 6 Z"/>
    <path class="fillsoft" d="M52 38 C 68 28, 86 28, 102 38 L102 6 C 86 -4, 68 -4, 52 6 Z"/>
    <path d="M52 6 V38"/>
  </g>
  <g>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M118 ${26 + i * 9} C 170 ${20 + i * 9}, 230 ${34 + i * 9}, 354 ${26 + i * 9}"/>`).join('')}
  </g>
  <g fill="rgba(255,213,138,.8)" stroke="none"><ellipse cx="170" cy="52" rx="6" ry="4.4" transform="rotate(-18 170 52)"/><ellipse cx="236" cy="40" rx="6" ry="4.4" transform="rotate(-18 236 40)"/><ellipse cx="300" cy="58" rx="6" ry="4.4" transform="rotate(-18 300 58)"/></g>
  <g><path d="M175 50 V16"/><path d="M241 38 V6"/><path d="M305 56 V22"/></g>
</svg>`;

export const flowerSvg = (cls = '') => `
<svg class="deco ${cls}" viewBox="0 0 120 120" aria-hidden="true">
  <g transform="translate(60 60)">
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse class="fillsoft" cx="0" cy="-24" rx="12" ry="24" transform="rotate(${a})"/>`).join('')}
    <circle r="6" stroke="rgba(255,209,102,.9)"/>
  </g>
</svg>`;

export const chalkSvg = (cls = '') => `
<svg class="deco ${cls}" viewBox="0 0 300 40" aria-hidden="true">
  <path d="M4 26 C 40 4, 70 38, 110 20 S 180 6, 214 24 S 270 32, 296 12" stroke-dasharray="2 5 14 6"/>
</svg>`;

export const petalsSvg = (cls = '') => `
<svg class="deco ${cls}" viewBox="0 0 160 80" aria-hidden="true">
  ${[[14, 50, -30], [52, 22, 20], [96, 48, -10], [130, 20, 35]].map(([x, y, r]) => `<path class="fillsoft" d="M0 0 C 10 -14, 24 -14, 30 0 C 24 12, 10 12, 0 0 Z" transform="translate(${x} ${y}) rotate(${r})"/>`).join('')}
</svg>`;

export function fillDust(el, n = 22) {
  let html = '';
  for (let i = 0; i < n; i++) {
    const x = Math.round(((i * 53 + 11) % 100)); const y = Math.round(((i * 37 + 23) % 100));
    html += `<i style="left:${x}%;top:${y}%;animation-delay:${(i * 0.9) % 9}s;animation-duration:${8 + (i % 5)}s"></i>`;
  }
  el.innerHTML = html;
}
export function fillWave(el, n = 64) {
  let html = '';
  for (let i = 0; i < n; i++) html += `<i style="animation-delay:${((i * 0.37) % 4.5).toFixed(2)}s;animation-duration:${3.6 + (i % 7) * 0.35}s"></i>`;
  el.innerHTML = html;
}
