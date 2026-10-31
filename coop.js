/* =====================================================================
 * coop.js — modo online cooperativo (3 jogadores).
 *
 * O servidor (server.py) roda a simulação; aqui só enviamos a direção e desenhamos o que ele manda.
 * Telas: conectar -> sala (lobby: escolher papel e fase) -> jogo.
 * Nada daqui toca na campanha, nas missões, nas fases criadas ou no progresso salvo; as únicas
 * coisas guardadas são o seu apelido e (fora do servidor oficial) o endereço do servidor.
 * ===================================================================== */
(function () {
  "use strict";
  const API = window.GameAPI;
  const $ = (id) => document.getElementById(id);
  // navegadores mais antigos não têm roundRect: sem isto o desenho dava erro e a tela congelava
  if (window.CanvasRenderingContext2D && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.max(0, Math.min(Array.isArray(r) ? r[0] || 0 : r || 0, w / 2, h / 2));
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }
  const panel = $("coop");
  if (!API || !panel) return;

  const LS_NAME = "dez-segundos-online-apelido", LS_URL = "dez-segundos-online-servidor", SS_SESSION = "dez-segundos-online-sessao";
  const W = 800, H = 500;
  const GATE_COL = ["#19f0ff", "#ff3df2", "#ffd23f", "#39ff88", "#ff8a3d", "#b58cff"];
  const GATE_SYM = ["◆", "●", "▲", "■", "★", "✚"];
  const EXIT_HALF = 36;   // a saída é uma área de 72x72 (igual ao servidor)
  // ---- movimento: mesma regra do servidor (coop_sim.py) para PREVER o boneco local sem esperar a rede
  const SPEED = 260, STEP = 3, PLAYER_R = 11, STEPDT = 1 / 60, INTERP = 0.09, EXTRAP_MAX = 0.1;
  const _D = 0.7071067811865476;
  const DIRS = [[0, 0], [1, 0], [_D, _D], [0, 1], [-_D, _D], [-1, 0], [-_D, -_D], [0, -1], [_D, -_D]];   // 0 parado, 1..8: E SE S SW W NW N NE
  // medições reais do painel de diagnóstico (nada aqui é estimado)
  const D = { resyncs: 0, lastResync: "", mismatch: 0, snapAt: 0, evAt: 0, on: false, frames: [], rtts: [], snapT: [], rxB: [], cmdMsg: [], cmdN: [], corr: [], stale: 0, dup: 0, lastCorr: 0, worst: 0 };
  const BUILD = "2026-11-01-r1";   // versão desta página (o servidor confere: página antiga = elementos que podem não aparecer)
  const ENT_KEYS = ["walls", "plates", "gates", "spikes", "lasers", "saws", "drones", "portals"];
  const PRESETS = [10, 15, 20, 25, 30, 45, 60];
  const MARKS = [["📍", "Aqui!"], ["🆘", "Preciso de ajuda!"], ["🚪", "Vá para a saída!"]];
  const EMOS = [["👍", "Beleza!"], ["✋", "Espera!"], ["👉", "Vem aqui!"], ["⚠️", "Cuidado!"], ["🔑", "Pega a chave!"], ["🆘", "Preciso de ajuda!"]];
  const WHY = { spike: "Espinhos atingiram", laser: "O laser atingiu", saw: "Uma serra atingiu", drone: "Um drone atingiu", crush: "Uma porta fechou sobre" };  // sem culpar ninguém
  const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const ssGet = (k) => { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const ssSet = (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} };
  const RM = () => !!(API.RM && API.RM());
  const sfx = (n) => { try { API.Sfx.play(n); } catch (e) {} };

  const C = {
    ws: null, url: "", same: false, probed: false, hi: null, you: null, code: "", token: "", room: null, level: null, roles: [],
    view: "connect", snap: null, snapAt: 0, sel: null, off: null, att: 0, pr: null, hist: [], seq: 1, acc: 0, outbox: [], flushedCode: 0, lastFlush: 0, lastCode: 0, dispOff: { x: 0, y: 0 }, ring: [], lastI: 0, marks: [], armed: -1, armT: 0, lastMark: 0, shown: [null, null, null], pose: [null, null, null], emos: [], rtt: null, closing: false, retryTimer: 0, retryStart: 0,
    lastCount: -1, result: null, loseUntil: 0, loseText: "", lastFrame: 0, raf: 0, sentDir: [0, 0], dirAt: 0, goFlash: 0, pausedBy: -1,
  };

  /* ------------------------------------------------------------------ telas */
  function showView(v) {
    C.view = v;
    ["connect", "lobby", "game"].forEach((n) => $("co-" + n).classList.toggle("hidden", n !== v));
    document.body.classList.toggle("co-playing", v === "game");
    if (v === "game") { resizeCanvas(); startLoop(); } else stopLoop();
    releaseDir();
    const f = panel.querySelector(`#co-${v} button:not(:disabled), #co-${v} input:not(:disabled)`);
    if (f && v !== "game") f.focus({ preventScroll: true });
  }
  function banner(text, kind, ms) {
    // no jogo o aviso aparece em cima do mapa (não empurra o layout); nas outras telas fica no topo do painel
    for (const id of ["co-banner", "co-banner2"]) { const e = $(id); if (e.textContent) { e.textContent = ""; e.className = ""; } }
    const el = $(C.view === "game" ? "co-banner2" : "co-banner");
    el.textContent = text || "";
    el.className = text ? kind || "info" : "";
    clearTimeout(banner.t);
    if (text && ms) banner.t = setTimeout(() => { if (el.textContent === text) { el.textContent = ""; el.className = ""; } }, ms);
  }

  function open() {
    document.querySelectorAll(".ed-panel").forEach((el) => { if (el !== panel) el.classList.add("hidden"); });
    panel.classList.remove("hidden");
    document.body.classList.add("editing", "ed-lists");
    API.releaseInput();
    API.G.state = "editor"; API.G.custom = false;
    API.hideOverlay();
    $("co-name").value = lsGet(LS_NAME);
    $("co-code").value = "";
    const q = new URLSearchParams(location.search).get("sala");
    if (q && /^[A-Za-z]{4}$/.test(q)) $("co-code").value = q.toUpperCase();
    banner("");
    if (C.code && C.ws) { showView(C.room && C.room.phase === "playing" && C.level ? "game" : "lobby"); renderLobby(); return; }
    showView("connect");
    probeServer();
  }
  function close(toMenu) {
    C.closing = true;
    clearTimeout(C.retryTimer);
    try { if (C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify({ t: "leave" })); } catch (e) {}
    try { if (C.ws) C.ws.close(); } catch (e) {}
    C.ws = null; C.code = ""; C.token = ""; C.room = null; C.level = null; C.snap = null; C.result = null; C.hi = null;
    ssSet(SS_SESSION, "");
    stopLoop();
    panel.classList.add("hidden");
    document.body.classList.remove("editing", "ed-lists", "co-playing");
    $("co-pop").classList.add("hidden");
    if (toMenu !== false) API.showMenu();
  }

  /* ------------------------------------------------------------------ conexão */
  async function probeServer() {
    $("co-srv-row").classList.add("hidden");
    $("co-url").value = lsGet(LS_URL);
    if (location.protocol === "http:" || location.protocol === "https:") {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 2500);
        const r = await fetch("/health", { cache: "no-store", signal: ctl.signal }); clearTimeout(to);
        const j = await r.json();
        if (j && j.ok) { C.same = true; C.probed = true; $("co-srv-note").textContent = ""; return; }
      } catch (e) { /* não é o nosso servidor */ }
    }
    C.same = false; C.probed = true;
    $("co-srv-row").classList.remove("hidden");
    $("co-srv-note").textContent = "Este endereço não é o servidor do jogo. Cole abaixo o endereço do servidor online (começa com wss:// ou https://).";
  }
  function serverUrl() {
    if (C.same) return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    let u = $("co-url").value.trim();
    if (!u) return "";
    if (/^https:\/\//i.test(u)) u = "wss://" + u.slice(8); else if (/^http:\/\//i.test(u)) u = "ws://" + u.slice(7);
    if (!/^wss?:\/\/[^\s/]+/i.test(u)) return "";
    if (!/\/ws$/i.test(u)) u = u.replace(/\/+$/, "") + "/ws";
    return u;
  }
  function openSocket(url) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error("Endereço inválido.")); return; }
      const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error("O servidor não respondeu. Se ele estava dormindo, espere um minuto e tente de novo.")); }, 15000);
      let done = false;
      ws.onmessage = (ev) => {
        D.rxB.push([performance.now(), ev.data.length]);
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!done && m.t === "hi") { done = true; clearTimeout(to); C.ws = ws; C.hi = m; wire(ws); resolve(m); return; }
        if (done) route(m);
      };
      ws.onerror = () => { if (!done) { clearTimeout(to); reject(new Error("Não foi possível conectar ao servidor.")); } };
      ws.onclose = () => { if (!done) { clearTimeout(to); reject(new Error("Não foi possível conectar ao servidor.")); } else onClose(ws); };
    });
  }
  function wire(ws) {
    clearInterval(wire.ping);
    wire.ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ping", ts: Date.now() })); }, 2000);
    ws.send(JSON.stringify({ t: "ping", ts: Date.now() }));
  }
  const send = (o) => { if (C.ws && C.ws.readyState === 1) C.ws.send(JSON.stringify(o)); };

  async function enter(kind) {
    const url = serverUrl();
    if (!url) { banner("Informe o endereço do servidor.", "bad"); return; }
    const name = $("co-name").value.trim().slice(0, 14);
    const code = $("co-code").value.trim().toUpperCase();
    if (kind === "join" && !/^[A-Z]{4}$/.test(code)) { banner("O código da sala tem 4 letras.", "bad"); $("co-code").focus(); return; }
    lsSet(LS_NAME, name);
    if (!C.same) lsSet(LS_URL, $("co-url").value.trim());
    setBusy(true); banner("Conectando…", "info");
    try {
      if (!C.ws || C.ws.readyState !== 1) { C.url = url; C.closing = false; await openSocket(url); }
      const skin = mySkin();
      send(kind === "create" ? { t: "create", name, skin, build: BUILD } : { t: "join", code, name, skin, build: BUILD });
    } catch (e) { banner(e.message, "bad"); setBusy(false); }
  }
  function mySkin() { try { return API.equippedSkin ? API.equippedSkin() : "explorer"; } catch (e) { return "explorer"; } }
  function setBusy(b) { ["co-create", "co-join"].forEach((id) => { $(id).disabled = b; }); }

  function onClose(ws) {
    if (ws !== C.ws) return;
    clearInterval(wire.ping);
    C.ws = null;
    if (C.closing) return;
    if (C.code && C.token) { C.retryStart = Date.now(); banner("Conexão perdida. Tentando voltar…", "bad"); retry(0); return; }
    setBusy(false);
    banner("A conexão com o servidor foi encerrada.", "bad");
    C.room = null; C.level = null; C.code = "";
    showView("connect");
  }
  function retry(n) {
    clearTimeout(C.retryTimer);
    if (C.closing) return;
    if (Date.now() - C.retryStart > 40000) { give("Não foi possível voltar para a sala."); return; }
    C.retryTimer = setTimeout(async () => {
      try { await openSocket(C.url); send({ t: "rejoin", code: C.code, token: C.token }); }
      catch (e) { retry(n + 1); }
    }, Math.min(4000, 800 + n * 600));
  }
  function give(msg) {
    C.code = ""; C.token = ""; C.room = null; C.level = null; ssSet(SS_SESSION, "");
    setBusy(false); banner(msg, "bad"); showView("connect");
  }

  /* ------------------------------------------------------------------ mensagens */
  function route(m) {
    switch (m.t) {
      case "joined":
        C.you = m.you; C.code = m.code; C.token = m.token;
        ssSet(SS_SESSION, JSON.stringify({ url: C.url, code: m.code, token: m.token }));
        setBusy(false); banner(m.back ? "Você voltou para a sala!" : "", "good", 2500);
        if (!C.room || C.view === "connect") showView("lobby");
        break;
      case "room": C.room = m; if (m.build && m.build !== BUILD && !C.warnedBuild) { C.warnedBuild = true; banner("Sua página está desatualizada em relação ao servidor. Recarregue com ⌘⇧R (Ctrl+Shift+R) para ver todos os elementos.", "bad", 12000); } renderLobby(); updateChips(); updatePaused(); if (C.resultMsg) renderResult(); break;
      case "level": {
        // Estado COMPLETO da fase (mapa + versão + entidades + número da partida). Um reenvio (resync) só troca o cenário, sem reiniciar nada.
        const same = m.resync && C.gid === m.gid && C.snap;
        C.gid = m.gid; C.lvAt = performance.now(); C.mver = m.mver; C.entSrv = m.ent || null; C.srvBuild = m.build || null;
        C.level = m.level; C.roles = m.roles; C.total = m.total;
        if (!same) {
          hideResult(); C.expInfo = m.exp || null;
          C.snap = null; C.pr = null; C.hist = []; C.outbox = []; C.ring = []; C.lastI = 0; C.result = null; C.att = 0; C.shown = [null, null, null]; C.pose = [null, null, null]; C.wonAt = 0; C.emos = []; C.marks = []; C.armed = -1; C.lastCount = -1;
          buildChips(); showView("game"); sfx("blip");
        }
        // a fase está pronta neste navegador: confirma QUAL partida e QUANTAS entidades preparou (a contagem só começa quando TODOS confirmarem igual)
        { let sent = false; const ok = () => { if (!sent) { sent = true; send({ t: "loaded", g: m.gid, ent: entCounts(m.level) }); } };
          requestAnimationFrame(() => requestAnimationFrame(ok)); setTimeout(ok, 600); }   // aba em segundo plano: o rAF não roda, o aviso sai mesmo assim
        break;
      }
      case "s": onSnap(m); break;
      case "notice": banner(m.msg, "info", 9000); break;
      case "fps": C.fpsMsg = m; break;
      case "ckpt": try { saveCkpt(m); } catch (e) {} break;
      case "result": C.resultMsg = m; C.contSent = null; renderResult(); sfx("win"); break;
      case "ev": if (m.g != null && C.gid != null && m.g !== C.gid) { D.stale++; break; } D.evAt = performance.now(); if (m.i != null) { if (m.i <= C.lastI) { D.dup++; break; } C.lastI = m.i; } if (m.a != null && m.a < C.att) { D.stale++; break; } if (m.a > C.att) C.att = m.a; onEvent(m.e); break;   // evento atrasado de tentativa anterior é descartado
      case "mark": C.marks.push({ s: m.s, k: m.k, x: m.x, y: m.y, until: performance.now() + 5000 }); sfx("blip"); break;
      case "stopped": hideResult(); C.expInfo = null; C.level = null; C.snap = null; C.result = null; C.marks = []; C.armed = -1; if (C.view === "game") showView("lobby"); renderLobby(); banner(m.why || "", m.why && m.why.includes("zeraram") ? "good" : "bad", 9000); break;
      case "emo": C.emos.push({ s: m.s, k: m.k, until: performance.now() + 2500 }); sfx("blip"); break;
      case "pong": C.rtt = Date.now() - m.ts; D.rtts.push(C.rtt); if (D.rtts.length > 12) D.rtts.shift(); $("co-ping").textContent = C.rtt + " ms"; break;
      case "err":
        setBusy(false); banner(m.msg, "bad", 5000);
        if (/voltar para a sala/.test(m.msg)) give(m.msg);
        break;
    }
  }
  function onSnap(m) {
    if (m.gd != null && C.gid != null && m.gd !== C.gid) { D.stale++; return; }   // quadro de OUTRA partida/fase
    if (m.a < C.att) return;                       // quadro atrasado de uma tentativa anterior
    D.snapAt = performance.now();
    if (m.ent && C.level) {                        // conferência a cada ~1 s: o que o servidor diz × o que recebi × o que desenhei
      const have = entCounts(C.level);
      if (!sameEnt(m.ent, have) || (C.drawn && !sameEnt(m.ent, C.drawn) && performance.now() - (C.lvAt || 0) > 2500)) { D.mismatch++; requestResync("contagem difere do servidor"); }
    }
    const prev = C.snap;
    if (m.st != null) {                            // relógio do servidor: guarda a melhor estimativa (menor atraso)
      const off = m.st - performance.now() / 1000;
      if (C.off == null || off > C.off) C.off = off; else C.off += (off - C.off) * 0.01;
    }
    if (m.a > C.att) { C.att = m.a; C.shown = [null, null, null]; C.pose = [null, null, null]; C.wonAt = 0; C.pr = null; C.hist = []; C.outbox = []; C.ring = []; C.dispOff = { x: 0, y: 0 }; C.lastCode = 0; hideResult(); }
    C.snap = m; C.snapAt = performance.now();
    D.snapT.push(C.snapAt);
    if (m.st != null) { C.ring.push({ st: m.st, p: m.p }); if (C.ring.length > 24) C.ring.shift(); }
    if (m.ph !== "play") { C.pr = null; C.hist = []; C.outbox = []; C.lastCode = 0; }
    else reconcile(m);
    if (prev && prev.ph !== "won" && m.ph === "won") C.wonAt = performance.now();
    if (m.ph === "count" && Math.ceil(m.c) !== C.lastCount) { C.lastCount = Math.ceil(m.c); if (C.lastCount > 0) sfx("tick"); }
    if (m.ph !== "count") C.lastCount = -1;
    updateChips();
  }
  /* ------------------------------------------------------------------ painel de diagnóstico (opcional; tudo é MEDIDO neste navegador) */
  let diagEl = null, diagAt = 0;
  function toggleDiag(on) {
    D.on = on == null ? !D.on : on;
    if (D.on && !diagEl) { diagEl = document.createElement("pre"); diagEl.id = "co-diag"; diagEl.setAttribute("aria-label", "Diagnóstico de rede"); $("co-cwrap").appendChild(diagEl); }
    if (diagEl) diagEl.classList.toggle("hidden", !D.on);
  }
  function updateDiag(now) {
    if (!D.on || !diagEl || now - diagAt < 250) return; diagAt = now;
    const win = (arr, ms) => { while (arr.length && now - (Array.isArray(arr[0]) ? arr[0][0] : arr[0]) > ms) arr.shift(); };
    win(D.snapT, 5000); win(D.rxB, 5000); win(D.cmdMsg, 5000); win(D.cmdN, 5000); win(D.corr, 10000);
    const fr = D.frames; let fps = "—", worst = "—";
    if (fr.length > 2) { const recent = fr.filter((t) => now - t < 1000); if (recent.length > 2) { fps = ((recent.length - 1) / ((recent[recent.length - 1] - recent[0]) / 1000)).toFixed(0); let w = 0; for (let i = 1; i < recent.length; i++) w = Math.max(w, recent[i] - recent[i - 1]); worst = w.toFixed(0) + " ms"; } }
    const rt = D.rtts.slice().sort((a, b) => a - b), med = rt.length ? rt[Math.floor(rt.length / 2)] + " ms" : "—";
    const per = (arr) => (arr.length / Math.min(5, Math.max(1, (now - (Array.isArray(arr[0]) ? arr[0][0] : arr[0] || now)) / 1000))).toFixed(1);
    const snapsS = D.snapT.length > 1 ? ((D.snapT.length - 1) / ((D.snapT[D.snapT.length - 1] - D.snapT[0]) / 1000)).toFixed(1) : "—";
    const bytes = D.rxB.length > 1 ? (D.rxB.reduce((a, x) => a + x[1], 0) / ((D.rxB[D.rxB.length - 1][0] - D.rxB[0][0]) / 1000) / 1024).toFixed(1) + " KB/s" : "—";
    const cm = D.cmdMsg.length > 1 ? ((D.cmdMsg.length - 1) / ((D.cmdMsg[D.cmdMsg.length - 1] - D.cmdMsg[0]) / 1000)).toFixed(1) : "0";
    const cn = D.cmdN.reduce((a, x) => a + x[1], 0), cs = D.cmdN.length > 1 ? (cn / ((D.cmdN[D.cmdN.length - 1][0] - D.cmdN[0][0]) / 1000)).toFixed(0) : "0";
    const cc = D.corr.length, cmean = cc ? (D.corr.reduce((a, x) => a + x[1], 0) / cc).toFixed(1) : "0", cmax = cc ? Math.max(...D.corr.map((x) => x[1])).toFixed(1) : "0";
    const buf = C.ring.length > 1 && C.off != null ? Math.max(0, C.ring[C.ring.length - 1].st - (now / 1000 + C.off - INTERP)) * 1000 : null;
    const lvl_ = C.level || {}, srv = C.entSrv || {}, rec = entCounts(C.level), drw = C.drawn || {};
    const entLine = ENT_KEYS.map((k) => `${k.slice(0, 4)} ${srv[k] == null ? "?" : srv[k]}/${rec[k]}/${drw[k] == null ? "?" : drw[k]}`).join("  ");
    const ago = (t) => (t ? Math.round(now - t) + " ms" : "—");
    const myfp = fingerprint();
    const others = (C.fpsMsg && C.fpsMsg.l ? C.fpsMsg.l : []).map((f, i) => (f ? `${(C.fpsMsg.n && C.fpsMsg.n[i]) || "J" + (i + 1)}: ${f === myfp ? "igual ao meu" : "DIFERENTE → " + f}` : null)).filter(Boolean);
    if (now - (C.fpSent || 0) > 3000) { C.fpSent = now; send({ t: "fp", f: myfp }); }
    diagEl.textContent = [
      "DIAGNÓSTICO (medido)",
      `FPS: ${fps}   pior quadro: ${worst}`,
      `RTT: ${C.rtt != null ? C.rtt + " ms" : "—"}   mediana(${rt.length}): ${med}`,
      `quadros do servidor/s: ${snapsS}   recebido: ${bytes}`,
      `lotes de comando/s: ${cm}   comandos/s: ${cs}`,
      `correções do boneco local (10 s): ${cc}  média ${cmean} u  máx ${cmax} u  última ${D.lastCorr.toFixed(1)} u`,
      `comandos a caminho: ${C.hist.length}   buffer de interpolação: ${buf == null ? "—" : buf.toFixed(0) + " ms"}`,
      `eventos descartados: ${D.stale} antigos/de outra partida, ${D.dup} repetidos`,
      "— estado da partida —",
      `mapa: ${lvl_.mid || "—"} v${C.mver || "—"} · partida ${C.gid || "—"} · tentativa ${C.att || "—"}`,
      `sala: ${(C.room && C.room.modality) || "—"} · ${lvl_.diff ? DIFF[lvl_.diff] : "—"} · ${(C.room && C.room.limit) || "—"} s · página ${BUILD}${C.srvBuild && C.srvBuild !== BUILD ? " ≠ servidor " + C.srvBuild : ""}`,
      `entidades servidor/recebido/desenhado: ${entLine}`,
      `último quadro há ${ago(D.snapAt)} · último evento há ${ago(D.evAt)} · ressincronizações: ${D.resyncs}${D.lastResync ? " (" + D.lastResync + ")" : ""} · divergências: ${D.mismatch} · erros de desenho: ${D.drawErrs || 0}${D.lastDrawErr ? " (" + D.lastDrawErr + ")" : ""}`,
      "eu: " + myfp,
    ].concat(others).join("\n");
  }
  /* ------------------------------------------------------------------ previsão do boneco local */
  // O servidor continua sendo a autoridade (colisões, placas, portas, morte, vitória, tempo). Aqui só se PREVÊ o movimento do
  // próprio jogador, com a mesma regra do servidor e usando as portas como o servidor as mostrou: a previsão nunca abre porta,
  // nem decide morte ou vitória. Cada comando vale 1/60 s e tem número; o servidor responde com o último número aplicado (ak)
  // e a posição dele; o navegador refaz os comandos ainda não aplicados em cima dessa posição e compara com o que previu.
  function circleRect(cx, cy, r, rc) {
    const nx = Math.min(Math.max(cx, rc[0]), rc[0] + rc[2]), ny = Math.min(Math.max(cy, rc[1]), rc[1] + rc[3]);
    const dx = cx - nx, dy = cy - ny; return dx * dx + dy * dy < r * r;
  }
  function closedRects() {
    const s = C.snap, lv = C.level, out = []; if (!s || !lv) return out;
    lv.gates.forEach((g, i) => { if (s.g[i] !== 1) out.push(g.r); });
    return out;
  }
  function hitsWall(x, y, closed) {
    for (const w of C.level.walls) if (circleRect(x, y, PLAYER_R, w)) return true;
    for (const g of closed) if (circleRect(x, y, PLAYER_R, g)) return true;
    return false;
  }
  function predStep(p, code, closed) {
    const d = DIRS[code]; if (!d || (!d[0] && !d[1])) return;
    let ux = d[0], uy = d[1]; const mm = Math.hypot(ux, uy); if (mm > 1) { ux /= mm; uy /= mm; }
    const dx = ux * SPEED * STEPDT, dy = uy * SPEED * STEPDT, n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / STEP)), sx = dx / n, sy = dy / n;
    let x = p.x, y = p.y;
    for (let i = 0; i < n; i++) {
      if (sx) { const nx = Math.min(Math.max(x + sx, PLAYER_R), W - PLAYER_R); if (!hitsWall(nx, y, closed)) x = nx; }
      if (sy) { const ny = Math.min(Math.max(y + sy, PLAYER_R), H - PLAYER_R); if (!hitsWall(x, ny, closed)) y = ny; }
    }
    p.x = x; p.y = y;
  }
  function dirCode() {
    const d = dir(), dx = d[0], dy = d[1];
    if (!dx && !dy) return 0;
    return dx === 1 ? (dy === 0 ? 1 : dy === 1 ? 2 : 8) : dx === -1 ? (dy === 0 ? 5 : dy === 1 ? 4 : 6) : dy === 1 ? 3 : 7;
  }
  function reconcile(m) {
    if (C.you == null || !m.p[C.you]) return;
    const P = m.p[C.you];
    if (!C.pr) { C.pr = { x: P[0], y: P[1] }; C.hist = []; C.dispOff = { x: 0, y: 0 }; return; }
    const ack = m.ak ? m.ak[C.you] : 0, closed = closedRects();
    while (C.hist.length && C.hist[0][0] <= ack) C.hist.shift();      // comandos que o servidor já aplicou
    const q = { x: P[0], y: P[1] };
    for (const c of C.hist) predStep(q, c[1], closed);                // refaz só os que ainda estão a caminho
    const ex = q.x - C.pr.x, ey = q.y - C.pr.y, e = Math.hypot(ex, ey);
    if (e > 0.5) { D.corr.push([performance.now(), e]); D.lastCorr = e; }
    if (e > 40) C.dispOff = { x: 0, y: 0 };                           // posição inválida/teleporte: corrige na hora
    else { C.dispOff.x -= ex; C.dispOff.y -= ey; }                    // correção pequena: some aos poucos na tela
    C.pr = q;
  }
  function stepInput(now, dt) {
    const s = C.snap;
    if (!s || s.ph !== "play" || C.view !== "game" || !C.level || !C.pr) { C.acc = 0; return; }
    C.acc = Math.min(C.acc + dt, 0.1);
    const code = dirCode(), closed = closedRects();
    while (C.acc >= STEPDT) {
      C.acc -= STEPDT;
      if (code === 0 && C.lastCode === 0) continue;                    // parado: nada a enviar
      const sq = C.seq++;
      predStep(C.pr, code, closed);
      C.hist.push([sq, code]); C.outbox.push([sq, code]); C.lastCode = code;
      if (C.hist.length > 120) C.hist.shift();
    }
    if (C.outbox.length && (now - C.lastFlush >= 30 || C.outbox[0][1] !== C.flushedCode)) {   // lote a cada ~30 ms; mudança de direção sai na hora
      send({ t: "mv", s: C.outbox[0][0], d: C.outbox.map((c) => c[1]) });
      D.cmdMsg.push(now); D.cmdN.push([now, C.outbox.length]);
      C.flushedCode = C.outbox[C.outbox.length - 1][1]; C.lastFlush = now; C.outbox = [];
    }
    const k = Math.exp(-dt / 0.08); C.dispOff.x *= k; C.dispOff.y *= k;
  }
  /** Jogadores remotos: interpolação entre dois quadros do servidor, um pouco no passado (INTERP); extrapolação curta e limitada. */
  /** Drone de patrulha (mesma regra do servidor/campanha): posição só depende do tempo da tentativa. */
  function dronePosJS(d, t) {
    if (!d._c) { const pts = d.route, cum = [0]; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; cum.push(cum[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); } d._c = { pts, cum, per: cum[cum.length - 1] }; }
    const { pts, cum, per } = d._c; let s2 = (((t * (d.speed || 100) + (d.phase || 0) * per) % per) + per) % per, i = 0;
    while (i < pts.length - 1 && s2 >= cum[i + 1]) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length], ln = (cum[i + 1] - cum[i]) || 1, k = (s2 - cum[i]) / ln;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  function remotePos(i, now) {
    const r = C.ring; if (r.length < 2 || C.off == null) return null;
    const rt = now / 1000 + C.off - INTERP;
    let a = null, b = null;
    for (let k = r.length - 1; k >= 1; k--) { if (r[k - 1].st <= rt && rt <= r[k].st) { a = r[k - 1]; b = r[k]; break; } }
    if (a && b) { const f = b.st > a.st ? (rt - a.st) / (b.st - a.st) : 1; return { x: a.p[i][0] + (b.p[i][0] - a.p[i][0]) * f, y: a.p[i][1] + (b.p[i][1] - a.p[i][1]) * f }; }
    const last = r[r.length - 1], prev = r[r.length - 2];
    if (rt > last.st) {                                              // faltou atualização: extrapola no máximo EXTRAP_MAX
      const dtv = Math.min(rt - last.st, EXTRAP_MAX), span = last.st - prev.st || 0.033;
      return { x: last.p[i][0] + (last.p[i][0] - prev.p[i][0]) / span * dtv, y: last.p[i][1] + (last.p[i][1] - prev.p[i][1]) / span * dtv };
    }
    return { x: r[0].p[i][0], y: r[0].p[i][1] };
  }
  function name(i) { const p = C.room && C.room.players[i]; return p ? p.name : "Jogador"; }
  /** Papéis do jogador i (lista). Com menos de 3 jogadores um jogador acumula papéis. */
  function roleIds(i) { const r = C.roles && C.roles[i]; return Array.isArray(r) ? r : r ? [r] : []; }
  function roleOf(i) {
    const infos = roleIds(i).map((id) => C.hi && C.hi.roles[id]).filter(Boolean);
    if (!infos.length) return { name: "?", icon: "●", color: "#aaa" };
    return { name: infos.map((x) => x.name).join(" + "), icon: infos.map((x) => x.icon).join(""), color: infos[0].color };
  }
  const SET_TAG = {};   // (sem rótulos de conjunto: a modalidade já aparece no lobby)
  const MOD = { 2: "Dupla — 2 jogadores", 3: "Trio — 3 jogadores" };
  const LS_CKPT = "dez-segundos-online-checkpoint-v1", LS_REC = "dez-segundos-online-recordes-v1";
  const DIFF = { easy: "Fácil", normal: "Normal", hard: "Difícil" };
  const DIFF_HELP = {
    easy: "Passagens mais largas, menos perigos, drones mais lentos, lasers com janelas seguras maiores e ligações sempre destacadas.",
    normal: "O equilíbrio de referência (25 s é o tempo recomendado, mas o tempo é escolha do anfitrião).",
    hard: "Mais perigos e revezamentos, drones mais rápidos e janelas de laser menores (sempre com aviso).",
  };
  function lvl(i) { return i == null ? null : C.hi && C.hi.levels[i]; }
  function isFixed(l) { return !!(l && l.fixed); }
  /** Mapa que começaria agora: fase pendente da expedição ou o mapa avulso escolhido. */
  function targetOf(r) { return r.mode === "exp" ? (r.exp && r.exp.step < r.exp.total ? r.exp.maps[r.exp.step] : null) : r.level; }
  /** Todos os checkpoints guardados NESTE navegador: chave "modalidade|sequência|dificuldade". Migra o formato antigo (uma chave por modalidade, v1 = Normal). */
  function allCkpts() {
    let all = {}; try { all = JSON.parse(lsGet(LS_CKPT) || "{}"); } catch (e) { all = {}; }
    const out = {};
    Object.keys(all).forEach((k) => { const ck = all[k]; if (!ck || typeof ck !== "object" || !ck.seq) return; const key = k.includes("|") ? k : `${ck.mod}|${ck.seq.id}|${ck.diff || "normal"}`; out[key] = ck; });
    return out;
  }
  /** Checkpoint deste navegador para a modalidade, capítulo e dificuldade atuais (só vale com o mesmo tempo). */
  function localCkpt(size, limit, chap, diff) {
    const sq = C.hi && C.hi.seqs && C.hi.seqs[`${size}-${chap}`];
    if (!sq) return { ck: null, why: "" };
    const ck = allCkpts()[`${size}|${sq.id}|${diff}`];
    if (!ck) return { ck: null, why: "" };
    if (!ck.seq || ck.seq.ver !== sq.ver) return { ck: null, why: "Há um checkpoint de uma versão antiga desta expedição; ele não vale mais." };
    if (ck.limit !== limit) return { ck, why: `Há um checkpoint salvo com ${ck.limit} s por fase (fase ${ck.next + 1} de 6). Para continuar, o tempo da sala precisa ser ${ck.limit} s.`, blocked: true };
    return { ck, why: "" };
  }
  function saveCkpt(m) {
    const all = allCkpts(), key = `${m.mod}|${m.seq || ""}|${m.diff || "normal"}`;
    if (m.done || !m.c) { const old = all[key]; if (old && old.limit === m.limit) delete all[key]; } else all[key] = m.c;
    lsSet(LS_CKPT, JSON.stringify(all));
  }
  /** Recordes e conclusões SEPARADOS por modalidade + dificuldade + tempo por tentativa (nunca se comparam configurações diferentes). */
  function recKey(room) { return `${room.size}|${room.difficulty || "normal"}|${room.limit}`; }
  function loadRecs() { try { return JSON.parse(lsGet(LS_REC) || "{}"); } catch (e) { return {}; } }
  function noteWin(mid, time) {
    const r = C.room; if (!r || !mid) return;
    const all = loadRecs(), k = recKey(r), cfg = all[k] || (all[k] = { best: {}, done: {} });
    const prev = cfg.best[mid]; cfg.done[mid] = (cfg.done[mid] || 0) + 1;
    const isNew = prev == null || time < prev; if (isNew) cfg.best[mid] = time;
    lsSet(LS_REC, JSON.stringify(all));
    C.lastRec = { mid, time, prev, isNew, key: k };
  }
  /** Um erro ao desenhar UM tipo de elemento não pode esconder os demais: registra, mostra no diagnóstico e avisa o servidor (1 vez por tipo). */
  function drawFail(what, e) {
    D.drawErrs = (D.drawErrs || 0) + 1; D.lastDrawErr = what + ": " + String(e && e.message || e).slice(0, 60);
    try { ctx.restore(); ctx.restore(); } catch (x) {}
    C.reported = C.reported || {}; if (!C.reported[what]) { C.reported[what] = 1; send({ t: "cerr", m: "desenho de " + what + ": " + String(e && e.message || e).slice(0, 100), ua: navigator.userAgent.slice(0, 80) }); }
  }
  function entCounts(lv) { const o = {}; ENT_KEYS.forEach((k) => { o[k] = (lv && lv[k] ? lv[k].length : 0); }); return o; }
  const sameEnt = (a, b) => !!a && !!b && ENT_KEYS.every((k) => a[k] === b[k]);
  function requestResync(why) { const now = performance.now(); if (now - (C.resyncAt || 0) < 3000) return; C.resyncAt = now; D.resyncs++; D.lastResync = why; send({ t: "resync" }); }
  /** Impressão digital do que ESTE navegador tem e desenhou: dá para comparar entre jogadores no painel de diagnóstico. */
  function fingerprint() {
    const c = C.drawn || {}, l = C.level || {};
    return `${l.mid || "-"}@${C.mver || "-"}|g${C.gid || 0}|a${C.att || 0}|${(C.room && C.room.size) || "?"}j|${l.diff || "-"}|` + ENT_KEYS.map((k) => `${k.slice(0, 2)}${c[k] == null ? "?" : c[k]}`).join("");
  }
  function nP() { return C.roles && C.roles.length ? C.roles.length : 3; }
  function onEvent(e) {
    const k = e[0];
    if (k === "key") { sfx("key"); banner(`🗝 ${name(e[1])} pegou a chave! Agora todos podem usar a porta.`, "good", 3500); }
    else if (k === "gate") { sfx("switch"); }
    else if (k === "plate") { if (e[2]) sfx("blip"); }
    else if (k === "rs") { sfx("blip"); banner(`🔄 ${name(e[1])} reiniciou a tentativa para todos.`, "info", 3000); }
    else if (k === "esc") { if (e[2]) sfx("portal"); }
    else if (k === "tp") { sfx("portal"); }
    else if (k === "win") { try { noteWin(C.level && C.level.mid, e[1] && e[1].time); } catch (x) {} sfx("win"); if (!C.expInfo && C.lastRec) banner(`Tempo ${C.lastRec.time.toFixed(1)} s` + (C.lastRec.isNew ? (C.lastRec.prev == null ? " — primeira vez nesta configuração!" : " — novo recorde!") : ` (melhor: ${C.lastRec.prev.toFixed(1)} s)`) + ` · ${MOD[C.room.size]} · ${DIFF[C.room.difficulty]} · ${C.room.limit} s`, "good", 4500); }
    else if (k === "go") { sfx("blip"); C.goFlash = performance.now(); }
    else if (k === "lose") {
      sfx("lose");
      const who = e[1];
      C.loseText = who >= 0 && WHY[e[2]] ? `${WHY[e[2]]} ${roleOf(who).icon} ${name(who)}` : "⏱ Tempo esgotado";
      C.loseUntil = performance.now() + 2200;
      banner("Tentativa encerrada para todos. " + C.loseText + ". Reiniciando…", "bad", 2300);
    }
  }

  /* ------------------------------------------------------------------ sala (lobby) */
  function isHost() { return C.room && C.room.host === C.you; }
  function renderLobby() {
    const r = C.room;
    if (!r || C.view === "connect") return;
    $("co-code-big").textContent = r.code;
    const size = r.size || 3, mineRoles = (r.players[C.you] && r.players[C.you].roles) || [];
    const sizeEl = $("co-size"); sizeEl.textContent = "";
    const three = !!(r.players[2]);                                   // 3 participantes (inclusive quem caiu): não dá para virar Dupla
    [2, 3].forEach((n) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(n === size));
      b.textContent = MOD[n];
      b.disabled = !isHost() || r.phase !== "lobby" || (n === 2 && three);
      b.addEventListener("click", () => send({ t: "size", n }));
      sizeEl.appendChild(b);
    });
    $("co-size-note").textContent = !isHost() ? "Só o anfitrião escolhe a modalidade." : (three && size === 3 ? "Para virar Dupla, um dos 3 participantes precisa sair antes (a sala nunca expulsa ninguém sozinha)." : "A modalidade define a capacidade da sala e os mapas disponíveis.");
    const dEl = $("co-diff"); dEl.textContent = "";
    ["easy", "normal", "hard"].forEach((d) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(d === r.difficulty));
      b.textContent = DIFF[d]; b.disabled = !isHost() || r.phase !== "lobby"; b.addEventListener("click", () => send({ t: "diff", v: d })); dEl.appendChild(b);
    });
    $("co-diff-note").textContent = `${DIFF_HELP[r.difficulty]} Tempo e dificuldade são escolhas independentes.` + (r.difficulty !== "normal" ? " Os mapas clássicos só existem em Normal." : "");
    const present = r.players.slice(0, size).filter(Boolean).length;
    $("co-vagas").textContent = `${MOD[size]} · participantes: ${present} de ${size}` + (present < size ? ` · ${size - present} vaga${size - present > 1 ? "s" : ""} livre${size - present > 1 ? "s" : ""}` : " · sala completa");
    const list = $("co-slots"); list.textContent = "";
    r.players.slice(0, size).forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "co-slot" + (p ? "" : " empty") + (p && !p.on ? " off" : "") + (p && p.ready ? " ready" : "");
      if (!p) { li.textContent = "Aguardando jogador…"; }
      else {
        const infos = (isFixed(lvl(targetOf(r))) ? [C.hi.roles[Object.keys(C.hi.roles)[i]]] : (p.roles || []).map((id) => C.hi && C.hi.roles[id])).filter(Boolean);
        const b = document.createElement("b"); b.textContent = p.name + (i === C.you ? " (você)" : "");
        const s = document.createElement("span");
        s.textContent = [i === r.host ? "👑 anfitrião" : "", infos.length ? infos.map((x) => `${x.icon} ${x.name}`).join(" + ") : "sem papel", p.on ? (p.ready ? "✔ pronto" : "aguardando ficar pronto") : "⚠ desconectado"].filter(Boolean).join(" · ");
        li.append(b, s);
      }
      list.appendChild(li);
    });
    const rolesEl = $("co-roles"); rolesEl.textContent = "";
    const lvNow = lvl(targetOf(r)), fixedNow = isFixed(lvNow);
    const rid = C.hi ? Object.keys(C.hi.roles) : [];
    $("co-roles-note").textContent = fixedNow
      ? "Neste mapa os poderes são fixos, por ordem de entrada: " + r.players.slice(0, size).map((p, i) => `${p ? p.name : "jogador " + (i + 1)} ${C.hi.roles[rid[i]].icon} ${C.hi.roles[rid[i]].name}`).join(" · ") + "."
      : "Cada jogador escolhe 1 poder (toque de novo para soltar).";
    for (const id of (fixedNow ? [] : Object.keys(C.hi ? C.hi.roles : {}))) {
      const info = C.hi.roles[id], have = mineRoles.includes(id);
      const takenBy = r.players.findIndex((p, i) => p && i !== C.you && (p.roles || []).includes(id));
      const b = document.createElement("button");
      b.type = "button"; b.className = "co-role"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(have));
      b.disabled = takenBy >= 0 || r.phase !== "lobby";
      b.style.setProperty("--rc", info.color);
      b.innerHTML = `<b></b><span></span><small></small>`;
      b.children[0].textContent = `${info.icon} ${info.name}`;
      b.children[1].textContent = info.desc;
      b.children[2].textContent = takenBy >= 0 ? `Escolhido por ${r.players[takenBy].name}` : have ? "Seu poder (toque para soltar)" : mineRoles.length ? "Toque para trocar" : "Toque para escolher";
      b.addEventListener("click", () => send({ t: "role", role: id }));
      rolesEl.appendChild(b);
    }
    // ---- o que jogar: Expedição ou mapa avulso (a lista vem do servidor e SÓ tem mapas da modalidade escolhida)
    const modeEl = $("co-mode"); modeEl.textContent = "";
    [["exp", "Expedição (6 fases)"], ["free", "Mapa avulso"]].forEach(([k, label]) => {
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(r.mode === k));
      b.textContent = label; b.disabled = !isHost() || r.phase !== "lobby"; b.addEventListener("click", () => send({ t: "mode", v: k })); modeEl.appendChild(b);
    });
    const sel = $("co-level"), freeEl = $("co-free"), expEl = $("co-exp");
    freeEl.classList.toggle("hidden", r.mode === "exp"); expEl.classList.toggle("hidden", r.mode !== "exp");
    sel.textContent = "";
    if (C.hi) {
      const ph = document.createElement("option"); ph.value = ""; ph.textContent = r.maps.length ? "— escolha um mapa —" : "(nenhum mapa para esta modalidade)"; sel.appendChild(ph);
      [["classic", "Clássicos"], ["new", "Novos I"], ["new2", "Novos II (com dificuldades)"]].forEach(([g, label]) => {
        const items = r.maps.filter((i) => (lvl(i).group || "classic") === g); if (!items.length) return;
        const grp = document.createElement("optgroup"); grp.label = label;
        items.forEach((i) => { const l = lvl(i), o = document.createElement("option"); o.value = i; o.textContent = `${l.id}. ${l.name} · ${DIFF[l.diff || "normal"]} · ${l.players} jogadores`; grp.appendChild(o); });
        sel.appendChild(grp);
      });
    }
    sel.value = r.level == null ? "" : String(r.level); sel.disabled = !isHost() || !r.maps.length;
    const curL = lvl(r.mode === "free" ? r.level : null);
    $("co-level-note").textContent = !r.maps.length ? `Não há mapas compatíveis com ${MOD[size]}.` : (r.mode === "free" ? (curL ? `Este mapa é para exatamente ${size} jogadores (${MOD[size]}). ` : "Escolha um mapa da lista. ") : "") + (isHost() ? "" : "Só o anfitrião escolhe o que jogar.");
    if (r.mode === "exp" && r.exp) renderExp(r, expEl);
    renderLimit(r);
    const seated = r.players.slice(0, size);
    const meP = r.players[C.you], myReady = !!(meP && meP.ready);
    const rb = $("co-ready"); rb.textContent = myReady ? "↩ Cancelar pronto" : "✔ Estou pronto"; rb.setAttribute("aria-pressed", String(myReady)); rb.disabled = r.phase !== "lobby";
    let why = "";
    const missing = seated.filter((p) => !p).length;
    if (missing) why = `${MOD[size]}: faltam ${missing} jogador${missing > 1 ? "es" : ""} (a partida exige exatamente ${size}). Mande o código ${r.code}.`;
    else if (seated.some((p) => !p.on)) why = "Um jogador está desconectado.";
    else if (seated.some((p) => p.stale)) why = `A página de ${seated.filter((p) => p.stale).map((p) => p.name).join(", ")} está desatualizada: recarregar com ⌘⇧R antes de começar.`;
    else if (targetOf(r) == null) why = r.mode === "exp" ? "Essa expedição já terminou: recomece do início." : "Escolha um mapa ou a Expedição.";
    else if (!isFixed(lvl(targetOf(r))) && seated.some((p) => (p.roles || []).length !== 1)) why = "Cada jogador precisa escolher 1 poder (🔥 💧 🌿).";
    else if (seated.some((p) => !p.ready)) why = `Aguardando ficar pronto: ${seated.filter((p) => !p.ready).map((p) => p.name).join(", ")}.`;
    const start = $("co-start");
    start.classList.toggle("hidden", !isHost());
    start.disabled = !!why;
    { const tgt = lvl(targetOf(r)); $("co-summary").textContent = `Configuração: ${MOD[size]} · ${DIFF[r.difficulty]} · ${r.limit} s por tentativa · ` + (r.mode === "exp" && r.exp ? `${r.exp.title}${r.exp.available ? "" : " (indisponível nesta dificuldade)"}` : (tgt ? `mapa "${tgt.name}"` : "nenhum mapa escolhido")); }
    start.textContent = r.mode === "exp" && r.exp ? `Começar expedição (fase ${Math.min(r.exp.step + 1, 6)} de 6) ▶` : "Começar ▶";
    $("co-start-note").textContent = isHost() ? (why || "Tudo pronto!") : "Aguardando o anfitrião começar.";
  }

  /** Painel da EXPEDIÇÃO no lobby: as 6 fases (só da modalidade), progresso e como continuar. O checkpoint fica no navegador do anfitrião. */
  function renderExp(r, el) {
    const e = r.exp, host = isHost(); el.textContent = "";
    const h = document.createElement("h2"); h.textContent = `Expedição — ${MOD[r.size]} · ${DIFF[r.difficulty]}`; el.appendChild(h);
    const chRow = document.createElement("div"); chRow.className = "row";
    [1, 2].forEach((c) => { const sq = C.hi && C.hi.seqs && C.hi.seqs[`${r.size}-${c}`]; if (!sq) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "btn " + (r.chapter === c ? "" : "btn-ghost"); b.setAttribute("aria-pressed", String(r.chapter === c));
      b.textContent = sq.title + (sq.maps[r.difficulty] ? "" : " (só Normal)"); b.disabled = !host || r.phase !== "lobby"; b.addEventListener("click", () => send({ t: "chapter", v: c })); chRow.appendChild(b); });
    el.appendChild(chRow);
    if (!e.available) { const na = document.createElement("p"); na.className = "small"; na.textContent = `${e.title} não existe na dificuldade ${DIFF[r.difficulty]}: escolha o Capítulo 2 ou a dificuldade Normal.`; el.appendChild(na); return; }
    const ol = document.createElement("ol");
    e.maps.forEach((mi, i) => { const li = document.createElement("li"); li.className = i < e.step ? "done" : i === e.step ? "cur" : ""; const l = lvl(mi);
      const per = e.stats.per[i]; li.textContent = `${i < e.step ? "✔ " : i === e.step ? "▶ " : ""}${l ? l.name : "?"}` + (per ? ` — ${per.time.toFixed(1)} s, ${per.defeats} derrota${per.defeats === 1 ? "" : "s"}` : ""); ol.appendChild(li); });
    el.appendChild(ol);
    const p1 = document.createElement("p"); p1.className = "small";
    p1.textContent = e.step >= e.total ? "Expedição concluída." : `Fase ${e.step + 1} de ${e.total}${e.progress ? ` · ${e.stats.defeats} derrota${e.stats.defeats === 1 ? "" : "s"} · tempo ativo ${e.stats.active.toFixed(1)} s` : ""}. Tempo por fase: ${r.limit} s (mesmo para todas).` + (e.restored ? " Retomada de um checkpoint." : "");
    el.appendChild(p1);
    const row = document.createElement("div"); row.className = "row";
    const mem = e.progress && e.step < e.total;
    if (mem) { const note = document.createElement("p"); note.className = "small"; note.textContent = "Progresso guardado nesta sala (dura enquanto a sala existir). A fase pendente recomeça do início; ninguém precisa ter jogado as anteriores: o progresso é da expedição, não de cada pessoa."; el.appendChild(note); }
    const lc = localCkpt(r.size, r.limit, r.chapter, r.difficulty);
    if (host && lc.ck && !lc.blocked && !(mem && e.step === lc.ck.next)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; b.disabled = r.phase !== "lobby";
      b.textContent = `▶ Continuar do checkpoint (fase ${lc.ck.next + 1} de 6 · ${lc.ck.stats.defeats} derrota${lc.ck.stats.defeats === 1 ? "" : "s"} · ${lc.ck.stats.active.toFixed(1)} s)`;
      b.addEventListener("click", () => send({ t: "exp", a: "continue", ck: lc.ck })); row.appendChild(b);
    }
    if (host && (mem || e.step >= e.total)) {
      const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; b.disabled = r.phase !== "lobby"; b.textContent = "↺ Recomeçar do início";
      b.addEventListener("click", () => { if (!e.progress || confirm("Recomeçar a expedição do início? O progresso desta sala será descartado.")) send({ t: "exp", a: "restart" }); }); row.appendChild(b);
    }
    el.appendChild(row);
    const w = document.createElement("p"); w.className = "small";
    w.textContent = lc.why || (host ? "O checkpoint é salvo só neste navegador (o do anfitrião), a cada fase concluída. Se outra pessoa for anfitriã ou você trocar de navegador, ele não acompanha." : "Só o anfitrião guarda o checkpoint, no navegador dele.");
    el.appendChild(w);
  }

  /** Tela de resultado entre as fases da expedição e no final. Cada jogador confirma "Pronto para continuar". */
  function renderResult() {
    const m = C.resultMsg, box = $("co-result");
    if (!m) { box.classList.add("hidden"); return; }
    box.textContent = "";
    const p = document.createElement("div"); p.className = "panel good";
    const h = document.createElement("h1"); h.textContent = m.final ? "Expedição concluída! 🏆" : `Fase ${m.step} de ${m.total} concluída! 🎉`; p.appendChild(h);
    const st = document.createElement("div"); st.className = "co-stats";
    const lines = m.final
      ? [`Configuração: ${m.modality} · ${m.diff_name || "Normal"} · ${m.limit} s por tentativa · ${m.title || ""}`, `Fases concluídas: ${m.stats.done} de ${m.total}`, `Tempo ativo total: ${m.stats.active.toFixed(1)} s`, `Derrotas totais: ${m.stats.defeats}`, "Resultados e recordes valem só para esta configuração."].concat(m.stats.per.map((x, i) => `${i + 1}. ${(lvl(C.room && C.room.exp ? C.room.exp.maps[i] : null) || {}).name || x.mid}: ${x.time.toFixed(1)} s, ${x.defeats} derrota${x.defeats === 1 ? "" : "s"}`))
      : [`Configuração: ${m.modality} · ${m.diff_name || "Normal"} · ${m.limit} s por tentativa · ${m.title || ""}`, `Tempo desta fase: ${m.time.toFixed(1)} s de ${m.limit} s${C.lastRec && C.lastRec.mid === (m.stats.per[m.stats.per.length - 1] || {}).mid ? (C.lastRec.isNew ? (C.lastRec.prev == null ? " · primeira vez nesta configuração" : " · NOVO RECORDE nesta configuração") : ` · melhor nesta configuração: ${C.lastRec.prev.toFixed(1)} s`) : ""}`, `Derrotas nesta fase: ${m.defeats}`, `Progresso da expedição: ${m.step} de ${m.total}`, `Total até aqui: ${m.stats.active.toFixed(1)} s ativos · ${m.stats.defeats} derrota${m.stats.defeats === 1 ? "" : "s"}`, `Próxima: ${m.next}`];
    st.textContent = lines.join("\n"); st.style.whiteSpace = "pre-line"; p.appendChild(st);
    const acts = document.createElement("div"); acts.className = "ov-actions";
    if (!m.final) {
      const conf = (C.room && C.room.transit && C.room.transit.rid === m.rid) ? C.room.transit.c : [];
      const mine = conf.includes(C.you) || C.contSent === m.rid;
      const who = document.createElement("div"); who.className = "co-who";
      who.textContent = "Confirmaram: " + (C.room ? C.room.players.slice(0, C.room.size).map((q, i) => `${q ? q.name : "—"}${conf.includes(i) ? " ✔" : " …"}`).join(" · ") : ""); p.appendChild(who);
      const b = btn(mine ? "Aguardando os outros…" : "Pronto para continuar ▶", "btn", () => { if (C.contSent === m.rid) return; C.contSent = m.rid; send({ t: "cont", rid: m.rid }); renderResult(); });
      b.disabled = mine; acts.appendChild(b);
    } else if (isHost()) {
      acts.append(btn("Repetir expedição", "btn", () => send({ t: "exp", a: "repeat" })), btn("Voltar ao lobby", "btn btn-ghost", () => send({ t: "lobby" })));
    } else { const w = document.createElement("p"); w.textContent = "Aguardando o anfitrião: repetir a expedição ou voltar ao lobby."; acts.appendChild(w); }
    p.appendChild(acts); box.appendChild(p); box.classList.remove("hidden");
    const f = box.querySelector("button:not(:disabled)"); if (f) f.focus({ preventScroll: true });
  }

  /** Tempo por fase: todos veem; só o anfitrião muda (e só no lobby). Mudar o tempo desfaz o "pronto" de todos. */
  function renderLimit(r) {
    const host = isHost(), lim = r.limit || 25, box = $("co-limit"); box.textContent = "";
    PRESETS.forEach((v) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === lim)); b.textContent = v + " s";
      b.disabled = !host || r.phase !== "lobby"; b.addEventListener("click", () => send({ t: "limit", v })); box.appendChild(b);
    });
    const num = $("co-limit-num"), setb = $("co-limit-set");
    num.disabled = setb.disabled = !host || r.phase !== "lobby";
    if (document.activeElement !== num) num.value = PRESETS.includes(lim) ? "" : lim;
    num.placeholder = String(lim);
    const lv = lvl(targetOf(r)), par = lv && lv.par ? lv.par : 0;
    const hard = C.hi ? r.maps.map(lvl).filter((l) => l && l.par && lim < l.par).map((l) => l.id) : [];
    let note = `Tempo da tentativa: ${lim} s para todos${host ? "" : " (só o anfitrião muda)"}. A velocidade de inimigos e mecanismos não muda com o tempo.`;
    if (par && lim < par) note += ` ⚠ Com ${lim} s esta fase é impossível: nem o caminho perfeito cabe (cerca de ${par} s).`;
    else if (par && lim < par * 3) note += ` ⚠ Tempo apertado para esta fase: o caminho perfeito leva cerca de ${par} s.`;
    else note += " Tempos muito curtos podem tornar algumas fases impossíveis.";
    if (hard.length) note += ` Impossíveis com ${lim} s: fase${hard.length > 1 ? "s" : ""} ${hard.join(", ")}.`;
    $("co-limit-note").textContent = note;
  }
  $("co-limit-set").addEventListener("click", () => {
    const raw = $("co-limit-num").value.trim(), v = Number(raw);
    if (!/^\d+$/.test(raw) || v < 5 || v > 300) { $("co-limit-note").textContent = "Digite um número inteiro entre 5 e 300 segundos."; return; }
    send({ t: "limit", v });
  });
  $("co-limit-num").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("co-limit-set").click(); } });
  $("co-ready").addEventListener("click", () => { const me = C.room && C.room.players[C.you]; send({ t: "ready", v: !(me && me.ready) }); });

  /* ------------------------------------------------------------------ HUD */
  function buildChips() {
    const box = $("co-chips"); box.textContent = "";
    for (let i = 0; i < nP(); i++) {
      const d = document.createElement("div"); d.className = "co-chip"; d.id = "co-chip" + i;
      d.style.setProperty("--rc", roleOf(i).color);
      box.appendChild(d);
    }
    $("co-lvname").textContent = C.level ? ((C.expInfo ? `${(C.expInfo.title || "Expedição").replace("Capítulo", "Cap.")} · Fase ${C.expInfo.step} de ${C.expInfo.total} · ${C.level.name}` : `Fase ${C.level.id}: ${C.level.name}`) + ` · ${DIFF[C.level.diff || "normal"]}`) : "";
    $("co-hint").textContent = C.level ? C.level.hint : "";
    updateChips();
  }
  function updateChips() {
    if (!C.level) return;
    const s = C.snap;
    for (let i = 0; i < nP(); i++) {
      const d = $("co-chip" + i); if (!d) continue;
      const esc = s && s.p[i][2] === 1, r = roleOf(i), p = C.room && C.room.players[i];
      d.textContent = `${r.icon} ${name(i)}${i === C.you ? " (você)" : ""}${esc ? " ✔" : ""}${p && !p.on ? " ⚠" : ""}`;
      d.classList.toggle("done", !!esc); d.classList.toggle("me", i === C.you);
    }
    $("co-att").textContent = s ? `Tentativa ${s.a}` : "";
    $("co-key").textContent = s && s.k ? "🗝 chave pega" : "🗝 chave: falta pegar";
    $("co-key").classList.toggle("on", !!(s && s.k));
    $("co-restart").classList.toggle("hidden", !isHost());
  }
  function updatePaused() {
    const r = C.room; if (!r || C.view !== "game") return;
    const off = r.players.slice(0, r.size || 3).findIndex((p) => p && !p.on);
    if (off >= 0) banner(`⚠ ${r.players[off].name} caiu. Pausado — esperando voltar (até 30 s).`, "bad");
    else if (C.pausedBy >= 0) banner("Todos voltaram!", "good", 2000);
    C.pausedBy = off;
  }
  function hideResult() { C.resultMsg = null; $("co-result").classList.add("hidden"); }
  function btn(label, cls, fn) { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.addEventListener("click", fn); return b; }

  /* ------------------------------------------------------------------ entrada */
  const keys = new Set(), padDirs = new Set();
  const KEYMAP = { ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d" };
  function dir() {
    const has = (k) => keys.has(k) || padDirs.has(k);
    return [(has("r") ? 1 : 0) - (has("l") ? 1 : 0), (has("d") ? 1 : 0) - (has("u") ? 1 : 0)];
  }
  function releaseDir() { keys.clear(); padDirs.clear(); document.querySelectorAll("#co-pad .dir.active").forEach((b) => b.classList.remove("active")); pushDir(true); }
  function pushDir() { /* os comandos de movimento saem do laço de quadros (stepInput): numerados, em lote, 1 por 1/60 s */ }
  const typing = (t) => t && t.closest && t.closest("input, textarea, select");
  window.addEventListener("keydown", (e) => {
    if (panel.classList.contains("hidden") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (C.view !== "game") { if (e.code === "Escape" && !typing(e.target)) { e.stopPropagation(); leaveAsk(); } return; }
    if (typing(e.target)) return;
    if (e.code === "F3") { e.preventDefault(); toggleDiag(); return; }
    if (e.code === "Escape") { e.stopPropagation(); togglePop(); return; }
    if (!$("co-pop").classList.contains("hidden")) return;
    if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); pushDir(false); return; }
    if (/^Digit[1-6]$/.test(e.code)) { send({ t: "emo", k: +e.code.slice(5) - 1 }); return; }
    if (e.code === "KeyR" && isHost() && !e.repeat) { send({ t: "restart", a: C.snap ? C.snap.a : undefined }); }
  }, true);
  window.addEventListener("keyup", (e) => { if (KEYMAP[e.code]) { keys.delete(KEYMAP[e.code]); pushDir(false); } }, true);
  window.addEventListener("blur", releaseDir);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseDir(); });
  document.querySelectorAll("#co-pad .dir").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} padDirs.add(k); b.classList.add("active"); pushDir(false); });
    const up = () => { padDirs.delete(k); b.classList.remove("active"); pushDir(false); };
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("lostpointercapture", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  /** Marcações sem texto livre: escolha uma e toque no mapa (toque de novo no botão para marcar onde você está). */
  function placeMark(k, x, y) {
    const now = performance.now();
    if (now - C.lastMark < 1200) { banner("Calma: uma marcação por vez.", "info", 1200); return; }   // o servidor também limita
    C.lastMark = now; send({ t: "mark", k, x: Math.round(x), y: Math.round(y) });
  }
  function setArmed(k) {
    C.armed = k; clearTimeout(C.armT);
    document.querySelectorAll("#co-marks button").forEach((b, i) => b.classList.toggle("armed", i === k));
    if (k >= 0) { C.armT = setTimeout(() => setArmed(-1), 7000); banner(`${MARKS[k][1]} — toque no mapa (ou toque de novo no botão para marcar onde você está).`, "info", 3500); }
  }
  MARKS.forEach((mk, k) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = mk[0] + " " + mk[1];
    b.addEventListener("click", () => {
      if (C.armed === k) { const sh = C.shown[C.you]; if (sh) placeMark(k, sh.x, sh.y); setArmed(-1); } else setArmed(k);
    });
    $("co-marks").appendChild(b);
  });
  $("co-canvas").addEventListener("pointerdown", (e) => {
    if (C.view === "game" && C.armed < 0 && C.level) {            // toque/clique num mecanismo mostra a ligação dele por alguns segundos
      const r0 = $("co-canvas").getBoundingClientRect(); if (r0.width) {
        const x = (e.clientX - r0.left) / r0.width * W, y = (e.clientY - r0.top) / r0.height * H, lv = C.level;
        let best = null, bd = 34;
        lv.plates.forEach((p, pi) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = lv.gates.findIndex((g) => g.plates.includes(pi)); } });
        lv.gates.forEach((g, gi) => { const d = Math.hypot(g.r[0] + g.r[2] / 2 - x, g.r[1] + g.r[3] / 2 - y); if (d < bd + 8 || (x >= g.r[0] - 10 && x <= g.r[0] + g.r[2] + 10 && y >= g.r[1] - 10 && y <= g.r[1] + g.r[3] + 10)) { bd = Math.min(bd, d); best = gi; } });
        if (best != null && best >= 0) C.sel = { gi: best, until: performance.now() + 4000 };
      }
      return;
    }
    if (C.armed < 0 || C.view !== "game") return;
    const r = $("co-canvas").getBoundingClientRect(); if (!r.width) return;
    e.preventDefault();
    placeMark(C.armed, Math.max(0, Math.min(W, (e.clientX - r.left) / r.width * W)), Math.max(0, Math.min(H, (e.clientY - r.top) / r.height * H)));
    setArmed(-1);
  });
  EMOS.forEach((em, i) => {
    const b = document.createElement("button"); b.type = "button"; b.className = "co-emo"; b.textContent = em[0]; b.title = em[1]; b.setAttribute("aria-label", `${em[1]} (tecla ${i + 1})`);
    b.addEventListener("click", () => send({ t: "emo", k: i }));
    $("co-emos").appendChild(b);
  });

  /* ------------------------------------------------------------------ menu / sair */
  function togglePop() {
    const p = $("co-pop");
    p.classList.toggle("hidden");
    $("co-pop-lobby").classList.toggle("hidden", !isHost());
    if (!p.classList.contains("hidden")) { releaseDir(); $("co-pop-continue").focus(); }
  }
  function leaveAsk() {
    if (C.view === "connect" || !C.code) { close(true); return; }
    if (C.view === "game") { togglePop(); return; }
    close(true);
  }

  /* ------------------------------------------------------------------ desenho */
  const cv = $("co-canvas"), ctx = cv.getContext("2d");
  let scale = 1, dpr = 1;
  function resizeCanvas() {
    const wrap = $("co-cwrap"); if (!wrap) return;
    const bw = wrap.clientWidth, bh = wrap.clientHeight;
    if (bw < 20 || bh < 20) return;
    const s = Math.min(bw / W, bh / H);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    scale = s;
    cv.style.width = Math.floor(W * s) + "px"; cv.style.height = Math.floor(H * s) + "px";
    cv.width = Math.floor(W * s * dpr); cv.height = Math.floor(H * s * dpr);
  }
  if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe($("co-cwrap")); else window.addEventListener("resize", resizeCanvas);
  window.addEventListener("orientationchange", () => setTimeout(resizeCanvas, 200));

  function laserState(l, t) { const c = l.on + l.off, p = (((t + (l.offset || 0)) % c) + c) % c; return p >= l.off ? 2 : p >= l.off - 0.5 ? 1 : 0; }
  function sawPos(m, t) {
    const dx = m.x2 - m.x1, dy = m.y2 - m.y1, ln = Math.hypot(dx, dy);
    if (!ln || !m.speed) return [m.x1, m.y1];
    const per = (2 * ln) / m.speed, p = (((t / per + (m.phase || 0)) % 1) + 1) % 1, d = p < 0.5 ? p * 2 : 2 - p * 2;
    return [m.x1 + dx * d, m.y1 + dy * d];
  }
  function startLoop() { if (!C.raf) { C.lastFrame = performance.now(); C.raf = requestAnimationFrame(frame); } }
  function stopLoop() { if (C.raf) cancelAnimationFrame(C.raf); C.raf = 0; }
  function frame(now) {
    C.raf = 0;
    if (C.view !== "game") return;
    const dt = Math.min(0.1, (now - C.lastFrame) / 1000); C.lastFrame = now;
    D.frames.push(now); if (D.frames.length > 130) D.frames.shift();
    try { updateDiag(now); } catch (e) {}
    try { stepInput(now, dt); } catch (e) { console.error("coop input", e); }
    try { draw(now, dt); } catch (e) { // um erro de desenho nunca pode parar o laço (a tela ficaria congelada)
      if (!C.drawErr) { C.drawErr = true; console.error("coop draw", e); send({ t: "cerr", m: String(e && e.message || e).slice(0, 120), ua: navigator.userAgent.slice(0, 80) }); }
      try { ctx.restore(); ctx.restore(); ctx.restore(); } catch (x) {}
    }
    C.raf = requestAnimationFrame(frame);
  }
  /** Tempo decorrido: calculado pelo PRAZO do servidor (en) e pelo relógio dele (st), não por um contador do navegador. */
  function serverNow(now) { return now / 1000 + (C.off || 0); }
  function limitOf() { const s = C.snap; return (s && s.lim) || (C.level && C.level.time) || 25; }
  function localElapsed(now) {
    const s = C.snap; if (!s) return 0;
    if (s.ph === "play" && s.en != null && C.off != null) return Math.max(0, Math.min(limitOf(), limitOf() - (s.en - serverNow(now))));
    return s.e;
  }
  function glow(c, b) { if (!RM()) { ctx.shadowColor = c; ctx.shadowBlur = b; } }
  function noGlow() { ctx.shadowBlur = 0; }

  function draw(now, dt) {
    const lv = C.level, s = C.snap;
    const dc = { walls: 0, plates: 0, gates: 0, spikes: 0, lasers: 0, saws: 0, drones: 0, portals: 0 };   // o que ESTE navegador realmente desenhou neste quadro
    if (!lv || !cv.width) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.fillStyle = "#0b0a1c"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(90,84,170,.12)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const t = localElapsed(now);
    // ligações placa -> porta: discretas por padrão; ficam fortes quando você chega perto do mecanismo ou toca nele
    const me = C.shown[C.you], selOn = C.sel && now < C.sel.until;
    lv.gates.forEach((g, gi) => {
      const gx = g.r[0] + g.r[2] / 2, gy = g.r[1] + g.r[3] / 2;
      let strong = !!(selOn && C.sel.gi === gi) || !!lv.guide;
      if (!strong && me) strong = Math.hypot(me.x - gx, me.y - gy) < 90 || g.plates.some((pi) => Math.hypot(me.x - lv.plates[pi].x, me.y - lv.plates[pi].y) < 70);
      ctx.strokeStyle = GATE_COL[gi % GATE_COL.length]; ctx.globalAlpha = strong ? 0.95 : 0.1; ctx.lineWidth = strong ? 3 : 2; ctx.setLineDash(strong ? [10, 6] : [4, 6]);
      if (strong && !RM()) ctx.lineDashOffset = -(now / 40) % 16;
      g.plates.forEach((pi) => { const p = lv.plates[pi]; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(gx, gy); ctx.stroke(); });
      ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 1;
      if (strong) {   // anéis nos extremos da ligação
        ctx.lineWidth = 2; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(gx, gy, 16 + (RM() ? 0 : 3 * Math.sin(now / 160)), 0, 7); ctx.stroke();
        g.plates.forEach((pi) => { const p = lv.plates[pi]; ctx.beginPath(); ctx.arc(p.x, p.y, 26, 0, 7); ctx.stroke(); });
        ctx.globalAlpha = 1;
      }
    });
    // paredes
    ctx.fillStyle = "#26225e"; ctx.strokeStyle = "#5a54c0"; ctx.lineWidth = 2;
    for (const w of lv.walls) { dc.walls++; ctx.fillRect(w[0], w[1], w[2], w[3]); ctx.strokeRect(w[0] + 1, w[1] + 1, w[2] - 2, w[3] - 2); }
    // espinhos
    for (const sp of lv.spikes) {
      dc.spikes++;
      ctx.fillStyle = "rgba(255,45,85,.14)"; ctx.fillRect(sp[0], sp[1], sp[2], sp[3]);
      ctx.strokeStyle = "rgba(255,45,85,.7)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(sp[0] - 1, sp[1] - 1, sp[2] + 2, sp[3] + 2); ctx.setLineDash([]);
      glow("#ff2d55", 8); ctx.fillStyle = "#ff2d55"; ctx.beginPath();
      for (let x = sp[0]; x < sp[0] + sp[2] - 1; x += 18) for (let y = sp[1]; y < sp[1] + sp[3] - 1; y += 18) {
        const w = Math.min(18, sp[0] + sp[2] - x), h = Math.min(18, sp[1] + sp[3] - y);
        ctx.moveTo(x + 1, y + h - 1); ctx.lineTo(x + w / 2, y + 1); ctx.lineTo(x + w - 1, y + h - 1); ctx.closePath();
      }
      ctx.fill(); noGlow();
    }
    // portas
    lv.gates.forEach((g, gi) => {
      dc.gates++;
      const open = s && s.g[gi] === 1, r = g.r, c = GATE_COL[gi % GATE_COL.length];
      if (open) { ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      else {
        glow(c, 8); ctx.fillStyle = c; ctx.globalAlpha = 0.85; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.globalAlpha = 1; noGlow();
        ctx.fillStyle = "#07060f"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const vertical = r[2] <= r[3];
        for (let k = 0; k < (vertical ? r[3] / 20 : r[2] / 20); k++) ctx.fillText(GATE_SYM[gi % GATE_SYM.length], vertical ? r[0] + r[2] / 2 : r[0] + 10 + k * 20, vertical ? r[1] + 10 + k * 20 : r[1] + r[3] / 2);
      }
    });
    // mecanismos: PLACA DE PRESSÃO (retangular, ▼: a porta fica aberta só enquanto alguém está em cima) e
    // INTERRUPTOR (redondo, ◉: depois de acionado a porta fica aberta até o fim da tentativa).
    // Cada um leva a cor e o símbolo da porta que controla.
    lv.plates.forEach((p, pi) => {
      dc.plates++;
      const gi = lv.gates.findIndex((g) => g.plates.includes(pi)), gg = Math.max(0, gi), c = GATE_COL[gg % GATE_COL.length], sym = GATE_SYM[gg % GATE_SYM.length], on = s && s.pl[pi] === 1;
      ctx.save(); ctx.translate(p.x, p.y);
      glow(c, on ? 16 : 0);
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.fillStyle = on ? c : "#14112e";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (p.hold) {
        ctx.beginPath(); ctx.roundRect(-20, -13, 40, 26, 5); ctx.fill(); ctx.stroke(); noGlow();
        ctx.fillStyle = on ? "#07060f" : c; ctx.font = "bold 14px sans-serif"; ctx.fillText("▼", -8, 1); ctx.fillText(sym, 9, 1);
        ctx.font = "bold 9px sans-serif"; ctx.fillStyle = c; ctx.fillText("PLACA · segurar", 0, 24);
      } else {
        ctx.beginPath(); ctx.arc(0, 0, 15, 0, 7); ctx.fill(); ctx.stroke(); noGlow();
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.strokeStyle = on ? "#07060f" : c; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = on ? "#07060f" : c; ctx.font = "bold 11px sans-serif"; ctx.fillText(on ? "✔" : sym, 0, 1);
        ctx.font = "bold 9px sans-serif"; ctx.fillStyle = c; ctx.fillText("INTERRUPTOR · liga", 0, 24);
      }
      noGlow(); ctx.restore();
    });
    // lasers
    for (const l of lv.lasers) {
      dc.lasers++;
      const st = s && s.ph === "play" ? laserState(l, t) : s && s.ph === "count" ? 0 : laserState(l, t);
      const r = l.r, horiz = r[2] >= r[3];
      const ax = horiz ? r[0] : r[0] + r[2] / 2, ay = horiz ? r[1] + r[3] / 2 : r[1], bx = horiz ? r[0] + r[2] : ax, by = horiz ? ay : r[1] + r[3];
      ctx.lineCap = "butt";
      if (st === 0) { ctx.strokeStyle = "#ff2d55"; ctx.globalAlpha = 0.22; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
      else if (st === 1) { const bl = RM() ? 0.8 : 0.5 + 0.5 * Math.sin(now / 30); ctx.strokeStyle = "#ffd23f"; ctx.globalAlpha = 0.35 + 0.65 * bl; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]); }
      else { glow("#ff2d55", 18); ctx.strokeStyle = "#ff2d55"; ctx.globalAlpha = 1; ctx.lineWidth = Math.min(r[2], r[3]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); noGlow(); ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, Math.min(r[2], r[3]) / 3); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
      ctx.globalAlpha = 1;
      for (const [ex, ey] of [[ax, ay], [bx, by]]) { ctx.fillStyle = "#2a1020"; ctx.strokeStyle = st === 1 ? "#ffd23f" : "#ff2d55"; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(ex - 8, ey - 8, 16, 16, 4); ctx.fill(); ctx.stroke(); ctx.fillStyle = st === 0 ? "#5a2a3a" : st === 1 ? "#ffd23f" : "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 3, 0, 7); ctx.fill(); }
    }
    // serras
    for (const m of lv.saws) {
      dc.saws++;
      const p = sawPos(m, t);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(RM() ? 0 : now / 160 + m.x1);
      glow("#ff3df2", 10); ctx.fillStyle = "#ff3df2"; ctx.beginPath();
      for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, rr = i % 2 ? m.r * 0.78 : m.r + 2; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); noGlow(); ctx.fillStyle = "#1a0830"; ctx.beginPath(); ctx.arc(0, 0, m.r * 0.35, 0, 7); ctx.fill(); ctx.restore();
    }
    try {
    // portais (iguais aos da campanha): entrar em um leva ao outro; reativam só depois de sair da área de chegada
    (lv.portals || []).forEach((pr, pi) => {
      dc.portals++;
      const col = ["#19f0ff", "#ff3df2", "#ffd23f"][pi % 3];
      for (const end of ["a", "b"]) {
        const q = pr[end]; ctx.save(); ctx.translate(q.x, q.y); glow(col, 14);
        ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.stroke();
        ctx.lineWidth = 2; ctx.globalAlpha = 0.7; ctx.beginPath(); const a0 = RM() ? 0 : now / 400; ctx.arc(0, 0, 10, a0, a0 + 4.2); ctx.stroke(); ctx.globalAlpha = 1; noGlow();
        ctx.fillStyle = col; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(end === "a" ? "⇄" : "⇄", 0, 1);
        ctx.font = "bold 9px sans-serif"; ctx.fillText("PORTAL " + (pi + 1), 0, 28); ctx.restore();
      }
    });
    } catch (e) { drawFail("portais", e); }
    try {
    // drones de patrulha (matam qualquer um): rota discreta + corpo
    (lv.drones || []).forEach((d) => {
      dc.drones++;
      ctx.strokeStyle = "rgba(255,45,85,.22)"; ctx.lineWidth = 2; ctx.setLineDash([3, 7]); ctx.beginPath();
      d.route.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); if (d.route.length > 2) ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      const q = dronePosJS(d, t), rr = (d.r || 12) + 3;
      ctx.save(); ctx.translate(q[0], q[1]); glow("#ff2d55", 14); ctx.fillStyle = "#ff2d55"; ctx.beginPath(); ctx.moveTo(0, -rr); ctx.lineTo(rr, 0); ctx.lineTo(0, rr); ctx.lineTo(-rr, 0); ctx.closePath(); ctx.fill(); noGlow();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, 3.5, 0, 7); ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    });
    } catch (e) { drawFail("drones", e); }
    C.drawn = dc;
    // porta de saída e ÁREA de saída (todos precisam estar dentro dela, vivos, ao mesmo tempo)
    const d = lv.door, open = !!(s && s.k);
    ctx.strokeStyle = open ? "rgba(57,255,136,.8)" : "rgba(140,136,184,.55)"; ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.fillStyle = open ? "rgba(57,255,136,.07)" : "rgba(140,136,184,.05)";
    ctx.fillRect(d[0] - EXIT_HALF, d[1] - EXIT_HALF, EXIT_HALF * 2, EXIT_HALF * 2); ctx.strokeRect(d[0] - EXIT_HALF, d[1] - EXIT_HALF, EXIT_HALF * 2, EXIT_HALF * 2); ctx.setLineDash([]);
    if (s) {
      ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      const ty = d[1] - EXIT_HALF - 6 < 14 ? d[1] + EXIT_HALF + 14 : d[1] - EXIT_HALF - 6;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(7,6,15,.9)"; const tx = `${s.in || 0}/${s.n || nP()}`; ctx.strokeText(tx, d[0], ty); ctx.fillStyle = (s.in || 0) === (s.n || nP()) ? "#39ff88" : "#e9e7ff"; ctx.fillText(tx, d[0], ty);
    }
    glow(open ? "#39ff88" : "#000", open ? 16 : 0);
    ctx.fillStyle = open ? "rgba(57,255,136,.18)" : "#17142e"; ctx.strokeStyle = open ? "#39ff88" : "#6a6690"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(d[0] - 20, d[1] + 20); ctx.lineTo(d[0] - 20, d[1] - 8); ctx.arc(d[0], d[1] - 8, 20, Math.PI, 0); ctx.lineTo(d[0] + 20, d[1] + 20); ctx.closePath(); ctx.fill(); ctx.stroke(); noGlow();
    ctx.fillStyle = open ? "#b8ffd6" : "#8c88b8"; ctx.fillRect(d[0] - 8, d[1] - 2, 16, 13);
    // chave
    if (!(s && s.k)) {
      const bob = RM() ? 0 : Math.sin(now / 300) * 3;
      ctx.save(); ctx.translate(lv.key[0], lv.key[1] + bob); ctx.rotate(-0.6); glow("#ffd23f", 14);
      ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(-8, 0, 6, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(12, 0); ctx.moveTo(8, 0); ctx.lineTo(8, 6); ctx.moveTo(12, 0); ctx.lineTo(12, 5); ctx.stroke(); noGlow(); ctx.restore();
    }
    // jogadores
    if (s) {
      const k = 1 - Math.exp(-dt * 22);
      for (let i = 0; i < Math.min(nP(), s.p.length); i++) {
        const tg = s.p[i];
        let sh = C.shown[i];
        const rp = i !== C.you ? remotePos(i, now) : null;
        if (i === C.you && C.pr && s.ph === "play") sh = C.shown[i] = { x: C.pr.x + C.dispOff.x, y: C.pr.y + C.dispOff.y };   // local: previsto, responde na hora
        else if (rp) sh = C.shown[i] = rp;                                                                                    // remotos: interpolados
        else if (!sh || Math.hypot(sh.x - tg[0], sh.y - tg[1]) > 70 || RM()) sh = C.shown[i] = { x: tg[0], y: tg[1] };
        else { sh.x += (tg[0] - sh.x) * k; sh.y += (tg[1] - sh.y) * k; }
        const r = roleOf(i), pl = C.room && C.room.players[i], skin = (pl && pl.skin) || "explorer";
        let po = C.pose[i];
        if (!po) po = C.pose[i] = { px: sh.x, py: sh.y, t: 0, fx: i === C.you ? 1 : 1, fy: 0, walk: 0, phase: 0, dash: false, glow: 0, dead: -1, win: false, rm: false };
        const mx = sh.x - po.px, my = sh.y - po.py, mv = Math.hypot(mx, my);
        po.px = sh.x; po.py = sh.y; po.t += dt; po.rm = RM();
        if (mv > 0.05 && mv < 40) { po.fx = mx / mv; po.fy = my / mv; po.phase += mv * 0.28; }
        po.walk += (Math.min(1, mv / Math.max(dt, 0.001) / 200) - po.walk) * Math.min(1, dt * 14);
        ctx.save(); ctx.translate(sh.x, sh.y);
        // aro no chão com a cor do papel (quem é imune a quê) e destaque para você
        ctx.lineWidth = i === C.you ? 3 : 2; ctx.strokeStyle = r.color; ctx.globalAlpha = i === C.you ? 1 : 0.8;
        glow(r.color, 10); ctx.beginPath(); ctx.ellipse(0, 11, 14, 5, 0, 0, Math.PI * 2); ctx.stroke(); noGlow(); ctx.globalAlpha = 1;
        ctx.restore();
        if (API.drawCharacter) API.drawCharacter(ctx, sh.x, sh.y, skin, po);
        else { ctx.save(); ctx.translate(sh.x, sh.y); glow(r.color, 12); ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(0, 0, 11, 0, 7); ctx.fill(); noGlow(); ctx.restore(); }
        ctx.save(); ctx.translate(sh.x, sh.y);
        ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(7,6,15,.9)";
        const label = (i === C.you ? "▼ " : "") + r.icon + " " + name(i) + (tg[2] === 1 ? " ✔" : ""); ctx.strokeText(label, 0, -22); ctx.fillStyle = i === C.you ? "#fff" : r.color; ctx.fillText(label, 0, -22);
        ctx.restore();
      }
    }
    // balões de mensagem rápida
    C.emos = C.emos.filter((e) => e.until > now);
    for (const e of C.emos) {
      const sh = C.shown[e.s]; if (!sh) continue;
      const txt = EMOS[e.k][0] + " " + EMOS[e.k][1];
      ctx.font = "bold 13px sans-serif"; const w = ctx.measureText(txt).width + 14;
      const bx = Math.max(4, Math.min(W - w - 4, sh.x - w / 2)), by = Math.max(4, sh.y - 56);
      ctx.fillStyle = "rgba(255,255,255,.95)"; ctx.beginPath(); ctx.roundRect(bx, by, w, 22, 8); ctx.fill();
      ctx.fillStyle = "#1a1740"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 7, by + 11);
    }
    // contagem / aviso de derrota
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (s && s.ph === "count") {
      const c = Math.max(0, s.c - (now - C.snapAt) / 1000);
      ctx.fillStyle = "rgba(7,6,15,.45)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#19f0ff"; ctx.font = "bold 120px 'Trebuchet MS', sans-serif"; ctx.fillText(String(Math.max(1, Math.ceil(c))), W / 2, H / 2);
      ctx.font = "bold 22px 'Trebuchet MS', sans-serif"; ctx.fillStyle = "#ffd23f"; ctx.fillText(`${SET_TAG[C.level.set] || ""}${C.level.name}`, W / 2, H / 2 + 70);
      ctx.font = "bold 16px sans-serif"; ctx.fillStyle = "#e9e7ff";
      const words = String(C.level.intro || C.level.hint || "").split(" "); let line = "", ly = H / 2 + 98;
      for (const w of words) { const t2 = line ? line + " " + w : w; if (ctx.measureText(t2).width > W - 120 && line) { ctx.fillText(line, W / 2, ly); ly += 21; line = w; } else line = t2; }
      if (line) ctx.fillText(line, W / 2, ly);
    } else if (now - C.goFlash < 700) {
      ctx.globalAlpha = 1 - (now - C.goFlash) / 700; ctx.fillStyle = "#39ff88"; ctx.font = "bold 90px 'Trebuchet MS', sans-serif"; ctx.fillText("VAI!", W / 2, H / 2); ctx.globalAlpha = 1;
    }
    if (s && s.ph === "lost" || now < C.loseUntil) {
      ctx.fillStyle = "rgba(60,0,15,.55)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#ff2d55"; ctx.font = "bold 34px 'Trebuchet MS', sans-serif"; ctx.fillText(C.loseText || "Tentativa perdida", W / 2, H / 2 - 10);
      ctx.fillStyle = "#e9e7ff"; ctx.font = "bold 18px sans-serif"; ctx.fillText("Reiniciando…", W / 2, H / 2 + 30);
    }
    if (s && s.ph === "won") {
      const k = Math.min(1, (now - (C.wonAt || now)) / 250);
      ctx.globalAlpha = k; ctx.fillStyle = "rgba(7,6,15,.35)"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#39ff88"; glow("#39ff88", 18); ctx.font = "bold 64px 'Trebuchet MS', sans-serif"; ctx.fillText("Escaparam! 🎉", W / 2, H / 2 - 6); noGlow();
      ctx.fillStyle = "#e9e7ff"; ctx.font = "bold 20px sans-serif"; ctx.fillText(`${s.e.toFixed(1)} s de ${C.level.time} s`, W / 2, H / 2 + 44);
      ctx.globalAlpha = 1;
    }
    // marcações no mapa (autor, símbolo e cor do papel)
    C.marks = C.marks.filter((m) => m.until > now);
    for (const m of C.marks) {
      const r = roleOf(m.s), life = (m.until - now) / 5000, mk = MARKS[m.k] || MARKS[0];
      const pulse = RM() ? 0 : (1 - life) * 26 % 26;
      ctx.save(); ctx.translate(m.x, m.y); ctx.globalAlpha = Math.min(1, life * 3);
      glow(r.color, 12); ctx.strokeStyle = r.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 10 + pulse, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 5, 0, 7); ctx.fillStyle = r.color; ctx.fill(); noGlow();
      const txt = `${mk[0]} ${mk[1]} — ${r.icon} ${name(m.s)}`;
      ctx.font = "bold 12px sans-serif"; const w = ctx.measureText(txt).width + 14, bx = Math.max(-m.x + 4, Math.min(W - m.x - w - 4, -w / 2)), by = m.y < 50 ? 18 : -42;
      ctx.fillStyle = "rgba(18,16,42,.95)"; ctx.strokeStyle = r.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(bx, by, w, 22, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 7, by + 11);
      ctx.restore();
    }
    // espera pela carga em todos os navegadores (o tempo não corre)
    const ld = $("co-load");
    if (!s || s.ph === "wait") {
      const waiting = s && s.ld ? s.ld.map((v, i) => (v ? null : name(i))).filter(Boolean) : [];
      ld.textContent = (C.level ? `${SET_TAG[C.level.set] || ""}${C.level.name}\n${C.level.intro || ""}\n\n` : "") + (waiting.length ? "Preparando a fase… aguardando " + waiting.join(", ") : "Preparando a fase…"); ld.classList.remove("hidden");
    } else ld.classList.add("hidden");
    // HUD em texto
    const lim = limitOf(), left = Math.max(0, lim - t);
    const tm = $("co-timer"); tm.textContent = left.toFixed(1);
    tm.classList.toggle("danger", left <= 5 && s && s.ph === "play");
    $("co-bar").style.width = Math.max(0, Math.min(100, (left / lim) * 100)) + "%";
    const ex = $("co-exit");
    if (s) {
      const need = s.n || nP(), inn = s.in || 0;
      ex.textContent = `Jogadores na saída: ${inn}/${need}` + (s.k ? "" : " · falta pegar a chave 🗝");
      ex.parentNode.classList.toggle("ok", inn === need && s.k === 1);
    }
  }

  /* ------------------------------------------------------------------ ligações da interface */
  $("co-create").addEventListener("click", () => enter("create"));
  $("co-join").addEventListener("click", () => enter("join"));
  $("co-code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4); });
  $("co-code").addEventListener("keydown", (e) => { if (e.key === "Enter") enter("join"); });
  $("co-name").addEventListener("keydown", (e) => { if (e.key === "Enter") enter($("co-code").value ? "join" : "create"); });
  $("co-back").addEventListener("click", () => close(true));
  $("co-leave").addEventListener("click", () => close(true));
  $("co-level").addEventListener("change", (e) => { const l = e.target.value === "" ? null : lvl(+e.target.value); if (l) send({ t: "level", mid: l.mid }); });
  $("co-start").addEventListener("click", () => send({ t: "start" }));
  $("co-copy").addEventListener("click", async () => {
    const url = (C.same ? location.origin + location.pathname : "") + (C.same ? "?sala=" + C.code : "");
    const text = C.same ? `Vem jogar comigo! Dez segundos para fugir (3 jogadores): ${url} — código da sala: ${C.code}` : `Vem jogar comigo! Dez segundos para fugir — código da sala: ${C.code}`;
    try { await navigator.clipboard.writeText(text); banner("Convite copiado! Cole no WhatsApp ou Discord.", "good", 3000); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); banner("Convite copiado!", "good", 3000); } catch (x) { banner("Copie o código: " + C.code, "info", 5000); } ta.remove(); }
  });
  $("co-restart").addEventListener("click", () => send({ t: "restart", a: C.snap ? C.snap.a : undefined }));
  $("co-menu").addEventListener("click", togglePop);
  $("co-pop-continue").addEventListener("click", togglePop);
  $("co-pop-lobby").addEventListener("click", () => { togglePop(); send({ t: "lobby" }); });
  $("co-pop-leave").addEventListener("click", () => { togglePop(); close(true); });
  { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost"; b.textContent = "📊 Diagnóstico de rede (liga/desliga)";
    b.addEventListener("click", () => { toggleDiag(); togglePop(); }); $("co-pop-leave").parentNode.appendChild(b); }

  window.OnlineCoop = { open, close, state: C };
})();
