// Âm thanh sân khấu bằng Web Audio. Chỉ một máy (được chọn) tạo AudioContext và phát.
// Nhạc/hiệu ứng tổng hợp chỉ để demo — thay bằng file có bản quyền: đặt vào public/audio/<tên cue>.mp3
// (tên cue: music, open, whoosh, leader, close, place4, place3, place2, place1).

const N = (m) => 440 * 2 ** ((m - 69) / 12); // số MIDI -> Hz
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62], [57, 60, 64], [53, 57, 60], [50, 57, 62], [52, 56, 59]]; // Am F C G Am F Dm E
const PENTA = [0, 3, 5, 7, 10, 12, 15];

export class StageAudio {
  constructor() {
    this.ctx = null; this.files = {}; this.buffers = {};
    this.st = { enabled: false, muted: false, master: 0.8, music: 0.45, fx: 0.9, ducked: false, musicOn: true };
    this.musicOn = false; this.bar = 0; this.nextBarAt = 0; this.timer = null; this.lastLeader = -1e9;
  }
  get ready() { return !!this.ctx && this.ctx.state === 'running'; }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
      this._newFxBus();
      // hồi âm (reverb) tạo từ xung nhiễu suy giảm
      const len = this.ctx.sampleRate * 2.2; const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6; }
      this.verbIn = this.ctx.createGain(); this.verbIn.gain.value = 0.28;
      this.verb = this.ctx.createConvolver(); this.verb.buffer = ir;
      this.verbIn.connect(this.verb); this.verb.connect(this.master);
      this.apply(this.st);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
  _newFxBus() {
    if (this.fxBus) { try { this.fxBus.disconnect(); } catch { /* */ } }
    this.fxBus = this.ctx.createGain(); this.fxBus.connect(this.master);
    if (this.verbIn) this.fxBus.connect(this.verbIn);
  }
  async loadManifest(map) {
    if (!this.ctx) return;
    for (const [name, url] of Object.entries(map || {})) {
      if (this.buffers[name]) continue;
      try { const r = await fetch(url); this.buffers[name] = await this.ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* dùng bản tổng hợp */ }
    }
  }
  /** Áp mức âm lượng từ trạng thái do ban tổ chức điều khiển (mute tức thời, ducking khi MC nói). */
  apply(st) {
    this.st = { ...this.st, ...st };
    if (!this.ctx) return;
    const t = this.ctx.currentTime; const s = this.st;
    this.master.gain.setTargetAtTime(s.muted || !s.enabled ? 0 : s.master, t, 0.03);
    this.musicBus.gain.setTargetAtTime(s.music * (s.ducked ? 0.2 : 1), t, 0.15);
    this.fxBus.gain.setTargetAtTime(s.fx, t, 0.03);
  }
  silence() { this.stopMusic(); if (this.ctx) this._newFxBus(); }

  // ---- khối dựng ----
  _env(g, t0, a, d, peak, rel = 0.2) {
    g.gain.cancelScheduledValues(t0); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d + rel);
  }
  _tone(freq, t0, dur, { type = 'sine', gain = 0.2, a = 0.01, rel = 0.25, dest = this.fxBus, lp = 0, to = 0, detune = 0 } = {}) {
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur); o.detune.value = detune;
    let node = o;
    if (lp) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); node = f; }
    node.connect(g); g.connect(dest); this._env(g, t0, a, Math.max(0.01, dur - a), gain, rel);
    o.start(t0); o.stop(t0 + dur + rel + 0.05);
  }
  _noise(t0, dur, { f0 = 400, f1 = 6000, q = 1.2, gain = 0.25, type = 'bandpass', dest = this.fxBus } = {}) {
    const len = Math.ceil(this.ctx.sampleRate * (dur + 0.1)); const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = this.ctx.createGain(); s.connect(f); f.connect(g); g.connect(dest);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.08);
    s.start(t0); s.stop(t0 + dur + 0.1);
  }
  _brass(notes, t0, dur, gain = 0.07) { notes.forEach((m) => { this._tone(N(m), t0, dur, { type: 'sawtooth', gain, a: 0.06, rel: 0.5, lp: 2200 }); this._tone(N(m), t0, dur, { type: 'sawtooth', gain: gain * 0.6, a: 0.06, rel: 0.5, lp: 1800, detune: 9 }); }); }
  _arp(base, t0, step, n, gain = 0.08) { for (let i = 0; i < n; i++) this._tone(N(base + PENTA[i % PENTA.length] + 12 * Math.floor(i / PENTA.length)), t0 + i * step, 0.3, { type: 'triangle', gain, rel: 0.4 }); }
  _impact(t0, gain = 0.5) { this._tone(110, t0, 0.8, { gain, to: 38, rel: 0.4, a: 0.005 }); this._noise(t0, 0.35, { f0: 3000, f1: 200, type: 'lowpass', gain: gain * 0.7, q: 0.5 }); }

  // ---- nhạc nền ----
  startMusic() {
    if (!this.ctx || this.musicOn || this.buffers.music) { if (this.buffers.music && this.ctx && !this.musicOn) this._playFileMusic(); return; }
    this.musicOn = true; this.nextBarAt = this.ctx.currentTime + 0.2;
    const pump = () => {
      if (!this.musicOn) return;
      while (this.nextBarAt < this.ctx.currentTime + 1.6) { this._bar(this.nextBarAt, this.bar % CHORDS.length); this.nextBarAt += 2.6667; this.bar++; }
    };
    pump(); this.timer = setInterval(pump, 400);
  }
  _playFileMusic() {
    this.musicOn = true; const s = this.ctx.createBufferSource(); s.buffer = this.buffers.music; s.loop = true; s.connect(this.musicBus); s.start(); this._fileSrc = s;
  }
  _bar(t0, i) {
    const ch = CHORDS[i]; const dest = this.musicBus;
    ch.forEach((m, k) => this._tone(N(m), t0, 2.7, { type: 'triangle', gain: 0.055, a: 0.5, rel: 0.9, dest, lp: 900, detune: k * 4 }));
    this._tone(N(ch[0] - 12), t0, 1.2, { gain: 0.09, a: 0.02, rel: 0.4, dest });
    this._tone(N(ch[0] - 12), t0 + 1.33, 1.2, { gain: 0.07, a: 0.02, rel: 0.4, dest });
    for (let k = 0; k < 8; k++) if ((k + i) % 3 !== 2) this._tone(N(ch[0] + 12 + PENTA[(k * 2 + i) % PENTA.length]), t0 + k * 0.3333, 0.25, { type: 'sine', gain: 0.045, a: 0.01, rel: 0.5, dest });
  }
  stopMusic() {
    this.musicOn = false; clearInterval(this.timer); this.timer = null;
    try { this._fileSrc?.stop(); } catch { /* */ } this._fileSrc = null;
    if (this.ctx) { const g = this.musicBus; g.disconnect(); this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master); this.apply(this.st); }
  }

  // ---- cue ----
  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    if (name === 'stop') { this.silence(); return true; }
    if (this.buffers[name]) { const s = this.ctx.createBufferSource(); s.buffer = this.buffers[name]; s.connect(this.fxBus); s.start(); return true; }
    const t = this.ctx.currentTime + 0.03;
    switch (name) {
      case 'open': this._noise(t, 1.3, { f0: 300, f1: 7000, gain: 0.3 }); this._brass([60, 64, 67, 72], t + 1.1, 1.6, 0.06); this._arp(72, t + 1.3, 0.12, 7, 0.07); break;
      case 'whoosh': this._noise(t, 0.55, { f0: 500, f1: 5200, gain: 0.28, q: 2 }); break;
      case 'leader': this._tone(180, t, 1.1, { type: 'sawtooth', gain: 0.09, to: 880, lp: 2500, a: 0.2 }); this._noise(t, 1.1, { f0: 400, f1: 6500, gain: 0.25 }); this._impact(t + 1.12, 0.5); this._brass([55, 62, 67], t + 1.12, 0.45, 0.06); break;
      case 'close': [76, 72, 67].forEach((m, i) => this._tone(N(m), t + i * 0.45, 0.6, { type: 'triangle', gain: 0.14, rel: 0.8 })); this._brass([48, 55, 60], t + 1.3, 1.2, 0.05); break;
      case 'place4': this._arp(67, t, 0.14, 8, 0.1); this._brass([60, 64, 67], t + 1.2, 2.2, 0.06); this._tone(N(84), t + 1.2, 3.2, { gain: 0.05, rel: 1.4 }); break;
      case 'place3': this._brass([55, 59, 62], t, 0.7, 0.07); this._brass([60, 64, 67, 72], t + 0.8, 3.6, 0.075); this._arp(72, t + 1.0, 0.16, 8, 0.07); this._impact(t + 0.8, 0.25); break;
      case 'place2': this._brass([57, 61, 64], t, 0.7, 0.075); this._brass([62, 66, 69, 74], t + 0.8, 4.2, 0.08); this._arp(74, t + 1.0, 0.15, 10, 0.075); this._impact(t + 0.8, 0.3); break;
      case 'place1':
        this._tone(100, t, 4, { type: 'sawtooth', gain: 0.1, to: 1200, lp: 3000, a: 0.6 }); this._noise(t, 4, { f0: 300, f1: 8000, gain: 0.32 });
        this._impact(t + 4.55, 0.65); this._brass([60, 64, 67, 72, 76], t + 4.55, 4.5, 0.085); this._arp(72, t + 4.8, 0.14, 16, 0.08); this._tone(N(96), t + 4.6, 5, { gain: 0.05, rel: 2 }); break;
      case 'tick': this._tone(880, t, 0.08, { gain: 0.18, rel: 0.08 }); break;
      case 'tick-final': this._tone(1320, t, 0.14, { gain: 0.22, rel: 0.1 }); break;
      case 'test': this._tone(1760, t, 0.3, { gain: 0.2, rel: 0.35 }); this._noise(t + 0.3, 0.4, { f0: 600, f1: 4200, gain: 0.2 }); break;
      default: return false;
    }
    return true;
  }
  /** Leader impact có thời gian nghỉ tối thiểu; trả true nếu được phát. */
  playLeader(nowMs, cooldownMs = 10000) {
    if (nowMs - this.lastLeader < cooldownMs) return false;
    this.lastLeader = nowMs; return this.play('leader');
  }
}

/** Ting êm 0,3 giây cho điện thoại (chỉ khi người dùng chủ động bật tiếng). */
export function ting() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = 'sine'; o.frequency.value = 1760;
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.32);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35); setTimeout(() => ctx.close(), 600);
  } catch { /* không hỗ trợ */ }
}
