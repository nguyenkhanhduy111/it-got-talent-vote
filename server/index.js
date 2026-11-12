import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const has = (f) => process.argv.includes(f);

// ---- Lần chạy đầu: hỏi mật khẩu và ghi vào .env (chỉ khi chạy bằng --ask và chưa có) ----
async function askPasswords() {
  const envFile = path.join(root, '.env');
  const cur = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
  if (/^ADMIN_PASSWORD=.+/m.test(cur) || !process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n=== THIẾT LẬP LẦN ĐẦU ===');
  let admin = (await rl.question('Đặt MẬT KHẨU QUẢN TRỊ (tối thiểu 8 ký tự; Enter = tự sinh): ')).trim();
  while (admin && admin.length < 8) admin = (await rl.question('Quá ngắn, nhập lại (≥ 8 ký tự; Enter = tự sinh): ')).trim();
  const operator = (await rl.question('Đặt mật khẩu VẬN HÀNH SÂN KHẤU (chỉ điều khiển LED/âm thanh; Enter = bỏ qua): ')).trim();
  rl.close();
  let out = cur.trimEnd() ? cur.trimEnd() + '\n' : '';
  if (admin) out += `ADMIN_PASSWORD=${admin}\n`;
  if (operator) out += `OPERATOR_PASSWORD=${operator}\n`;
  if (out) fs.writeFileSync(envFile, out, { mode: 0o600 });
}
if (has('--ask')) await askPasswords();

const { loadConfig } = await import('./config.js');
const { createApp } = await import('./app.js');
const config = loadConfig();
let makePersist = null;
if (process.env.DATABASE_URL) {
  if (!process.env.CODE_PEPPER || !process.env.SESSION_SECRET) { console.error('LỖI: khi dùng DATABASE_URL phải đặt cố định CODE_PEPPER và SESSION_SECRET (ổ đĩa tạm sẽ làm mất khóa tự sinh -> mọi mã tham dự đã cấp thành vô hiệu).'); process.exit(1); }
  const { makePool, restoreSnapshot, Persist } = await import('./persist.js');
  const pool = await makePool(process.env.DATABASE_URL);
  await restoreSnapshot(pool, config.dbFile);
  makePersist = (store) => new Persist({ pool, store });
}
const app = createApp({ config, makePersist });
if (app.persist) { await app.persist.durable().catch((e) => console.error('  [lưu bền] Không đẩy được bản đầu tiên:', e.message)); }
const port = await app.listen();
const local = `http://localhost:${port}`;

const lanIp = () => { for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) return a.address; return null; };

function banner(publicUrl) {
  console.log('\n==================  IT GOT TALENT · NỐT NHẠC TRI ÂN — BÌNH CHỌN  ==================');
  console.log(config.demo ? '  CHẾ ĐỘ DEMO (MÔ PHỎNG) — dữ liệu tách riêng: ' + config.dbFile : '  Chế độ THẬT — cơ sở dữ liệu: ' + config.dbFile);
  console.log(`  Quản trị      : ${local}/admin`);
  console.log(`  Màn hình LED  : ${local}/screen?key=${config.screenKey}   (giữ bí mật)`);
  console.log(`  Điện thoại    : ${publicUrl}/vote   <- địa chỉ trong mã QR`);
  if (config.generatedAdminPassword) console.log(`  ! Mật khẩu quản trị tự sinh: ${config.generatedAdminPassword}   (lưu ở data/.secrets.json)`);
  if (config.demo) console.log('  Mã tham dự demo: DEMO0001 … DEMO0010');
  console.log('  Đóng cửa sổ này = tắt hệ thống.');
  console.log('=====================================================================================\n');
}
banner(config.publicUrl);

// ---- Tự tạo địa chỉ HTTPS công khai bằng Cloudflare quick tunnel (nếu có cloudflared) ----
function startTunnel(attempt = 1) {
  const bin = process.env.TUNNEL_BIN || path.join(root, 'runtime', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!fs.existsSync(bin)) { console.log('  (Không tìm thấy cloudflared — bỏ qua tạo HTTPS tự động.)'); return fallbackLan('không có cloudflared'); }
  console.log(`  Đang tạo địa chỉ HTTPS công khai (cần Internet)… lần ${attempt}/3`);
  const args = process.env.TUNNEL_BIN ? [] : ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', local];
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let done = false; let tail = '';
  const retryOrFallback = (why) => {
    if (attempt < 3) { console.log(`  … chưa được (${why}), thử lại sau 3 giây.`); setTimeout(() => startTunnel(attempt + 1), 3000); }
    else { if (tail.trim()) console.log('  Thông báo cuối của cloudflared:\n    ' + tail.trim().split('\n').slice(-4).join('\n    ')); fallbackLan(why); }
  };
  const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch { /* */ } retryOrFallback('quá thời gian chờ'); } }, 40000);
  const onData = (buf) => {
    const text = buf.toString(); tail = (tail + text).slice(-1500);
    // bỏ qua api.trycloudflare.com (chỉ là máy chủ API của Cloudflare, xuất hiện trong thông báo lỗi)
    const m = [...text.matchAll(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/g)].find((x) => x[1] !== 'api');
    if (m && !done) {
      done = true; clearTimeout(timer);
      app.store.updateSettings({ publicUrl: m[0] }, 'tunnel');
      console.log(`\n  ✔ HTTPS công khai sẵn sàng: ${m[0]}\n    Mã QR trên LED đã tự cập nhật -> ${m[0]}/vote\n    (Địa chỉ này ĐỔI mỗi lần khởi động; không tắt cửa sổ trong lúc diễn.)\n`);
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); fallbackLan(e.message); } });
  child.on('exit', (code) => {
    if (!done) { done = true; clearTimeout(timer); retryOrFallback(`cloudflared thoát, mã ${code}`); }
    else console.log('  ⚠ Đường hầm HTTPS đã dừng! Điện thoại ngoài mạng sẽ không vào được. Khởi động lại chương trình.');
  });
  process.on('exit', () => { try { child.kill(); } catch { /* */ } });
}
function fallbackLan(why) {
  const ip = lanIp();
  console.log(`\n  ⚠ Không tạo được HTTPS (${why}).`);
  if (ip) {
    const url = `http://${ip}:${port}`;
    app.store.updateSettings({ publicUrl: url }, 'tunnel');
    console.log(`    Dùng tạm mạng nội bộ: điện thoại cùng Wi-Fi mở ${url}/vote`);
    console.log('    LƯU Ý: HTTP không cho điện thoại chia sẻ vị trí -> vào Quản trị > Cài đặt, TẮT "kiểm tra vị trí" hoặc dùng HTTPS.\n');
  } else console.log('    Không tìm thấy địa chỉ mạng nội bộ. Hãy kiểm tra kết nối mạng.\n');
}
if (has('--tunnel')) startTunnel();

if (has('--open')) {
  const url = `${local}/admin`;
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : null;
  if (cmd) { try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* không mở được trình duyệt */ } }
}

const stop = async () => { await app.close(); process.exit(0); };
console.log(process.env.DATABASE_URL ? '  [lưu bền] Dữ liệu được sao lên Postgres sau mỗi thay đổi.' : '');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
