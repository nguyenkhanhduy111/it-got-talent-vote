import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/** Đọc cấu hình từ biến môi trường (và file .env nếu có). Tham số `overrides` dùng cho kiểm thử. */
export function loadConfig(overrides = {}) {
  loadDotEnv(path.join(root, '.env'));
  const env = { ...process.env, ...(overrides.env || {}) };
  const demo = overrides.demo ?? (process.argv.includes('--demo') || env.DEMO_MODE === '1');
  const dataDir = path.resolve(overrides.dataDir || env.DATA_DIR || path.join(root, 'data'));
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  // Khóa bí mật: ưu tiên biến môi trường, nếu không có thì tự sinh và lưu trong DATA_DIR (hãy sao lưu thư mục này).
  const secretsFile = path.join(dataDir, '.secrets.json');
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(secretsFile, 'utf8')); } catch { /* chưa có */ }
  let changed = false;
  const secret = (name, envName, bytes = 32) => {
    if (env[envName]) return env[envName];
    if (!stored[name]) { stored[name] = crypto.randomBytes(bytes).toString('hex'); changed = true; }
    return stored[name];
  };
  const sessionSecret = secret('session', 'SESSION_SECRET');
  const codePepper = secret('pepper', 'CODE_PEPPER');
  const screenKey = secret('screen', 'SCREEN_KEY', 9);
  let generatedAdmin = null;
  let adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    adminPassword = secret('adminpw', 'ADMIN_PASSWORD_UNSET', 9);
    generatedAdmin = adminPassword;
  }
  let operatorPassword = env.OPERATOR_PASSWORD || '';
  if (changed) fs.writeFileSync(secretsFile, JSON.stringify(stored), { mode: 0o600 });

  const port = Number(overrides.port ?? env.PORT ?? 3000);
  return {
    root,
    demo,
    port,
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: overrides.dbFile || path.join(dataDir, demo ? 'demo.db' : 'vote.db'),
    publicDir: path.join(root, 'public'),
    uploadsDir: path.join(dataDir, 'uploads'),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    trustProxy: env.TRUST_PROXY === '1',
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : (env.PUBLIC_URL || '').startsWith('https://'),
    sessionSecret, codePepper, screenKey,
    adminPassword, generatedAdminPassword: generatedAdmin,
    operatorPassword,
    autoSeed: (overrides.autoSeed ?? env.AUTO_SEED) !== '0' && overrides.autoSeed !== false,
    tick: overrides.tick ?? true,
  };
}
