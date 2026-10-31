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
  const panel = $("coop");
  if (!API || !panel) return;

  const LS_NAME = "dez-segundos-online-apelido", LS_URL = "dez-segundos-online-servidor", SS_SESSION = "dez-segundos-online-sessao";
  const W = 800, H = 500;
  const GATE_COL = ["#19f0ff", "#ff3df2", "#ffd23f", "#39ff88", "#ff8a3d", "#b58cff"];
  const GATE_SYM = ["◆", "●", "▲", "■", "★", "✚"];
  const EMOS = [["👍", "Beleza!"], ["✋", "Espera!"], ["👉", "Vem aqui!"], ["⚠️", "Cuidado!"], ["🔑", "Pega a chave!"], ["🆘", "Preciso de ajuda!"]];
  const WHY = { spike: "caiu nos espinhos", laser: "tocou no laser", saw: "encostou numa serra", crush: "ficou preso na porta", time: "o tempo acabou" };
  const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const ssGet = (k) => { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } };
  const ssSet = (k, v) => { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) {} };
  const RM = () => !!(API.RM && API.RM());
  const sfx = (n) => { try { API.Sfx.play(n); } catch (e) {} };

  const C = {
    ws: null, url: "", same: false, probed: false, hi: null, you: null, code: "", token: "", room: null, level: null, roles: [],
    view: "connect", snap: null, snapAt: 0, shown: [null, null, null], pose: [null, null, null], emos: [], rtt: null, closing: false, retryTimer: 0, retryStart: 0,
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
    wire.ping = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: "ping", ts: Date.now() })); }, 5000);
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
      send(kind === "create" ? { t: "create", name, skin } : { t: "join", code, name, skin });
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
      case "room": C.room = m; renderLobby(); updateChips(); updatePaused(); break;
      case "level": C.level = m.level; C.total = m.total; C.roles = m.roles; C.snap = null; C.result = null; C.shown = [null, null, null]; C.pose = [null, null, null]; C.wonAt = 0; C.emos = []; C.lastCount = -1; buildChips(); showView("game"); sfx("blip"); break;
      case "s": onSnap(m); break;
      case "ev": onEvent(m.e); break;
      case "paused": banner("Um jogador caiu. O jogo está pausado esperando ele voltar…", "bad"); break;
      case "stopped": C.level = null; C.snap = null; C.result = null; if (C.view === "game") showView("lobby"); renderLobby(); banner(m.why || "", m.why && m.why.includes("zeraram") ? "good" : "info", 6000); break;
      case "emo": C.emos.push({ s: m.s, k: m.k, until: performance.now() + 2500 }); sfx("blip"); break;
      case "pong": C.rtt = Date.now() - m.ts; $("co-ping").textContent = C.rtt + " ms"; break;
      case "err":
        setBusy(false); banner(m.msg, "bad", 5000);
        if (/voltar para a sala/.test(m.msg)) give(m.msg);
        break;
    }
  }
  function onSnap(m) {
    const prev = C.snap;
    C.snap = m; C.snapAt = performance.now();
    if (prev && prev.ph !== "won" && m.ph === "won") C.wonAt = performance.now();
    if (m.ph === "count" && Math.ceil(m.c) !== C.lastCount) { C.lastCount = Math.ceil(m.c); if (C.lastCount > 0) sfx("tick"); }
    if (m.ph === "count" && prev && prev.a !== m.a) { C.result = null; hideResult(); C.shown = [null, null, null]; C.pose = [null, null, null]; C.wonAt = 0; }
    if (m.ph !== "count") C.lastCount = -1;
    updateChips();
  }
  function name(i) { const p = C.room && C.room.players[i]; return p ? p.name : "Jogador"; }
  /** Papéis do jogador i (lista). Com menos de 3 jogadores um jogador acumula papéis. */
  function roleIds(i) { const r = C.roles && C.roles[i]; return Array.isArray(r) ? r : r ? [r] : []; }
  function roleOf(i) {
    const infos = roleIds(i).map((id) => C.hi && C.hi.roles[id]).filter(Boolean);
    if (!infos.length) return { name: "?", icon: "●", color: "#aaa" };
    return { name: infos.map((x) => x.name).join(" + "), icon: infos.map((x) => x.icon).join(""), color: infos[0].color };
  }
  function nP() { return C.roles && C.roles.length ? C.roles.length : 3; }
  function onEvent(e) {
    const k = e[0];
    if (k === "key") { sfx("key"); banner(`🗝 ${name(e[1])} pegou a chave! Agora todos podem usar a porta.`, "good", 3500); }
    else if (k === "gate") { sfx("switch"); }
    else if (k === "plate") { if (e[2]) sfx("blip"); }
    else if (k === "esc") { sfx("portal"); banner(`🚪 ${name(e[1])} escapou!`, "good", 2500); }
    else if (k === "go") { sfx("blip"); C.goFlash = performance.now(); }
    else if (k === "lose") {
      sfx("lose");
      const who = e[1], why = WHY[e[2]] || "falhou";
      C.loseText = who >= 0 ? `${roleOf(who).icon} ${name(who)} ${why}!` : "⏱ O tempo acabou!";
      C.loseUntil = performance.now() + 2200;
      banner(C.loseText + " Reiniciando…", "bad", 2300);
    } else if (k === "win") { sfx("win"); }
  }

  /* ------------------------------------------------------------------ sala (lobby) */
  function isHost() { return C.room && C.room.host === C.you; }
  function renderLobby() {
    const r = C.room;
    if (!r || C.view === "connect") return;
    $("co-code-big").textContent = r.code;
    const size = r.size || 3, mineRoles = (r.players[C.you] && r.players[C.you].roles) || [];
    const sizeEl = $("co-size"); sizeEl.textContent = "";
    for (let n = 1; n <= 3; n++) {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(n === size));
      b.textContent = n === 1 ? "1 jogador" : n + " jogadores";
      b.disabled = !isHost() || r.phase !== "lobby";
      b.addEventListener("click", () => send({ t: "size", n }));
      sizeEl.appendChild(b);
    }
    $("co-size-note").textContent = isHost() ? (size < 3 ? "Com menos de 3, cada jogador pode pegar mais de um papel (🔥 💧 🌿)." : "") : "Só o anfitrião escolhe quantos jogam.";
    const list = $("co-slots"); list.textContent = "";
    r.players.slice(0, size).forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "co-slot" + (p ? "" : " empty") + (p && !p.on ? " off" : "");
      if (!p) { li.textContent = "Aguardando jogador…"; }
      else {
        const infos = (p.roles || []).map((id) => C.hi && C.hi.roles[id]).filter(Boolean);
        const b = document.createElement("b"); b.textContent = p.name + (i === C.you ? " (você)" : "");
        const s = document.createElement("span");
        s.textContent = [i === r.host ? "👑 anfitrião" : "", infos.length ? infos.map((x) => `${x.icon} ${x.name}`).join(" + ") : "sem papel", p.on ? "" : "⚠ caiu"].filter(Boolean).join(" · ");
        li.append(b, s);
      }
      list.appendChild(li);
    });
    const rolesEl = $("co-roles"); rolesEl.textContent = "";
    $("co-roles-note").textContent = size < 3 ? "Todos os 3 papéis precisam ser escolhidos. Toque de novo para soltar um papel." : "";
    for (const id of Object.keys(C.hi ? C.hi.roles : {})) {
      const info = C.hi.roles[id], have = mineRoles.includes(id);
      const takenBy = r.players.findIndex((p, i) => p && i !== C.you && (p.roles || []).includes(id));
      const b = document.createElement("button");
      b.type = "button"; b.className = "co-role"; b.setAttribute("role", "checkbox"); b.setAttribute("aria-checked", String(have));
      b.disabled = takenBy >= 0 || r.phase !== "lobby";
      b.style.setProperty("--rc", info.color);
      b.innerHTML = `<b></b><span></span><small></small>`;
      b.children[0].textContent = `${info.icon} ${info.name}`;
      b.children[1].textContent = info.desc;
      b.children[2].textContent = takenBy >= 0 ? `Escolhido por ${r.players[takenBy].name}` : have ? "Seu papel (toque para soltar)" : "Toque para escolher";
      b.addEventListener("click", () => send({ t: "role", role: id }));
      rolesEl.appendChild(b);
    }
    const sel = $("co-level");
    if (C.hi) {
      sel.textContent = "";
      C.hi.levels.forEach((l, i) => {
        const o = document.createElement("option"); o.value = i;
        const need = l.min || 1;
        o.textContent = `${l.id}. ${l.name} (${l.time}s)` + (need > 1 ? ` · ${need}+ jogadores` : "");
        o.disabled = need > size; sel.appendChild(o);
      });
    }
    sel.value = r.level; sel.disabled = !isHost();
    $("co-level-note").textContent = isHost() ? "" : "Só o anfitrião escolhe a fase.";
    const seated = r.players.slice(0, size);
    let why = "";
    const missing = seated.filter((p) => !p).length;
    if (missing) why = `Faltam ${missing} jogador${missing > 1 ? "es" : ""}. Mande o código ${r.code}.`;
    else if (seated.some((p) => !p.on)) why = "Um jogador está desconectado.";
    else if (seated.some((p) => !(p.roles || []).length)) why = "Cada jogador precisa escolher pelo menos um papel.";
    else if (seated.reduce((n, p) => n + p.roles.length, 0) !== 3) why = "Os 3 papéis (🔥 💧 🌿) precisam estar escolhidos.";
    const start = $("co-start");
    start.classList.toggle("hidden", !isHost());
    start.disabled = !!why;
    $("co-start-note").textContent = isHost() ? (why || "Tudo pronto!") : "Aguardando o anfitrião começar.";
  }

  /* ------------------------------------------------------------------ HUD */
  function buildChips() {
    const box = $("co-chips"); box.textContent = "";
    for (let i = 0; i < nP(); i++) {
      const d = document.createElement("div"); d.className = "co-chip"; d.id = "co-chip" + i;
      d.style.setProperty("--rc", roleOf(i).color);
      box.appendChild(d);
    }
    $("co-lvname").textContent = C.level ? `Fase ${C.level.id}: ${C.level.name}` : "";
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
  function hideResult() { $("co-result").classList.add("hidden"); }
  function btn(label, cls, fn) { const b = document.createElement("button"); b.type = "button"; b.className = cls; b.textContent = label; b.addEventListener("click", fn); return b; }

  /* ------------------------------------------------------------------ entrada */
  const keys = new Set(), padDirs = new Set();
  const KEYMAP = { ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r", ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d" };
  function dir() {
    const has = (k) => keys.has(k) || padDirs.has(k);
    return [(has("r") ? 1 : 0) - (has("l") ? 1 : 0), (has("d") ? 1 : 0) - (has("u") ? 1 : 0)];
  }
  function releaseDir() { keys.clear(); padDirs.clear(); document.querySelectorAll("#co-pad .dir.active").forEach((b) => b.classList.remove("active")); pushDir(true); }
  function pushDir(force) {
    let d = C.view === "game" && C.snap && C.snap.ph === "play" ? dir() : [0, 0];
    const now = performance.now();
    if (force || d[0] !== C.sentDir[0] || d[1] !== C.sentDir[1] || ((d[0] || d[1]) && now - C.dirAt > 120)) {
      if (!force || d[0] !== C.sentDir[0] || d[1] !== C.sentDir[1]) send({ t: "in", x: d[0], y: d[1] });
      C.sentDir = d; C.dirAt = now;
    }
  }
  setInterval(() => { if (C.view === "game") pushDir(false); }, 60);
  const typing = (t) => t && t.closest && t.closest("input, textarea, select");
  window.addEventListener("keydown", (e) => {
    if (panel.classList.contains("hidden") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (C.view !== "game") { if (e.code === "Escape" && !typing(e.target)) { e.stopPropagation(); leaveAsk(); } return; }
    if (typing(e.target)) return;
    if (e.code === "Escape") { e.stopPropagation(); togglePop(); return; }
    if (!$("co-pop").classList.contains("hidden")) return;
    if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); pushDir(false); return; }
    if (/^Digit[1-6]$/.test(e.code)) { send({ t: "emo", k: +e.code.slice(5) - 1 }); return; }
    if (e.code === "KeyR" && isHost() && !e.repeat) { send({ t: "restart" }); }
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
    draw(now, dt);
    C.raf = requestAnimationFrame(frame);
  }
  function localElapsed(now) {
    const s = C.snap; if (!s) return 0;
    if (s.ph !== "play") return s.e;
    return Math.min(C.level.time, s.e + (now - C.snapAt) / 1000);
  }
  function glow(c, b) { if (!RM()) { ctx.shadowColor = c; ctx.shadowBlur = b; } }
  function noGlow() { ctx.shadowBlur = 0; }

  function draw(now, dt) {
    const lv = C.level, s = C.snap;
    if (!lv || !cv.width) return;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    ctx.fillStyle = "#0b0a1c"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(90,84,170,.12)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = 0; x <= W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    const t = localElapsed(now);
    // ligações placa -> porta (fracas)
    lv.gates.forEach((g, gi) => {
      const gx = g.r[0] + g.r[2] / 2, gy = g.r[1] + g.r[3] / 2;
      ctx.strokeStyle = GATE_COL[gi % GATE_COL.length]; ctx.globalAlpha = 0.18; ctx.lineWidth = 2; ctx.setLineDash([4, 6]);
      g.plates.forEach((pi) => { const p = lv.plates[pi]; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(gx, gy); ctx.stroke(); });
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    });
    // paredes
    ctx.fillStyle = "#26225e"; ctx.strokeStyle = "#5a54c0"; ctx.lineWidth = 2;
    for (const w of lv.walls) { ctx.fillRect(w[0], w[1], w[2], w[3]); ctx.strokeRect(w[0] + 1, w[1] + 1, w[2] - 2, w[3] - 2); }
    // espinhos
    for (const sp of lv.spikes) {
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
      const open = s && s.g[gi] === 1, r = g.r, c = GATE_COL[gi % GATE_COL.length];
      if (open) { ctx.strokeStyle = c; ctx.globalAlpha = 0.5; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.strokeRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      else {
        glow(c, 8); ctx.fillStyle = c; ctx.globalAlpha = 0.85; ctx.fillRect(r[0], r[1], r[2], r[3]); ctx.globalAlpha = 1; noGlow();
        ctx.fillStyle = "#07060f"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        const vertical = r[2] <= r[3];
        for (let k = 0; k < (vertical ? r[3] / 20 : r[2] / 20); k++) ctx.fillText(GATE_SYM[gi % GATE_SYM.length], vertical ? r[0] + r[2] / 2 : r[0] + 10 + k * 20, vertical ? r[1] + 10 + k * 20 : r[1] + r[3] / 2);
      }
    });
    // placas
    lv.plates.forEach((p, pi) => {
      const gi = lv.gates.findIndex((g) => g.plates.includes(pi)), c = GATE_COL[Math.max(0, gi) % GATE_COL.length], on = s && s.pl[pi] === 1;
      ctx.save(); ctx.translate(p.x, p.y);
      glow(c, on ? 16 : 0);
      ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.fillStyle = on ? c : "#14112e";
      if (p.hold) { ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.fill(); ctx.stroke(); noGlow(); ctx.fillStyle = on ? "#07060f" : c; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("▼", 0, 1); }
      else { ctx.beginPath(); ctx.roundRect(-14, -14, 28, 28, 6); ctx.fill(); ctx.stroke(); noGlow(); ctx.fillStyle = on ? "#07060f" : c; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(on ? "✔" : "●", 0, 1); }
      noGlow(); ctx.restore();
    });
    // lasers
    for (const l of lv.lasers) {
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
      const p = sawPos(m, t);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(RM() ? 0 : now / 160 + m.x1);
      glow("#ff3df2", 10); ctx.fillStyle = "#ff3df2"; ctx.beginPath();
      for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2, rr = i % 2 ? m.r * 0.78 : m.r + 2; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); noGlow(); ctx.fillStyle = "#1a0830"; ctx.beginPath(); ctx.arc(0, 0, m.r * 0.35, 0, 7); ctx.fill(); ctx.restore();
    }
    // porta de saída
    const d = lv.door, open = !!(s && s.k);
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
        if (!sh || Math.hypot(sh.x - tg[0], sh.y - tg[1]) > 70 || RM()) sh = C.shown[i] = { x: tg[0], y: tg[1] };
        else { sh.x += (tg[0] - sh.x) * k; sh.y += (tg[1] - sh.y) * k; }
        if (tg[2] === 1) { C.pose[i] = null; continue; }
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
        const label = (i === C.you ? "▼ " : "") + r.icon + " " + name(i); ctx.strokeText(label, 0, -22); ctx.fillStyle = i === C.you ? "#fff" : r.color; ctx.fillText(label, 0, -22);
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
      ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#e9e7ff"; ctx.fillText("Preparem-se! Ajudem-se para chegar à porta.", W / 2, H / 2 + 80);
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
    // HUD em texto
    const left = Math.max(0, C.level.time - t);
    const tm = $("co-timer"); tm.textContent = left.toFixed(1);
    tm.classList.toggle("danger", left <= 5 && s && s.ph === "play");
    $("co-bar").style.width = Math.max(0, Math.min(100, (left / C.level.time) * 100)) + "%";
  }

  /* ------------------------------------------------------------------ ligações da interface */
  $("co-create").addEventListener("click", () => enter("create"));
  $("co-join").addEventListener("click", () => enter("join"));
  $("co-code").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 4); });
  $("co-code").addEventListener("keydown", (e) => { if (e.key === "Enter") enter("join"); });
  $("co-name").addEventListener("keydown", (e) => { if (e.key === "Enter") enter($("co-code").value ? "join" : "create"); });
  $("co-back").addEventListener("click", () => close(true));
  $("co-leave").addEventListener("click", () => close(true));
  $("co-level").addEventListener("change", (e) => send({ t: "level", n: +e.target.value }));
  $("co-start").addEventListener("click", () => send({ t: "start" }));
  $("co-copy").addEventListener("click", async () => {
    const url = (C.same ? location.origin + location.pathname : "") + (C.same ? "?sala=" + C.code : "");
    const text = C.same ? `Vem jogar comigo! Dez segundos para fugir (3 jogadores): ${url} — código da sala: ${C.code}` : `Vem jogar comigo! Dez segundos para fugir — código da sala: ${C.code}`;
    try { await navigator.clipboard.writeText(text); banner("Convite copiado! Cole no WhatsApp ou Discord.", "good", 3000); }
    catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); banner("Convite copiado!", "good", 3000); } catch (x) { banner("Copie o código: " + C.code, "info", 5000); } ta.remove(); }
  });
  $("co-restart").addEventListener("click", () => send({ t: "restart" }));
  $("co-menu").addEventListener("click", togglePop);
  $("co-pop-continue").addEventListener("click", togglePop);
  $("co-pop-lobby").addEventListener("click", () => { togglePop(); send({ t: "lobby" }); });
  $("co-pop-leave").addEventListener("click", () => { togglePop(); close(true); });

  window.OnlineCoop = { open, close, state: C };
})();
