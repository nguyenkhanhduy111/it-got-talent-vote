// Lưu bền SQLite lên Postgres (dành cho nền tảng miễn phí có ổ đĩa tạm như Render free).
// - Khởi động: nếu Postgres đã có bản chụp -> khôi phục thành file SQLite cục bộ.
// - Chạy: sau mỗi thay đổi, đẩy bản chụp (VACUUM INTO) lên Postgres theo nhóm (tối thiểu 300 ms/lần).
// - Gửi phiếu và thao tác quản trị chỉ được xác nhận SAU KHI bản chụp chứa nó đã lưu bền (group commit).
import fs from 'node:fs';
import path from 'node:path';

const TABLE = 'gdta_snapshot';

export async function makePool(url) {
  const { default: pg } = await import('pg');
  const local = /localhost|127\.0\.0\.1|sslmode=disable/.test(url);
  return new pg.Pool({ connectionString: url, max: 2, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
}

/** Khôi phục file SQLite từ Postgres (gọi TRƯỚC khi mở CSDL). Trả 'restored' | 'empty'. */
export async function restoreSnapshot(pool, dbFile, log = console.log) {
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INT PRIMARY KEY, seq BIGINT NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now(), data BYTEA NOT NULL)`);
  const r = await pool.query(`SELECT seq, data FROM ${TABLE} WHERE id=1`);
  if (!r.rows.length) { log('  [lưu bền] Chưa có bản chụp trên Postgres — bắt đầu mới.'); return 'empty'; }
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  for (const ext of ['', '-wal', '-shm']) { try { fs.rmSync(dbFile + ext); } catch { /* chưa có */ } }
  fs.writeFileSync(dbFile, r.rows[0].data);
  log(`  [lưu bền] Đã khôi phục dữ liệu từ Postgres (${(r.rows[0].data.length / 1024).toFixed(0)} KB).`);
  return 'restored';
}

export class Persist {
  constructor({ pool, store, minIntervalMs = 300, log = console.log, clock = { now: () => Date.now() } }) {
    this.pool = pool; this.store = store; this.minMs = minIntervalMs; this.log = log; this.clock = clock;
    this.seq = 1; this.pushedSeq = 0; this.inflight = null; this.lastPushAt = 0; this.lastRemoteSeq = 0; this.failures = 0; this.closed = false;
    this.tmp = path.join(path.dirname(store.config.dbFile), '.snapshot.tmp');
    store.afterCommit = () => { this.seq += 1; };
    this.timer = setInterval(() => { if (this.seq > this.pushedSeq && !this.inflight) this.durable().catch(() => {}); }, 1000);
    this.timer.unref?.();
  }
  async _push() {
    const wait = this.lastPushAt + this.minMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const seqAtSnapshot = this.seq;
    try { fs.rmSync(this.tmp); } catch { /* chưa có */ }
    this.store.db.exec(`VACUUM INTO '${this.tmp.replace(/'/g, "''")}'`);
    const data = fs.readFileSync(this.tmp);
    try { fs.rmSync(this.tmp); } catch { /* */ }
    const remoteSeq = Math.max(this.lastRemoteSeq + 1, this.clock.now());
    await this.pool.query(`INSERT INTO ${TABLE} (id, seq, data) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET seq=EXCLUDED.seq, data=EXCLUDED.data, saved_at=now() WHERE ${TABLE}.seq < EXCLUDED.seq`, [remoteSeq, data]);
    this.lastRemoteSeq = remoteSeq; this.pushedSeq = Math.max(this.pushedSeq, seqAtSnapshot); this.lastPushAt = Date.now(); this.failures = 0;
  }
  /** Chờ đến khi mọi thay đổi đã xảy ra TRƯỚC thời điểm gọi được lưu bền. Ném lỗi nếu Postgres không ghi được. */
  async durable() {
    const target = this.seq;
    let guard = 0;
    while (this.pushedSeq < target) {
      if (++guard > 4) throw new Error('Không lưu bền được dữ liệu');
      if (!this.inflight) this.inflight = this._push().catch((e) => { this.failures++; this.log('  [lưu bền] LỖI đẩy dữ liệu lên Postgres:', e.message); throw e; }).finally(() => { this.inflight = null; });
      await this.inflight;
    }
  }
  status() { return { seq: this.seq, pushedSeq: this.pushedSeq, lastPushAt: this.lastPushAt, failures: this.failures }; }
  async close() {
    clearInterval(this.timer); this.closed = true;
    try { await this.durable(); } catch { /* đã ghi log */ }
    try { await this.pool.end?.(); } catch { /* */ }
  }
}
