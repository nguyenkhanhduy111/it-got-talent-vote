(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // public/js/common.js
  var $ = (sel, root = document) => root.querySelector(sel);
  var esc = (s) => String(s != null ? s : "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  var fmtNum = (n) => new Intl.NumberFormat("vi-VN").format(n);
  var fmtClock = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1e3));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };
  var ServerClock = class {
    constructor() {
      this.offset = 0;
      this.ready = false;
    }
    sync(serverNow, sentAt = Date.now()) {
      const off = serverNow - Date.now();
      if (!this.ready || Math.abs(off) < Math.abs(this.offset) + 1500) this.offset = off;
      this.ready = true;
    }
    now() {
      return Date.now() + this.offset;
    }
  };
  async function api(path, { method = "GET", body, token, headers = {}, raw, timeout = 15e3 } = {}) {
    var _a, _b;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(path, {
        method,
        signal: ctl.signal,
        credentials: "same-origin",
        headers: __spreadValues(__spreadValues(__spreadValues({}, raw ? {} : body !== void 0 ? { "Content-Type": "application/json" } : {}), token ? { Authorization: `Bearer ${token}` } : {}), headers),
        body: raw ? body : body !== void 0 ? JSON.stringify(body) : void 0
      });
      const ct = res.headers.get("content-type") || "";
      const data = ct.includes("json") ? await res.json() : await res.text();
      if (!res.ok) {
        const e = new Error(((_a = data == null ? void 0 : data.error) == null ? void 0 : _a.message) || `L\u1ED7i ${res.status}`);
        e.status = res.status;
        e.code = (_b = data == null ? void 0 : data.error) == null ? void 0 : _b.code;
        e.data = data == null ? void 0 : data.error;
        throw e;
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") {
        const err = new Error("M\u1EA1ng ch\u1EADm ho\u1EB7c m\u1EA5t k\u1EBFt n\u1ED1i.");
        err.network = true;
        throw err;
      }
      if (!e.status) {
        e.network = true;
        e.message = "Kh\xF4ng k\u1EBFt n\u1ED1i \u0111\u01B0\u1EE3c m\xE1y ch\u1EE7.";
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  var store = {
    get(k, d = null) {
      try {
        const v = localStorage.getItem(k);
        return v === null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
      }
    },
    del(k) {
      try {
        localStorage.removeItem(k);
      } catch (e) {
      }
    }
  };

  // public/js/audio.js
  function ting() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 1760;
      g.gain.setValueAtTime(1e-4, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(1e-4, ctx.currentTime + 0.32);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.35);
      setTimeout(() => ctx.close(), 600);
    } catch (e) {
    }
  }

  // public/js/vote.js
  var clock = new ServerClock();
  var app = $("#app");
  var S = {
    view: "welcome",
    pub: null,
    token: store.get("gdta.token"),
    name: store.get("gdta.name"),
    myVote: null,
    geo: null,
    geoErr: null,
    geoBusy: false,
    sel: null,
    busy: false,
    err: null,
    info: null,
    codeDraft: "",
    reg: { name: "", mssv: "", phone: "", email: "", emailMasked: "" },
    pending: store.get("gdta.pending"),
    prefs: { sound: store.get("gdta.sound", false), vib: store.get("gdta.vib", false), reduce: store.get("gdta.reduce", matchMedia("(prefers-reduced-motion: reduce)").matches) },
    pick: new URLSearchParams(location.search).get("pick"),
    receipt: null
  };
  var prefsInit = () => {
    $("#pSound").checked = S.prefs.sound;
    $("#pVib").checked = S.prefs.vib;
    $("#pReduce").checked = S.prefs.reduce;
    document.body.classList.toggle("reduce", S.prefs.reduce);
  };
  $("#pSound").onchange = (e) => {
    S.prefs.sound = e.target.checked;
    store.set("gdta.sound", S.prefs.sound);
    if (S.prefs.sound) ting();
  };
  $("#pVib").onchange = (e) => {
    var _a;
    S.prefs.vib = e.target.checked;
    store.set("gdta.vib", S.prefs.vib);
    if (S.prefs.vib) (_a = navigator.vibrate) == null ? void 0 : _a.call(navigator, 40);
  };
  $("#pReduce").onchange = (e) => {
    S.prefs.reduce = e.target.checked;
    store.set("gdta.reduce", S.prefs.reduce);
    prefsInit();
  };
  prefsInit();
  var round = () => {
    var _a;
    return ((_a = S.pub) == null ? void 0 : _a.round) || null;
  };
  var isOpen = () => {
    const r = round();
    return !!r && r.status === "open" && clock.now() < r.closesAt;
  };
  var teamById = (id) => {
    var _a;
    return (_a = S.pub) == null ? void 0 : _a.teams.find((t) => t.id === id);
  };
  var go = (v) => {
    S.view = v;
    S.err = null;
    render();
    window.scrollTo(0, 0);
  };
  var errMsg = (m) => `<div class="msg err" role="alert">${esc(m)}</div>`;
  var infoMsg = (m) => `<div class="msg info">${esc(m)}</div>`;
  function statusChip() {
    const r = round();
    if (!r) return '<span class="status">Ch\u01B0a c\xF3 v\xF2ng b\xECnh ch\u1ECDn</span>';
    if (r.status === "draft") return `<span class="status">${esc(r.name)} \xB7 s\u1EAFp m\u1EDF</span>`;
    if (isOpen()) return `<span class="status open">${esc(r.name)} \xB7 \u0111ang m\u1EDF</span>`;
    return `<span class="status">${esc(r.name)} \xB7 \u0111\xE3 k\u1EBFt th\xFAc</span>`;
  }
  var timeBlock = () => {
    const r = round();
    return isOpen() ? `<div class="bigtime" id="tleft">${fmtClock(r.closesAt - clock.now())}</div><p style="margin:0">th\u1EDDi gian c\xF2n l\u1EA1i (theo gi\u1EDD m\xE1y ch\u1EE7)</p>` : "";
  };
  var V = {
    welcome() {
      var _a, _b;
      const r = round();
      let cta;
      if (S.myVote) cta = '<button class="btn block" data-act="follow">Xem phi\u1EBFu c\u1EE7a t\xF4i</button>';
      else if (!r || r.status === "draft") cta = '<button class="btn block" disabled>Ch\u01B0a m\u1EDF b\xECnh ch\u1ECDn</button>';
      else if (!isOpen()) cta = '<button class="btn block ghost" data-act="follow">Xem k\u1EBFt qu\u1EA3</button>';
      else cta = '<button class="btn block" data-act="join">Tham gia b\xECnh ch\u1ECDn</button>';
      return `<div class="card"><h1>${esc(((_a = S.pub) == null ? void 0 : _a.event.name) || "")}</h1><p>${esc(((_b = S.pub) == null ? void 0 : _b.event.tagline) || "")}</p>${statusChip()}${timeBlock()}</div>
      <div class="card"><h2>C\xE1ch b\xECnh ch\u1ECDn</h2><ol class="steps"><li>\u0110i\u1EC1n h\u1ECD t\xEAn, MSSV, s\u1ED1 \u0111i\u1EC7n tho\u1EA1i v\xE0 Gmail, r\u1ED3i nh\u1EADp m\xE3 x\xE1c nh\u1EADn 6 s\u1ED1 g\u1EEDi v\u1EC1 Gmail c\u1EE7a b\u1EA1n.</li><li>Cho ph\xE9p chia s\u1EBB v\u1ECB tr\xED \u0111\u1EC3 ki\u1EC3m tra b\u1EA1n \u0111ang \u1EDF khu v\u1EF1c s\u1EF1 ki\u1EC7n.</li><li>Ch\u1ECDn m\u1ED9t \u0111\u1ED9i, ki\u1EC3m tra l\u1EA1i v\xE0 x\xE1c nh\u1EADn. M\u1ED7i ng\u01B0\u1EDDi m\u1ED9t phi\u1EBFu m\u1ED7i v\xF2ng.</li></ol></div>${cta}`;
    },
    code() {
      const R = S.reg, L = "display:block;margin:12px 0 4px;font-weight:600", F = 'style="text-align:left;text-transform:none;letter-spacing:normal;font-size:18px"';
      return `<div class="card"><h2>Th\xF4ng tin ng\u01B0\u1EDDi b\xECnh ch\u1ECDn</h2><p>\u0110i\u1EC1n \u0111\xFAng th\xF4ng tin c\u1EE7a b\u1EA1n. M\u1ED7i MSSV, s\u1ED1 \u0111i\u1EC7n tho\u1EA1i v\xE0 Gmail ch\u1EC9 \u0111\u01B0\u1EE3c b\xECnh ch\u1ECDn m\u1ED9t l\u1EA7n.</p>${S.err ? errMsg(S.err) : ""}
      <form id="regForm" autocomplete="on" novalidate>
      <label style="${L}" for="r_name">H\u1ECD v\xE0 t\xEAn</label><input class="field" ${F} id="r_name" autocomplete="name" maxlength="100" value="${esc(R.name)}">
      <label style="${L}" for="r_mssv">M\xE3 s\u1ED1 sinh vi\xEAn (MSSV)</label><input class="field" ${F} id="r_mssv" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="15" value="${esc(R.mssv)}">
      <label style="${L}" for="r_phone">S\u1ED1 \u0111i\u1EC7n tho\u1EA1i</label><input class="field" ${F} id="r_phone" type="tel" inputmode="tel" autocomplete="tel" maxlength="15" value="${esc(R.phone)}">
      <label style="${L}" for="r_email">Gmail (\u0111\u1EC3 nh\u1EADn m\xE3 x\xE1c nh\u1EADn)</label><input class="field" ${F} id="r_email" type="email" inputmode="email" autocapitalize="none" autocomplete="email" spellcheck="false" maxlength="80" placeholder="ten@gmail.com" value="${esc(R.email)}">
      <button class="btn block" type="submit" style="margin-top:16px" ${S.busy ? "disabled" : ""}>${S.busy ? '<span class="spinner"></span>\u0110ang g\u1EEDi m\xE3\u2026' : "G\u1EEDi m\xE3 x\xE1c nh\u1EADn"}</button></form></div>
      <a class="link" href="/">\u2190 V\u1EC1 trang t\u1ED5ng</a>`;
    },
    verify() {
      return `<div class="card"><h2>Nh\u1EADp m\xE3 x\xE1c nh\u1EADn</h2><p>M\xE3 g\u1ED3m 6 s\u1ED1 \u0111\xE3 g\u1EEDi t\u1EDBi <b>${esc(S.reg.emailMasked)}</b>. M\xE3 c\xF3 hi\u1EC7u l\u1EF1c 10 ph\xFAt. N\u1EBFu ch\u01B0a th\u1EA5y, h\xE3y ki\u1EC3m tra m\u1EE5c Th\u01B0 r\xE1c (Spam) ho\u1EB7c Qu\u1EA3ng c\xE1o.</p>${S.err ? errMsg(S.err) : ""}${S.info ? infoMsg(S.info) : ""}
      <form id="verifyForm" autocomplete="off"><input class="field" id="v_code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="\u2022\u2022\u2022\u2022\u2022\u2022" aria-label="M\xE3 x\xE1c nh\u1EADn" style="letter-spacing:8px;text-align:center;font-size:24px">
      <button class="btn block" type="submit" ${S.busy ? "disabled" : ""}>${S.busy ? '<span class="spinner"></span>\u0110ang ki\u1EC3m tra' : "X\xE1c nh\u1EADn v\xE0 b\xECnh ch\u1ECDn"}</button></form>
      <div class="stack" style="margin-top:10px"><button class="btn block ghost" data-act="resend" ${S.busy ? "disabled" : ""}>G\u1EEDi l\u1EA1i m\xE3</button><button class="btn block ghost" data-act="editinfo">S\u1EEDa th\xF4ng tin</button></div></div>`;
    },
    confirmName() {
      return `<div class="card"><h2>X\xE1c nh\u1EADn ng\u01B0\u1EDDi tham d\u1EF1</h2><p>M\xE3 n\xE0y \u0111\u01B0\u1EE3c \u0111\u0103ng k\xFD cho:</p><div style="font-size:26px;font-weight:800;margin:6px 0 16px">${esc(S.name)}</div><p>\u0110\xE2y c\xF3 \u0111\xFAng l\xE0 b\u1EA1n kh\xF4ng?</p>
      <div class="stack"><button class="btn block" data-act="nameok">\u0110\xFAng, ti\u1EBFp t\u1EE5c</button><button class="btn block ghost" data-act="notme">Kh\xF4ng ph\u1EA3i t\xF4i</button></div></div>`;
    },
    location() {
      var _a;
      const max = (_a = S.pub) == null ? void 0 : _a.settings.accuracyMaxM;
      let note = "";
      if (S.geoErr) note = `<div class="msg err" role="alert">${esc(S.geoErr.msg)}</div>${S.geoErr.help ? `<div class="msg info">${S.geoErr.help}</div>` : ""}`;
      return `<div class="card"><h2>Chia s\u1EBB v\u1ECB tr\xED</h2><p>Ch\xFAng t\xF4i c\u1EA7n v\u1ECB tr\xED c\u1EE7a b\u1EA1n <b>m\u1ED9t l\u1EA7n</b> \u0111\u1EC3 ki\u1EC3m tra b\u1EA1n \u0111ang \u1EDF khu v\u1EF1c s\u1EF1 ki\u1EC7n (b\xE1n k\xEDnh cho ph\xE9p do ban t\u1ED5 ch\u1EE9c \u0111\u1EB7t). Ch\xFAng t\xF4i kh\xF4ng l\u01B0u t\u1ECDa \u0111\u1ED9 ch\xEDnh x\xE1c, ch\u1EC9 l\u01B0u k\u1EBFt qu\u1EA3 ki\u1EC3m tra.</p>${note}
      <button class="btn block" data-act="getgeo" ${S.geoBusy ? "disabled" : ""}>${S.geoBusy ? '<span class="spinner"></span>\u0110ang x\xE1c \u0111\u1ECBnh v\u1ECB tr\xED\u2026' : S.geoErr ? "Th\u1EED l\u1EA1i" : "Cho ph\xE9p v\u1ECB tr\xED"}</button>
      ${max ? `<p style="margin-top:10px;font-size:13px;color:var(--muted)">Sai s\u1ED1 GPS c\u1EA7n \u2264 ${fmtNum(max)} m. N\xEAn b\u1EADt GPS v\xE0 Wi-Fi.</p>` : ""}</div>
      <p style="font-size:14px">G\u1EB7p l\u1ED7i GPS? H\xE3y \u0111\u1EBFn b\xE0n h\u1ED7 tr\u1EE3 \u0111\u1EC3 \u0111\u01B0\u1EE3c ki\u1EC3m tra tr\u1EF1c ti\u1EBFp.</p>`;
    },
    pick() {
      var _a, _b;
      const teams = ((_a = S.pub) == null ? void 0 : _a.teams) || [];
      const cards = teams.map((t) => `<div class="tcard" role="button" tabindex="0" data-act="select" data-id="${t.id}" aria-pressed="${S.sel === t.id}" aria-label="Ch\u1ECDn ${esc(t.name)}">
      <img class="ph" src="${esc(t.photo)}" alt="" loading="lazy">${t.isSample ? '<span class="sample">D\u1EEE LI\u1EC6U M\u1EAAU</span>' : ""}<span class="tick">\u2713</span>
      <div class="info"><div class="code">${esc(t.code)}</div><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div><div class="gn">${esc(t.genre)}${t.members ? ` \xB7 ${t.members} th\xE0nh vi\xEAn` : ""}</div>
      <a class="detail" href="/teams/${t.id}?from=vote" data-stop>Xem chi ti\u1EBFt \u2192</a></div></div>`).join("");
      return `<div class="card"><span style="color:var(--muted);font-size:14px">Xin ch\xE0o,</span><div style="font-weight:800;font-size:20px">${esc(S.name)}</div>${statusChip()}${timeBlock()}</div>
      <h2 style="margin:6px 2px 10px">Ch\u1ECDn m\u1ED9t \u0111\u1ED9i</h2>${S.err ? errMsg(S.err) : ""}<div class="teams">${cards}</div>
      <div class="sticky"><div class="in"><button class="btn block" data-act="topick" ${S.sel ? "" : "disabled"}>${S.sel ? `Ti\u1EBFp t\u1EE5c v\u1EDBi \u201C${esc(((_b = teamById(S.sel)) == null ? void 0 : _b.name) || "")}\u201D` : "H\xE3y ch\u1ECDn m\u1ED9t \u0111\u1ED9i"}</button></div></div>`;
    },
    confirm() {
      const t = teamById(S.sel);
      if (!t) return '<div class="card">Kh\xF4ng t\xECm th\u1EA5y \u0111\u1ED9i.</div>';
      const pend = S.pending && S.pending.teamId === S.sel;
      return `<div class="card pickedpreview"><h2>X\xE1c nh\u1EADn b\xECnh ch\u1ECDn</h2><img src="${esc(t.photo)}" alt=""><div class="nm">${esc(t.name)}</div><div class="pf">${esc(t.perfTitle)}</div></div>
      ${S.err ? errMsg(S.err) : ""}
      ${S.offline ? '<div class="msg warn" role="alert"><b>Phi\u1EBFu CH\u01AFA \u0111\u01B0\u1EE3c ghi nh\u1EADn.</b> L\u1EF1a ch\u1ECDn c\u1EE7a b\u1EA1n \u0111ang \u0111\u01B0\u1EE3c gi\u1EEF tr\xEAn m\xE1y. H\xE3y b\u1EA5m g\u1EEDi l\u1EA1i khi c\xF3 m\u1EA1ng \u2014 h\u1EC7 th\u1ED1ng d\xF9ng c\xF9ng m\xE3 y\xEAu c\u1EA7u n\xEAn s\u1EBD kh\xF4ng t\u1EA1o phi\u1EBFu tr\xF9ng.</div>' : '<div class="msg info">Sau khi g\u1EEDi, phi\u1EBFu <b>kh\xF4ng th\u1EC3 thay \u0111\u1ED5i</b>.</div>'}
      <div class="stack"><button class="btn gold block" data-act="submit" ${S.busy ? "disabled" : ""}>${S.busy ? '<span class="spinner"></span>\u0110ang g\u1EEDi\u2026' : pend ? "G\u1EEDi l\u1EA1i phi\u1EBFu" : "X\xE1c nh\u1EADn b\xECnh ch\u1ECDn"}</button>
      <button class="btn ghost block" data-act="rechoose" ${S.busy ? "disabled" : ""}>Ch\u1ECDn l\u1EA1i</button></div>`;
    },
    success() {
      const rc = S.receipt;
      return `<div class="success"><div class="ringok" aria-hidden="true">\u2713</div><h1>Phi\u1EBFu c\u1EE7a b\u1EA1n \u0111\xE3 \u0111\u01B0\u1EE3c ghi nh\u1EADn</h1><p>B\u1EA1n \u0111\xE3 b\xECnh ch\u1ECDn cho <b style="color:var(--ivory)">${esc(rc.teamName)}</b>.</p><p>M\xE3 bi\xEAn nh\u1EADn: <span class="receipt">${esc(rc.receipt)}</span></p></div>
      <div class="stack" style="margin-top:14px"><button class="btn block" data-act="follow">Theo d\xF5i k\u1EBFt qu\u1EA3</button></div>`;
    },
    follow() {
      var _a, _b, _c;
      const r = round();
      const me = S.myVote;
      const res = (_a = S.pub) == null ? void 0 : _a.results;
      const hidden = !res && !((_b = S.pub) == null ? void 0 : _b.revealed.length);
      let body = "";
      if (res) {
        body = `<div class="res">${res.rows.map((x) => {
          const t = teamById(x.teamId);
          return `<div class="r${me && me.teamId === x.teamId ? " me" : ""}"><b class="rk">${x.rank}</b><span class="n">${esc((t == null ? void 0 : t.name) || "")}</span><span class="v">${fmtNum(x.votes)}</span></div>`;
        }).join("")}</div><p style="margin-top:10px;font-size:14px">T\u1ED5ng phi\u1EBFu h\u1EE3p l\u1EC7: ${fmtNum(res.total)}</p>`;
      } else if ((_c = S.pub) == null ? void 0 : _c.revealed.length) {
        body = `<div class="res">${S.pub.revealed.slice().reverse().map((g) => `<div class="r"><b class="rk">${g.rank}</b><span class="n">${g.teamIds.map((id) => {
          var _a2;
          return esc(((_a2 = teamById(id)) == null ? void 0 : _a2.name) || "");
        }).join(", ")}</span><span class="v">${fmtNum(g.votes)}</span></div>`).join("")}</div>`;
      } else body = infoMsg((r == null ? void 0 : r.status) === "open" ? "K\u1EBFt qu\u1EA3 \u0111ang \u0111\u01B0\u1EE3c gi\u1EEF k\xEDn ho\u1EB7c ch\u01B0a c\xF4ng khai. H\xE3y theo d\xF5i tr\xEAn m\xE0n h\xECnh s\xE2n kh\u1EA5u." : "K\u1EBFt qu\u1EA3 s\u1EBD \u0111\u01B0\u1EE3c c\xF4ng b\u1ED1 tr\xEAn s\xE2n kh\u1EA5u.");
      return `<div class="card"><h2>${me ? "B\u1EA1n \u0111\xE3 b\xECnh ch\u1ECDn" : "Tr\u1EA1ng th\xE1i b\xECnh ch\u1ECDn"}</h2>${statusChip()}${timeBlock()}${me ? `<p style="margin-top:10px">\u0110\u1ED9i b\u1EA1n ch\u1ECDn: <b style="color:var(--ivory)">${esc(me.teamName)}</b><br>M\xE3 bi\xEAn nh\u1EADn: <span class="receipt">${esc(me.receipt)}</span></p>` : ""}${me ? '<p style="font-size:14px">M\u1ED7i ng\u01B0\u1EDDi ch\u1EC9 \u0111\u01B0\u1EE3c m\u1ED9t phi\u1EBFu m\u1ED7i v\xF2ng, kh\xF4ng th\u1EC3 g\u1EEDi th\xEAm.</p>' : ""}</div>
      <div class="card"><h2>K\u1EBFt qu\u1EA3</h2>${body}</div>${!me && isOpen() ? '<button class="btn block" data-act="join">B\xECnh ch\u1ECDn ngay</button>' : ""}`;
    },
    closed() {
      return `<div class="card"><h2>V\xF2ng b\xECnh ch\u1ECDn \u0111\xE3 k\u1EBFt th\xFAc</h2><p>Phi\u1EBFu g\u1EEDi sau th\u1EDDi h\u1EA1n c\u1EE7a m\xE1y ch\u1EE7 kh\xF4ng \u0111\u01B0\u1EE3c t\xEDnh. Xin c\u1EA3m \u01A1n b\u1EA1n \u0111\xE3 tham gia!</p></div><button class="btn block ghost" data-act="follow">Xem tr\u1EA1ng th\xE1i</button>`;
    },
    outofrange() {
      return `<div class="card"><h2>Ngo\xE0i khu v\u1EF1c b\xECnh ch\u1ECDn</h2>${S.err ? errMsg(S.err) : ""}<p>H\u1EC7 th\u1ED1ng th\u1EA5y v\u1ECB tr\xED c\u1EE7a b\u1EA1n n\u1EB1m ngo\xE0i khu v\u1EF1c \u0111\u01B0\u1EE3c ph\xE9p. N\u1EBFu b\u1EA1n \u0111ang \u1EDF h\u1ED9i tr\u01B0\u1EDDng, h\xE3y \u0111\u1EBFn <b>b\xE0n h\u1ED7 tr\u1EE3</b> \u0111\u1EC3 \u0111\u01B0\u1EE3c ki\u1EC3m tra tr\u1EF1c ti\u1EBFp.</p></div><button class="btn block ghost" data-act="getgeo-again">Th\u1EED l\u1EA5y l\u1EA1i v\u1ECB tr\xED</button>`;
    }
  };
  function render() {
    var _a, _b;
    const rb = $("#ribbon");
    rb.hidden = !((_a = S.pub) == null ? void 0 : _a.demo);
    app.innerHTML = (V[S.view] || V.welcome)();
    if (S.view === "verify") (_b = $("#v_code")) == null ? void 0 : _b.focus();
  }
  async function afterLogin() {
    try {
      const me = await api("/api/me", { token: S.token });
      clock.sync(me.serverNow);
      S.myVote = me.vote;
      S.name = me.name;
      store.set("gdta.name", me.name);
    } catch (e) {
      if (e.status === 401) {
        logout();
        S.err = e.message;
        return go("code");
      }
    }
  }
  function logout() {
    S.token = null;
    S.name = null;
    S.myVote = null;
    store.del("gdta.token");
    store.del("gdta.name");
  }
  async function nextStep() {
    var _a;
    if (S.myVote) return go("follow");
    if (!isOpen()) return go("closed");
    if (((_a = S.pub) == null ? void 0 : _a.settings.locationEnabled) && !geoFresh()) return go("location");
    S.sel = S.sel || (S.pick && teamById(Number(S.pick)) ? Number(S.pick) : null);
    go("pick");
  }
  var geoFresh = () => S.geo && Date.now() - S.geo.measuredAt < 10 * 60 * 1e3;
  var GEO_HELP = {
    1: { msg: "B\u1EA1n \u0111\xE3 t\u1EEB ch\u1ED1i quy\u1EC1n v\u1ECB tr\xED.", help: "H\xE3y m\u1EDF <b>C\xE0i \u0111\u1EB7t tr\xECnh duy\u1EC7t \u2192 Quy\u1EC1n c\u1EE7a trang web \u2192 V\u1ECB tr\xED \u2192 Cho ph\xE9p</b>, r\u1ED3i b\u1EA5m \u201CTh\u1EED l\u1EA1i\u201D. Tr\xEAn iPhone: C\xE0i \u0111\u1EB7t \u2192 Quy\u1EC1n ri\xEAng t\u01B0 \u2192 D\u1ECBch v\u1EE5 \u0111\u1ECBnh v\u1ECB." },
    2: { msg: "Kh\xF4ng x\xE1c \u0111\u1ECBnh \u0111\u01B0\u1EE3c v\u1ECB tr\xED. H\xE3y b\u1EADt GPS/Wi-Fi.", help: "" },
    3: { msg: "X\xE1c \u0111\u1ECBnh v\u1ECB tr\xED qu\xE1 l\xE2u. H\xE3y th\u1EED l\u1EA1i \u1EDF n\u01A1i tho\xE1ng h\u01A1n.", help: "" }
  };
  function measure(timeout = 15e3) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject({ code: 2, message: "Tr\xECnh duy\u1EC7t kh\xF4ng h\u1ED7 tr\u1EE3 \u0111\u1ECBnh v\u1ECB." });
      if (!isSecureContext) return reject({ code: 2, message: "Trang c\u1EA7n ch\u1EA1y qua HTTPS \u0111\u1EC3 d\xF9ng v\u1ECB tr\xED." });
      navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, posTs: p.timestamp, measuredAt: Date.now() }), reject, { enableHighAccuracy: true, timeout, maximumAge: 0 });
    });
  }
  async function getGeo(thenView = "pick") {
    var _a;
    S.geoBusy = true;
    S.geoErr = null;
    render();
    try {
      const g = await measure();
      const max = (_a = S.pub) == null ? void 0 : _a.settings.accuracyMaxM;
      if (max && g.accuracy > max) {
        S.geo = null;
        S.geoErr = { msg: `V\u1ECB tr\xED ch\u01B0a \u0111\u1EE7 ch\xEDnh x\xE1c (sai s\u1ED1 kho\u1EA3ng ${Math.round(g.accuracy)} m).`, help: "H\xE3y b\u1EADt GPS v\xE0 Wi-Fi, ra n\u01A1i tho\xE1ng r\u1ED3i b\u1EA5m \u201CTh\u1EED l\u1EA1i\u201D." };
      } else {
        S.geo = g;
      }
    } catch (e) {
      S.geoErr = GEO_HELP[e.code] || { msg: e.message || "Kh\xF4ng l\u1EA5y \u0111\u01B0\u1EE3c v\u1ECB tr\xED.", help: "" };
    }
    S.geoBusy = false;
    if (S.geo) {
      S.sel = S.sel || (S.pick && teamById(Number(S.pick)) ? Number(S.pick) : null);
      return go(thenView);
    }
    render();
  }
  async function submit() {
    var _a, _b, _c, _d, _e;
    if (S.busy) return;
    S.busy = true;
    S.err = null;
    render();
    try {
      if (!S.pending || S.pending.teamId !== S.sel || S.pending.roundId !== ((_a = round()) == null ? void 0 : _a.id)) {
        S.pending = { teamId: S.sel, roundId: (_b = round()) == null ? void 0 : _b.id, idemKey: uuid() };
        store.set("gdta.pending", S.pending);
      }
      let geo;
      if ((_c = S.pub) == null ? void 0 : _c.settings.locationEnabled) {
        if (!S.geo || Date.now() - S.geo.measuredAt > 45e3) {
          S.geo = await measure().catch((e) => {
            throw Object.assign(new Error((GEO_HELP[e.code] || {}).msg || e.message), { geoFail: true });
          });
        }
        geo = { lat: S.geo.lat, lng: S.geo.lng, accuracy: S.geo.accuracy, ageMs: Math.max(0, Date.now() - S.geo.posTs) };
      }
      const r = await api("/api/vote", { method: "POST", token: S.token, body: { roundId: S.pending.roundId, teamId: S.pending.teamId, idemKey: S.pending.idemKey, geo } });
      S.receipt = r.receipt;
      S.myVote = { receipt: r.receipt.receipt, teamId: r.receipt.teamId, teamName: r.receipt.teamName };
      S.pending = null;
      store.del("gdta.pending");
      S.offline = false;
      S.busy = false;
      if (S.prefs.sound) ting();
      if (S.prefs.vib) (_d = navigator.vibrate) == null ? void 0 : _d.call(navigator, [60]);
      return go("success");
    } catch (e) {
      S.busy = false;
      if (e.network) {
        S.offline = true;
        S.err = "M\u1EA5t k\u1EBFt n\u1ED1i ho\u1EB7c m\u1EA1ng qu\xE1 ch\u1EADm \u2014 phi\u1EBFu ch\u01B0a \u0111\u01B0\u1EE3c x\xE1c nh\u1EADn.";
        return render();
      }
      S.offline = false;
      if (e.geoFail) {
        S.geoErr = { msg: e.message, help: "" };
        S.geo = null;
        return go("location");
      }
      switch (e.code) {
        case "ALREADY_VOTED": {
          const rc = (_e = e.data) == null ? void 0 : _e.receipt;
          S.myVote = rc ? { receipt: rc.receipt, teamId: rc.teamId, teamName: rc.teamName } : S.myVote;
          S.pending = null;
          store.del("gdta.pending");
          return go("follow");
        }
        case "ROUND_CLOSED":
        case "NOT_OPEN":
          S.pending = null;
          store.del("gdta.pending");
          return go("closed");
        case "UNAUTHORIZED":
          logout();
          S.err = e.message;
          return go("code");
        case "OUT_OF_RANGE":
          S.err = e.message;
          return go("outofrange");
        case "GPS_REQUIRED":
        case "GPS_INVALID":
        case "GPS_STALE":
        case "GPS_INACCURATE":
          S.geo = null;
          S.geoErr = { msg: e.message, help: "H\xE3y b\u1EA5m \u201CTh\u1EED l\u1EA1i\u201D \u0111\u1EC3 l\u1EA5y v\u1ECB tr\xED m\u1EDBi." };
          return go("location");
        case "ROUND_CHANGED":
          S.pending = null;
          store.del("gdta.pending");
          await poll(true);
          return go("welcome");
        default:
          S.err = e.message;
          return render();
      }
    }
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-stop]")) return;
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;
    if (act === "join") {
      if (S.token) {
        if (!S.name) await afterLogin();
        return nextStep();
      }
      return go("code");
    }
    if (act === "back") return go("welcome");
    if (act === "follow") return go("follow");
    if (act === "nameok") return nextStep();
    if (act === "editinfo") return go("code");
    if (act === "resend") return doRegister(true);
    if (act === "notme") {
      logout();
      S.codeDraft = "";
      return go("code");
    }
    if (act === "getgeo" || act === "getgeo-again") return getGeo(act === "getgeo-again" ? "pick" : "pick");
    if (act === "select") {
      S.sel = Number(el.dataset.id);
      return render();
    }
    if (act === "topick") return go("confirm");
    if (act === "rechoose") {
      if (S.pending) {
        S.pending = null;
        store.del("gdta.pending");
      }
      S.offline = false;
      return go("pick");
    }
    if (act === "submit") return submit();
  });
  document.addEventListener("keydown", (e) => {
    var _a, _b;
    if ((e.key === "Enter" || e.key === " ") && ((_b = (_a = e.target).matches) == null ? void 0 : _b.call(_a, ".tcard"))) {
      e.preventDefault();
      e.target.click();
    }
  });
  async function doCheckin(code) {
    if (S.busy) return;
    S.busy = true;
    S.err = null;
    render();
    try {
      const r = await api("/api/checkin", { method: "POST", body: { code } });
      S.token = r.token;
      S.name = r.name;
      store.set("gdta.token", r.token);
      store.set("gdta.name", r.name);
      S.busy = false;
      await afterLogin();
      go(S.myVote ? "follow" : "confirmName");
    } catch (err) {
      S.busy = false;
      S.err = err.message;
      S.view = "code";
      render();
    }
  }
  async function doRegister(resend = false) {
    if (S.busy) return;
    if (!resend) {
      const v = (id) => {
        var _a, _b;
        return (_b = (_a = $(id)) == null ? void 0 : _a.value) != null ? _b : "";
      };
      S.reg = __spreadProps(__spreadValues({}, S.reg), { name: v("#r_name"), mssv: v("#r_mssv"), phone: v("#r_phone"), email: v("#r_email") });
    }
    S.busy = true;
    S.err = null;
    S.info = null;
    render();
    try {
      const r = await api("/api/register", { method: "POST", body: { name: S.reg.name, mssv: S.reg.mssv, phone: S.reg.phone, email: S.reg.email }, timeout: 25e3 });
      S.reg.emailMasked = r.email;
      S.busy = false;
      if (resend) {
        S.view = "verify";
        S.info = "\u0110\xE3 g\u1EEDi l\u1EA1i m\xE3 v\xE0o Gmail c\u1EE7a b\u1EA1n.";
        render();
      } else go("verify");
    } catch (err) {
      S.busy = false;
      S.err = err.message;
      S.view = resend ? "verify" : "code";
      render();
    }
  }
  async function doVerify() {
    var _a;
    if (S.busy) return;
    const code = (((_a = $("#v_code")) == null ? void 0 : _a.value) || "").replace(/\D/g, "");
    if (code.length !== 6) {
      S.err = "Vui l\xF2ng nh\u1EADp \u0111\u1EE7 6 s\u1ED1.";
      S.info = null;
      return render();
    }
    S.busy = true;
    S.err = null;
    S.info = null;
    render();
    try {
      const r = await api("/api/verify", { method: "POST", body: { email: S.reg.email, code } });
      S.token = r.token;
      S.name = r.name;
      store.set("gdta.token", r.token);
      store.set("gdta.name", r.name);
      S.busy = false;
      await afterLogin();
      await nextStep();
    } catch (err) {
      S.busy = false;
      S.err = err.message;
      S.view = "verify";
      render();
    }
  }
  document.addEventListener("submit", (e) => {
    if (e.target.id === "regForm") {
      e.preventDefault();
      doRegister();
    } else if (e.target.id === "verifyForm") {
      e.preventDefault();
      doVerify();
    }
  });
  addEventListener("online", () => {
    if (S.view === "confirm" && S.offline && S.pending) submit();
  });
  async function poll(force = false) {
    var _a, _b, _c;
    try {
      const s = await api(`/api/public/state${!force && S.pub ? `?v=${S.pub.version}` : ""}`, { timeout: 8e3 });
      clock.sync(s.serverNow);
      if (!s.unchanged && (!S.pub || s.version >= S.pub.version)) {
        const prevRound = (_b = (_a = S.pub) == null ? void 0 : _a.round) == null ? void 0 : _b.id;
        S.pub = s;
        if (prevRound !== void 0 && prevRound !== ((_c = s.round) == null ? void 0 : _c.id) && S.token) {
          S.myVote = null;
          afterLogin().then(() => render());
        }
        if (S.view === "welcome" || S.view === "follow" || S.view === "pick") render();
        if (["pick", "confirm"].includes(S.view) && !isOpen() && !S.myVote) {
          go("closed");
        }
      }
    } catch (e) {
    }
  }
  setInterval(() => {
    poll();
  }, 4e3);
  setInterval(() => {
    const el = $("#tleft");
    const r = round();
    if (el && r) el.textContent = fmtClock(r.closesAt - clock.now());
    if (r && ["pick", "confirm", "welcome"].includes(S.view) && r.status === "open" && clock.now() >= r.closesAt && !S.busy) {
      if (S.view !== "welcome") go("closed");
      else render();
    }
  }, 500);
  async function main() {
    await poll(true);
    const urlCode = new URLSearchParams(location.search).get("code");
    if (urlCode) {
      history.replaceState(null, "", location.pathname + (S.pick ? `?pick=${encodeURIComponent(S.pick)}` : ""));
    }
    if (S.token) await afterLogin();
    if (urlCode) {
      S.codeDraft = urlCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
      S.codeDraft = S.codeDraft.length > 5 ? `${S.codeDraft.slice(0, 5)}-${S.codeDraft.slice(5)}` : S.codeDraft;
      await doCheckin(S.codeDraft);
    } else if (S.pick && S.token && S.name && !S.myVote && isOpen()) {
      await nextStep();
    } else render();
  }
  main().catch((e) => {
    console.error(e);
    const a = document.getElementById("app");
    if (a) a.innerHTML = '<div class="card"><h2>Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c trang</h2><p>Vui l\xF2ng t\u1EA3i l\u1EA1i trang. N\u1EBFu v\u1EABn l\u1ED7i, h\xE3y m\u1EDF b\u1EB1ng Chrome ho\u1EB7c Safari.</p></div>';
  });
})();
