/* =====================================================================
 * game.js — estados do jogo, entrada, cronômetro, desenho e interface.
 * As regras de colisão ficam em engine.js; as fases em levels.js.
 * Para adicionar fases NÃO é preciso mexer neste arquivo: o número de
 * fases, o HUD, a seleção e a tela de vitória leem tudo de LEVELS.
 * ===================================================================== */
(function () {
  "use strict";
  const E = window.Engine;
  const LEVELS = window.LEVELS;
  LEVELS.forEach(E.normalize);
  const N = LEVELS.length; // todas as salas (25)
  const CORE_N = SECTORS_CORE();
  // ---- Missões (modo extra): cópias independentes das salas, com objetivo especial. Dados em missions.js.
  const MISSIONS = window.MISSIONS, MGOALS = window.MISSION_GOALS, MKEY = "dez-segundos-missions-v1";
  MISSIONS.forEach((m) => E.normalize(m.level));
  /** Sala em jogo: índices >= N são missões (N + índice da missão); abaixo disso, a campanha. */
  const CUSTOM_IDX = N + MISSIONS.length; // índice reservado para a fase personalizada em teste (editor)
  let customLv = null, customBack = null, customWin = null; // sala do editor em teste e como voltar ao editor
  const lvAt = (i) => (i === CUSTOM_IDX ? customLv : i >= N ? MISSIONS[i - N].level : LEVELS[i]);
  const NONSTOP_TOL = 6; // "sem parar": deslocamento mínimo (u) a partir da âncora para contar como movimento (ignora oscilações)
  const NONSTOP_MAX = 1.0; // segundos seguidos parado permitidos
  /** Núcleo da campanha = salas dos setores que não são "extra" (1-20): a sala 20 dispara o final. */
  function SECTORS_CORE() { return window.SECTORS.filter((sc) => !sc.extra).reduce((m, sc) => Math.max(m, sc.last + 1), 0); }
  const SAVE_KEY = "dez-segundos-v1"; // mesma chave da versão 1: o progresso antigo continua válido

  const DASH_COLOR = "#ffb02e";
  const GATE_COLORS = ["#ff9f1c", "#b388ff", "#39d0ff", "#ffd23f", "#ff7aa2", "#7dff9a"]; // cor do interruptor/passagem (por índice da passagem)
  const PORTAL_COLORS = ["#b8ff3d", "#ff8ad8", "#5ee7ff"]; // cor de cada par de portais
  const LASER_COLOR = "#ff4d6d";

  const Sfx = window.Sfx;
  const SECTORS = window.SECTORS;
  const sectorOf = (idx) => SECTORS.find((sc) => idx >= sc.first && idx <= sc.last) || SECTORS[0];
  const SETTINGS_KEY = "dez-segundos-settings-v1"; // separado do progresso: "Apagar progresso" não mexe nas preferências

  /** Preferências salvas no aparelho. volume: 0..100. */
  const S = { sound: true, volume: 60, reduceFx: false, touch: "auto", limit: 10, customLimit: 30, limitChosen: false, skin: "explorer" };
  // limit = segundos por tentativa de uma sala (5..300) ou 0 = sem limite. 10 = desafio original (único modo com medalha de tempo). // touch: "auto" | "on" | "off" (controles na tela)
  /* ---- Tempo por sala ---- */
  const LIMIT_PRESETS = [10, 15, 20, 30, 60];
  const LIMIT_MIN = 5, LIMIT_MAX = 300;
  const validLimit = (v) => v === 0 || (Number.isInteger(v) && v >= LIMIT_MIN && v <= LIMIT_MAX);
  /** Texto completo do modo (aparece sempre junto de tempos/recordes). */
  const fmtLimit = (l) => (l === 0 ? "Sem limite" : l === 10 ? "10 s (original)" : `${l} s por sala`);
  const fmtMode = (l) => (l === 0 ? "Sem limite" : l === 10 ? "10 s original" : `${l} s`); // forma curta, para usar entre parênteses
  const limitWord = (l) => (l === 0 ? "sem limite" : `limite ${l} s`);

  function loadSettings() {
    Object.assign(S, { sound: true, volume: 60, reduceFx: false, touch: "auto", limit: 10, customLimit: 30, limitChosen: false, skin: "explorer" }); // recarregar (importar/apagar) parte dos padrões
    try {
      const d = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      if (d && typeof d === "object") {
        if (typeof d.sound === "boolean") S.sound = d.sound;
        if (Number.isFinite(+d.volume)) S.volume = Math.max(0, Math.min(100, Math.round(+d.volume)));
        if (typeof d.reduceFx === "boolean") S.reduceFx = d.reduceFx;
        if (["auto", "on", "off"].includes(d.touch)) S.touch = d.touch;
        if (validLimit(d.limit)) S.limit = d.limit;
        if (Number.isInteger(d.customLimit) && d.customLimit >= 5 && d.customLimit <= 300) S.customLimit = d.customLimit;
        if (d.limitChosen === true) S.limitChosen = true;
        if (typeof d.skin === "string" && SKIN_IDS.includes(d.skin)) S.skin = d.skin;
      }
    } catch (e) { /* sem storage: usa os padrões */ }
  }
  function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(S)); } catch (e) {} }

  const rmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** Efeitos reduzidos: pedido do sistema OU preferência do jogo. Sem tremor, flash, partículas, giro, piscar nem animação de esteira. */
  const RM = () => rmQuery.matches || S.reduceFx;
  function applySettings() {
    if (typeof updateTouchUI === "function") updateTouchUI();
    Sfx.configure({ enabled: S.sound, volume: S.volume / 100 });
    document.body.classList.toggle("reduce-fx", RM());
  }
  if (rmQuery.addEventListener) rmQuery.addEventListener("change", applySettings);

  /* ------------------------------------------------------------------
   * 1. ESTADO
   *   menu     tela inicial            select   seleção de fases
   *   intro    instrução de mecânica nova (cronômetro parado)
   *   cam      aproximação de câmera antes da tentativa (pode ser pulada; não conta tempo)
   *   ready    sala carregada, cronômetro parado até o 1º movimento
   *   playing  cronômetro correndo
   *   lost / won / finished   resultados (overlay)
   *   ending   sequência de fuga após a fase 20 (pode ser pulada)
   *   paused   aba/app em segundo plano (guarda o estado anterior)
   * Tudo que se move depende só de G.elapsed (tempo da tentativa), então
   * pausar congela serras e lasers e reiniciar restaura o ciclo.
   * ------------------------------------------------------------------ */
  const G = {
    state: "menu",
    prevState: null,
    levelIdx: 0,
    elapsed: 0,
    limit: 10, // limite desta tentativa (fixo até reiniciar a sala): segundos ou 0 = sem limite
    lastTick: null, // último segundo avisado nos 3 finais
    pos: { x: 0, y: 0 },
    face: 1,
    vel: { x: 0, y: 0 }, // velocidade própria (usada no gelo)
    faceV: { x: 1, y: 0 }, // direção para onde o personagem olha
    walk: 0, // 0..1 intensidade de caminhada (só visual)
    phase: 0, // fase do ciclo de passos (avança com a DISTÂNCIA andada, não com o quadro)
    glowAt: -9, // instante da última coleta (brilho)
    deadAt: -9, // instante da derrota (animação)
    fade: 0, // transição breve ao entrar numa sala
    mission: -1, // índice da missão em jogo (-1 = campanha)
    custom: false, // true = testando uma fase do editor (não concede nada a outros modos)
    noDash: false, // restrição da missão "sem impulso"
    frag: 0, // máscara de fragmentos coletados (missão "coleta completa")
    stillT: 0, // segundos seguidos parado (missão "sem parar")
    anchor: { x: 0, y: 0 }, // ponto de referência do deslocamento real
    noDashMsgAt: -9,
    camT: 0, // tempo da aproximação de câmera antes da tentativa (estado "cam")
    camDur: 0.9,
    winCam: null, // {t, dur, show}: aproximação após a vitória; o resultado aparece no fim
    endT: 0, // tempo da sequência final
    hasKey: false,
    coin: false, // moeda pega NESTA tentativa (só vale ao vencer)
    dash: null, // impulso em andamento {dx, dy, left}
    dashUsed: false,
    lastDir: { dx: 1, dy: 0 }, // última direção de movimento (usada pelo impulso parado)
    trail: [],
    rt: null, // runtime da tentativa (interruptores, passagens, portais)
    gateAge: [], // segundos desde que cada passagem abriu
    shake: 0,
    flash: 0,
    time: 0, // relógio de animação
  };
  let particles = [];
  let rings = [];

  /* ------------------------------------------------------------------
   * 2. PROGRESSO SALVO (localStorage, se disponível)
   * Formato atual (v5): {v:5, unlocked, attempts, finished, done, coins, fast, best:{fase: s} (modo 10 s), bestBy:{limite: {fase: s}}}.
   * A v3 (igual, sem `finished`) e a v2 ({v:2, unlocked, done, attempts}) são lidas normalmente.
   * (v2: sem moedas/recordes.)
   * Formato da versão 1: {level, attempts} -> fases 0..level-1 concluídas,
   * fase `level` liberada.
   * ------------------------------------------------------------------ */
  // best = melhores tempos do modo ORIGINAL (10 s) — é onde ficam os recordes de versões antigas;
  // bestBy = {"15": {fase: s}, "0": {fase: s}} para os outros limites ("0" = sem limite). Nunca se misturam.
  const P = { unlocked: 0, done: new Set(), coins: new Set(), fast: new Set(), best: {}, bestBy: {}, attempts: 0, finished: false };
  const bestFor = (limit, i) => (limit === 10 ? P.best[i] : (P.bestBy[String(limit)] || {})[i]);
  function setBest(limit, i, t) {
    if (limit === 10) P.best[i] = t;
    else { (P.bestBy[String(limit)] = P.bestBy[String(limit)] || {})[i] = t; }
  }
  const hasProgress = () => P.unlocked > 0 || P.done.size > 0 || P.attempts > 0;
  const clampLevel = (v) => Math.max(0, Math.min(N - 1, v | 0));
  const validIdx = (i) => Number.isInteger(i) && i >= 0 && i < N;

  function loadProgress() {
    P.unlocked = 0; P.done = new Set(); P.coins = new Set(); P.fast = new Set(); P.best = {}; P.bestBy = {}; P.attempts = 0; P.finished = false;
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return;
      P.attempts = Math.max(0, d.attempts | 0);
      if (d.v >= 2) {
        P.unlocked = clampLevel(d.unlocked);
        (Array.isArray(d.done) ? d.done : []).forEach((i) => { if (validIdx(i)) P.done.add(i); });
        (Array.isArray(d.coins) ? d.coins : []).forEach((i) => { if (validIdx(i)) P.coins.add(i); });
        (Array.isArray(d.fast) ? d.fast : []).forEach((i) => { if (validIdx(i)) P.fast.add(i); });
        if (d.best && typeof d.best === "object") {
          for (const k of Object.keys(d.best)) { const v = +d.best[k]; if (validIdx(+k) && v > 0 && v <= E.TIME_LIMIT) P.best[+k] = v; }
        }
        if (d.bestBy && typeof d.bestBy === "object") {
          for (const lk of Object.keys(d.bestBy)) {
            const l = Number(lk);
            if (!validLimit(l) || l === 10 || !d.bestBy[lk] || typeof d.bestBy[lk] !== "object") continue;
            for (const k of Object.keys(d.bestBy[lk])) { const v = +d.bestBy[lk][k]; if (validIdx(+k) && v > 0 && v < 86400) setBest(l, +k, v); }
          }
        }
      } else if (Number.isInteger(d.level)) { // versão 1: {level, attempts}
        P.unlocked = clampLevel(d.level);
        for (let i = 0; i < Math.min(d.level, N); i++) P.done.add(i);
      }
      P.finished = d.finished === true && P.done.has(CORE_N - 1);
      // coerência: concluir uma fase libera a próxima (quem concluiu a 15 já tem a 16); campanha concluída = tudo liberado
      P.done.forEach((i) => { P.unlocked = Math.max(P.unlocked, Math.min(i + 1, N - 1)); });
      if (P.finished) P.unlocked = Math.min(N - 1, Math.max(P.unlocked, CORE_N)); // núcleo todo liberado + a 1ª sala do setor extra
    } catch (e) { /* sem storage ou dado inválido: começa do zero */ }
  }
  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 5, unlocked: P.unlocked, attempts: P.attempts, finished: P.finished,
        done: [...P.done], coins: [...P.coins], fast: [...P.fast], best: P.best, bestBy: P.bestBy,
      }));
    } catch (e) {}
  }
  function clearProgress() {
    P.unlocked = 0; P.done = new Set(); P.coins = new Set(); P.fast = new Set(); P.best = {}; P.bestBy = {}; P.attempts = 0; P.finished = false;
    MP.done = new Set(); MP.orig = new Set(); MP.best = {};
    try { localStorage.removeItem(SAVE_KEY); localStorage.removeItem(MKEY); } catch (e) {}
  }
  const fmt = (t) => (t === undefined || t === null ? "—" : t.toFixed(2) + " s");

  /* ---- Progresso das MISSÕES: espaço próprio no localStorage (não mexe no da campanha) ---- */
  const MP = { done: new Set(), orig: new Set(), best: {} }; // done = missões concluídas; orig = selo "Desafio original" (10 s); best[id][limite] = s
  const mById = (id) => MISSIONS.find((m) => m.id === id);
  function loadMissions() {
    MP.done = new Set(); MP.orig = new Set(); MP.best = {};
    try {
      const d = JSON.parse(localStorage.getItem(MKEY));
      if (!d) return;
      (Array.isArray(d.done) ? d.done : []).forEach((id) => { if (mById(id)) MP.done.add(id); });
      (Array.isArray(d.orig) ? d.orig : []).forEach((id) => { if (mById(id)) { MP.orig.add(id); MP.done.add(id); } });
      if (d.best && typeof d.best === "object") for (const id of Object.keys(d.best)) { if (!mById(id) || typeof d.best[id] !== "object") continue; for (const k of Object.keys(d.best[id])) { const v = +d.best[id][k]; if (v > 0 && v < 86400) (MP.best[id] = MP.best[id] || {})[k] = v; } }
    } catch (e) { /* sem storage ou dado inválido: começa do zero */ }
  }
  function saveMissions() { try { localStorage.setItem(MKEY, JSON.stringify({ v: 1, done: [...MP.done], orig: [...MP.orig], best: MP.best })); } catch (e) {} }
  const missionsUnlocked = () => P.done.has(9); // modo liberado ao concluir a fase 10
  const missionAvail = (m) => missionsUnlocked() && P.done.has(m.base - 1); // e a sala-base precisa estar concluída
  const missionBest = (m, limit) => (MP.best[m.id] || {})[String(limit)];

  /* ------------------------------------------------------------------
   * SKINS (só cosméticas: mesma área de colisão, mesma velocidade).
   * Desbloqueio por conquistas JÁ registradas (inclusive de versões antigas); nada é gasto.
   * ------------------------------------------------------------------ */
  const SKINS = [
    { id: "explorer", name: "Explorador", desc: "Capacete com visor luminoso e mochila de equipamentos.", req: null },
    { id: "astro", name: "Astronauta", desc: "Capacete redondo, traje branco com faixa laranja e painel no peito.", req: { kind: "done", n: 5, text: "Conclua 5 fases" } },
    { id: "robot", name: "Robô", desc: "Cabeça quadrada, antena com luz e olhos de LED.", req: { kind: "coins", n: 5, text: "Conquiste 5 moedas diferentes" } },
    { id: "ninja", name: "Ninja", desc: "Capuz com faixa, olhar estreito e cachecol ao vento.", req: { kind: "done", n: 10, text: "Conclua 10 fases" } },
    { id: "holo", name: "Holograma", desc: "Silhueta de luz com linhas de varredura e base flutuante.", req: { kind: "coins", n: 15, text: "Conquiste 15 moedas diferentes" } },
    { id: "gold", name: "Explorador dourado", desc: "Traje de ouro com coroa de antena e brilho nobre.", req: { kind: "done", n: 20, text: "Conclua 20 fases" } },
    // Heróis ORIGINAIS (inspirados no gênero de super-heróis, sem copiar nenhum personagem existente)
    { id: "scarlet", name: "Guardião Escarlate", desc: "Herói de capa vermelha e emblema dourado no peito.", req: { kind: "done", n: 12, text: "Conclua 12 fases" } },
    { id: "speed", name: "Velocista Faísca", desc: "Traje azul elétrico com raio no peito e aletas na cabeça.", req: { kind: "fast", n: 3, text: "Conquiste 3 medalhas de tempo (⏱)" } },
    { id: "shadow", name: "Vigilante da Penumbra", desc: "Capuz arredondado, óculos turquesa e capa escura.", req: { kind: "done", n: 15, text: "Conclua 15 fases" } },
    { id: "titan", name: "Titã de Pedra", desc: "Corpo largo de rocha com rachaduras de lava.", req: { kind: "coins", n: 10, text: "Conquiste 10 moedas diferentes" } },
    { id: "sentinel", name: "Sentinela do Escudo", desc: "Armadura turquesa e escudo hexagonal no braço.", req: { kind: "done", n: 25, text: "Conclua as 25 fases" } },
    { id: "agent", name: "Agente", desc: "Terno escuro, óculos escuros e gravata vermelha.", req: { kind: "missions", n: 6, text: "Conclua 6 missões diferentes" } },
    { id: "spectre", name: "Espectro", desc: "Capuz de névoa roxa com olhos brilhantes e cauda de fumaça.", req: { kind: "missions", n: 12, text: "Conclua as 12 missões" } },
    { id: "arcane", name: "Mago Arcano", desc: "Chapéu pontudo, capa roxa com runas e olhos brilhantes.", req: { kind: "coins", n: 20, text: "Conquiste 20 moedas diferentes" } },
  ];
  const SKIN_IDS = SKINS.map((k) => k.id);
  loadSettings(); // depois de SKIN_IDS (valida a skin salva)
  /** Progresso de uma skin: {cur, n, ok}. Conta fases/moedas DISTINTAS já registradas. */
  function skinProgress(k) {
    if (!k.req) return { cur: 1, n: 1, ok: true };
    const cur = k.req.kind === "done" ? P.done.size : k.req.kind === "fast" ? P.fast.size : k.req.kind === "missions" ? MP.done.size : P.coins.size;
    return { cur: Math.min(cur, k.req.n), n: k.req.n, ok: cur >= k.req.n };
  }
  const unlockedSkinIds = () => SKINS.filter((k) => skinProgress(k).ok).map((k) => k.id);
  /** Skin em uso: a escolhida se estiver desbloqueada; senão o Explorador (ex.: progresso apagado). */
  const equippedSkin = () => (skinProgress(SKINS.find((k) => k.id === S.skin) || SKINS[0]).ok ? S.skin : "explorer");

  /* ------------------------------------------------------------------
   * 3. ENTRADA (teclado + direcional virtual)
   * ------------------------------------------------------------------ */
  const keys = new Set();
  const touchDirs = new Map(); // pointerId -> {dx,dy}

  const KEYMAP = {
    ArrowUp: "u", KeyW: "u", ArrowDown: "d", KeyS: "d",
    ArrowLeft: "l", KeyA: "l", ArrowRight: "r", KeyD: "r",
  };
  const IN_LEVEL = ["intro", "ready", "playing", "lost", "won", "finished", "ending"];

  function releaseInput() {
    keys.clear(); touchDirs.clear();
    document.querySelectorAll(".dir.active").forEach((b) => b.classList.remove("active"));
  }

  /** Vetor de direção atual (-1..1 em cada eixo; normalizado no engine). */
  function inputVector() {
    let dx = 0, dy = 0;
    if (keys.has("l")) dx -= 1;
    if (keys.has("r")) dx += 1;
    if (keys.has("u")) dy -= 1;
    if (keys.has("d")) dy += 1;
    for (const v of touchDirs.values()) { dx += v.dx; dy += v.dy; }
    return { dx: Math.sign(dx), dy: Math.sign(dy) };
  }

  const $ = (id) => document.getElementById(id);
  const overlayEl = $("overlay"), panelEl = overlayEl.querySelector(".panel");
  const primaryBtn = $("ov-primary"), secondaryBtn = $("ov-secondary"), tertiaryBtn = $("ov-tertiary"), quaternaryBtn = $("ov-quaternary"), quinaryBtn = $("ov-quinary"), senaryBtn = $("ov-senary");
  const settingsEl = $("settings"), skipBtn = $("skip"), timeEl = $("timesel"), charEl = $("charsel"), missEl = $("missions");
  const selectEl = $("select");
  const hudLevel = $("hud-level"), hudKey = $("hud-key"), hudTimer = $("hud-timer");
  const hudCoin = $("hud-coin"), hudDash = $("hud-dash"), hintEl = $("hint");
  const hudTimerLabel = $("hud-timer-label"), hudBar = $("hud-bar"), hudBarWrap = $("hud-bar-wrap");

  // Toque/clique em qualquer lugar pula as transições de câmera.
  window.addEventListener("pointerdown", () => { if (G.state === "cam") userSkip(); if (G.winCam) finishWinCam(); }, { capture: true });
  // O áudio só é criado depois de um gesto do jogador.
  ["pointerdown", "keydown", "touchstart"].forEach((n) => window.addEventListener(n, () => Sfx.unlock(), { capture: true }));

  window.addEventListener("keydown", (e) => {
    if (document.querySelector(".ed-panel:not(.hidden)")) return; // editor / Minhas fases / Importar: teclas são deles
    if (!selectEl.classList.contains("hidden")) { // seleção de fases aberta: Espaço/Enter ativam o botão focado
      if (e.code === "Escape") showMenu();
      return;
    }
    if (!overlayEl.classList.contains("hidden") && (e.code === "Space" || e.code === "Enter") && e.target.closest && e.target.closest("button, input, select, textarea")) return; // botão focado: ativação nativa
    if (e.code === "Escape" && !overlayEl.classList.contains("hidden") && panelEl.classList.contains("howto")) { primaryBtn.click(); return; }
    if (!missEl.classList.contains("hidden")) { // lista de missões aberta
      if (e.code === "Escape") showMenu();
      return;
    }
    if (!charEl.classList.contains("hidden")) { // tela Personagem aberta
      if (e.code === "Escape") closeCharacter();
      return;
    }
    if (!timeEl.classList.contains("hidden")) { // escolha de tempo aberta: teclas são dos controles do painel
      if (e.code === "Escape") closeTimePanel();
      return;
    }
    if (!settingsEl.classList.contains("hidden")) { // configurações abertas: teclas são dos controles do painel
      if (e.code === "Escape") closeSettings();
      return;
    }
    if (G.state === "ending" && (e.code === "Space" || e.code === "Enter" || e.code === "Escape")) { e.preventDefault(); skipEnding(); return; }
    if (G.state === "cam") { // qualquer tecla pula a aproximação; Espaço/Enter/Esc só pulam (não gastam o impulso)
      userSkip();
      if (e.code === "Space" || e.code === "Enter" || e.code === "Escape") { e.preventDefault(); return; }
    }
    if (G.winCam && !e.repeat) { finishWinCam(); if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); return; } }
    if (e.code in KEYMAP) {
      e.preventDefault();
      keys.add(KEYMAP[e.code]);
    } else if (e.code === "Space") {
      e.preventDefault(); // Espaço nunca rola a página
      if (!overlayEl.classList.contains("hidden")) primaryBtn.click();
      else if (!e.repeat) tryDash();
    } else if (e.code === "KeyR") {
      if (G.state === "ready" || G.state === "playing" || G.state === "lost") retry();
    } else if (e.code === "Escape") {
      if (IN_LEVEL.includes(G.state)) { if (G.custom) { if (customBack) customBack(); } else if (G.mission >= 0) openMissions(); else openSelect(); }
    } else if (e.code === "Enter" && !overlayEl.classList.contains("hidden")) {
      e.preventDefault();
      primaryBtn.click();
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code in KEYMAP) keys.delete(KEYMAP[e.code]);
    if (e.code === "Space" && settingsEl.classList.contains("hidden") && timeEl.classList.contains("hidden") && charEl.classList.contains("hidden") && missEl.classList.contains("hidden") && selectEl.classList.contains("hidden") && overlayEl.classList.contains("hidden") && !document.querySelector(".ed-panel:not(.hidden)")) e.preventDefault(); // evita "clicar" em botão focado ao soltar Espaço
  });

  const dpad = $("dpad");
  dpad.querySelectorAll(".dir").forEach((btn) => {
    const dir = { dx: +btn.dataset.dx, dy: +btn.dataset.dy };
    const down = (e) => {
      e.preventDefault();
      enableTouchUI();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      touchDirs.set(e.pointerId, dir);
      btn.classList.add("active");
    };
    const up = (e) => {
      touchDirs.delete(e.pointerId);
      if (![...touchDirs.values()].includes(dir)) btn.classList.remove("active");
    };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // Botão de impulso: ponteiro próprio, então funciona junto com o direcional (multitoque).
  const dashBtn = $("btn-dash");
  dashBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); enableTouchUI(); tryDash(); });
  dashBtn.addEventListener("contextmenu", (e) => e.preventDefault());

  /* Controles na tela (direcional + ⚡ + reiniciar). Automático: só aparecem quando o aparelho é
   * de toque (ponteiro principal "coarse": celular/tablet). Em computador — mesmo com tela sensível
   * ao toque — ficam ocultos, a menos que você toque na tela sem ter mouse; se depois você usar o
   * teclado onde há mouse, voltam a ocultar. Em Configurações dá para forçar "Mostrar"/"Ocultar". */
  let autoTouch = window.matchMedia("(pointer: coarse)").matches;
  const hasFinePointer = () => window.matchMedia("(any-pointer: fine)").matches;
  function updateTouchUI() {
    const show = S.touch === "on" || (S.touch === "auto" && autoTouch);
    if (document.body.classList.contains("touch") !== show) { document.body.classList.toggle("touch", show); resize(); }
  }
  function enableTouchUI() { if (!hasFinePointer()) autoTouch = true; updateTouchUI(); }
  window.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" && !hasFinePointer()) { autoTouch = true; updateTouchUI(); } }, { capture: true });
  window.addEventListener("keydown", (e) => { if (e.code in KEYMAP && hasFinePointer() && autoTouch) { autoTouch = false; updateTouchUI(); } }, { capture: true });

  // Bloqueia zoom/rolagem acidentais por gesto (menos dentro dos painéis).
  ["gesturestart", "gesturechange", "gestureend"].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
  document.addEventListener("touchmove", (e) => { if (!e.target.closest || !e.target.closest("#overlay, #select, #settings, #timesel, #charsel, #missions, .ed-panel")) e.preventDefault(); }, { passive: false });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("dblclick", (e) => e.preventDefault());

  /* ------------------------------------------------------------------
   * 4. INTERFACE (HUD, overlays e seleção de fases)
   * ------------------------------------------------------------------ */
  function showOverlay({ title, text, extra, primary, secondary, tertiary, quaternary, quinary, senary, keep, kind, items, foot, focus }) {
    if (!keep) { document.querySelectorAll(".ed-panel").forEach((el) => el.classList.add("hidden")); document.body.classList.remove("editing", "ed-lists"); }
    selectEl.classList.add("hidden");
    settingsEl.classList.add("hidden");
    timeEl.classList.add("hidden");
    charEl.classList.add("hidden"); stopCharLoop(); missEl.classList.add("hidden");
    renderMenuItems(items, foot);
    $("ov-title").textContent = title;
    $("ov-text").textContent = text;
    $("ov-extra").innerHTML = extra || ""; // só recebe HTML montado aqui no código (números e textos fixos)
    panelEl.className = "panel" + (kind ? " " + kind : "");
    primaryBtn.textContent = primary.label;
    primaryBtn.onclick = primary.fn;
    if (secondary) {
      secondaryBtn.textContent = secondary.label;
      secondaryBtn.onclick = secondary.fn;
      secondaryBtn.classList.remove("hidden");
    } else { secondaryBtn.classList.add("hidden"); secondaryBtn.onclick = null; }
    if (tertiary) {
      tertiaryBtn.textContent = tertiary.label;
      tertiaryBtn.onclick = tertiary.fn;
      tertiaryBtn.classList.remove("hidden");
    } else { tertiaryBtn.classList.add("hidden"); tertiaryBtn.onclick = null; }
    if (quaternary) {
      quaternaryBtn.textContent = quaternary.label;
      quaternaryBtn.onclick = quaternary.fn;
      quaternaryBtn.classList.remove("hidden");
    } else { quaternaryBtn.classList.add("hidden"); quaternaryBtn.onclick = null; }
    if (quinary) {
      quinaryBtn.textContent = quinary.label;
      quinaryBtn.onclick = quinary.fn;
      quinaryBtn.classList.remove("hidden");
    } else { quinaryBtn.classList.add("hidden"); quinaryBtn.onclick = null; }
    if (senary) {
      senaryBtn.textContent = senary.label;
      senaryBtn.onclick = senary.fn;
      senaryBtn.classList.remove("hidden");
    } else { senaryBtn.classList.add("hidden"); senaryBtn.onclick = null; }
    overlayEl.classList.remove("hidden");
    if (focus) { const f = items ? menuEl.querySelector("button") : primaryBtn; if (f) f.focus(); } else primaryBtn.blur();
  }
  /** Menu em lista (tela inicial): cada item {label, sub, fn, locked}. Itens bloqueados mostram o requisito e continuam focáveis (aria-disabled). */
  const menuEl = $("ov-menu"), footEl = $("ov-foot"), actionsEl = $("ov-actions");
  function renderMenuItems(items, foot) {
    menuEl.textContent = "";
    menuEl.classList.toggle("hidden", !items);
    actionsEl.classList.toggle("hidden", !!items);
    footEl.classList.toggle("hidden", !foot); footEl.textContent = foot || "";
    if (!items) return;
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.className = "menu-item" + (i === 0 ? " main" : "") + (it.locked ? " locked" : "");
      const l = document.createElement("span"); l.className = "mi-l"; l.textContent = it.label; b.appendChild(l);
      if (it.sub) { const sm = document.createElement("small"); sm.textContent = it.sub; b.appendChild(sm); }
      if (it.locked) b.setAttribute("aria-disabled", "true");
      b.addEventListener("click", () => { if (it.locked) { if (it.onLocked) it.onLocked(); } else it.fn(); });
      menuEl.appendChild(b);
    });
  }
  function hideOverlay() { overlayEl.classList.add("hidden"); primaryBtn.onclick = null; secondaryBtn.onclick = null; tertiaryBtn.onclick = null; quaternaryBtn.onclick = null; quinaryBtn.onclick = null; senaryBtn.onclick = null; }

  function updateHud() {
    hudLevel.textContent = G.custom ? "TESTE" : G.mission >= 0 ? `M${G.mission + 1}/${MISSIONS.length}` : `${G.levelIdx + 1}/${N}`;
    hudKey.textContent = G.hasKey ? "✔" : "✖";
    hudKey.className = G.hasKey ? "key-on" : "key-off";
    hudCoin.textContent = G.coin ? "●" : "○";
    hudCoin.className = G.coin ? "coin-on" : "coin-off";
    hudDash.textContent = G.noDash ? "🚫" : G.dashUsed ? "usado" : "⚡";
    hudDash.className = G.noDash || G.dashUsed ? "dash-off" : "dash-on";
    dashBtn.classList.toggle("used", G.dashUsed || G.noDash);
    dashBtn.querySelector("small").textContent = G.noDash ? "Bloqueado" : G.dashUsed ? "Usado" : "Impulso";
    const unlimited = G.limit === 0;
    const left = unlimited ? Infinity : Math.max(0, G.limit - G.elapsed);
    hudTimerLabel.textContent = unlimited ? "DECORRIDO" : `TEMPO · ${G.limit}s`;
    hudTimer.textContent = (unlimited ? G.elapsed : left).toFixed(1); // sem limite: tempo decorrido; com limite: contagem regressiva
    const danger = G.state === "playing" && !unlimited && left <= 3;
    hudTimer.classList.toggle("danger", danger);
    hudBarWrap.classList.toggle("off", unlimited);
    hudBarWrap.classList.toggle("danger", danger);
    hudBar.style.width = unlimited ? "100%" : Math.max(0, Math.min(100, (left / G.limit) * 100)) + "%"; // proporcional ao limite escolhido
  }

  /* Configurações (tela inicial e pausa). `settingsBack` = o que reabrir ao voltar. */
  let settingsBack = null;
  function openSettings(back) {
    settingsBack = back;
    releaseInput();
    overlayEl.classList.add("hidden");
    selectEl.classList.add("hidden");
    timeEl.classList.add("hidden");
    charEl.classList.add("hidden"); stopCharLoop(); missEl.classList.add("hidden");
    $("set-time").textContent = `${fmtLimit(S.limit)} — alterar`;
    $("set-sound").checked = S.sound;
    $("set-volume").value = S.volume;
    $("set-volume").disabled = !S.sound;
    $("set-volume-out").textContent = S.volume + "%";
    $("set-touch").value = S.touch;
    $("set-reduce").checked = S.reduceFx || rmQuery.matches;
    $("set-reduce").disabled = rmQuery.matches; // o sistema já pede movimento reduzido
    $("set-note").textContent = rmQuery.matches ? "Seu sistema pede menos movimento: os efeitos já estão reduzidos." : "";
    settingsEl.classList.remove("hidden");
    $("set-sound").focus();
  }
  function closeSettings() {
    settingsEl.classList.add("hidden");
    saveSettings();
    const back = settingsBack; settingsBack = null;
    if (back) back();
  }
  $("set-sound").addEventListener("change", (e) => { S.sound = e.target.checked; $("set-volume").disabled = !S.sound; applySettings(); saveSettings(); Sfx.play("blip"); });
  $("set-volume").addEventListener("input", (e) => { S.volume = +e.target.value; $("set-volume-out").textContent = S.volume + "%"; applySettings(); });
  $("set-volume").addEventListener("change", () => { saveSettings(); Sfx.play("blip"); });
  $("set-touch").addEventListener("change", (e) => { S.touch = e.target.value; applySettings(); saveSettings(); });
  $("set-reduce").addEventListener("change", (e) => { S.reduceFx = e.target.checked; applySettings(); saveSettings(); });
  $("set-back").addEventListener("click", closeSettings);

  /* ------------------------------------------------------------------
   * Escolha de TEMPO POR SALA (tela própria; também na pausa e na seleção de fases).
   * Contextos: start (antes da campanha) · select · settings · pause (pede confirmação e reinicia a sala).
   * ------------------------------------------------------------------ */
  let timeCtx = null;
  const timeOptsEl = $("time-opts"), timeCustom = $("time-custom"), timeErr = $("time-err");
  let pauseTapResumes = true; // tocar fora dos botões da pausa retoma; a confirmação de reinício NÃO

  function buildTimeOptions() {
    timeOptsEl.querySelectorAll(".chip").forEach((n) => n.remove());
    const defs = LIMIT_PRESETS.map((v) => ({ v: String(v), label: `${v} s`, sub: v === 10 ? "desafio original" : "" }));
    defs.push({ v: "custom", label: "Personalizado", sub: `${LIMIT_MIN} a ${LIMIT_MAX} s` });
    defs.push({ v: "none", label: "Sem limite", sub: "mostra o tempo decorrido", wide: true });
    for (const d of defs) {
      const lab = document.createElement("label");
      lab.className = "chip" + (d.wide ? " wide" : "");
      lab.innerHTML = `<input type="radio" name="tl" value="${d.v}"><span>${d.label}${d.sub ? `<small>${d.sub}</small>` : ""}</span>`;
      timeOptsEl.appendChild(lab);
    }
    timeOptsEl.querySelectorAll("input").forEach((r) => r.addEventListener("change", () => { updateCustomRow(); setTimeErr(""); }));
  }
  const timeChoice = () => { const c = timeOptsEl.querySelector("input:checked"); return c ? c.value : ""; };
  function updateCustomRow() { $("time-custom-row").classList.toggle("hidden", timeChoice() !== "custom"); }
  function setTimeErr(msg) { timeErr.textContent = msg; timeCustom.setAttribute("aria-invalid", msg ? "true" : "false"); }

  /** Lê e valida a escolha. Personalizado: inteiro de 5 a 300. */
  function readTimeChoice() {
    const c = timeChoice();
    if (c === "none") return { ok: true, limit: 0 };
    if (c === "custom") {
      const raw = timeCustom.value.trim();
      if (timeCustom.validity && timeCustom.validity.badInput) return { ok: false, error: "Digite apenas números inteiros (de 5 a 300)." };
      if (raw === "") return { ok: false, error: "Digite quantos segundos por sala (número inteiro de 5 a 300)." };
      if (!/^\d+$/.test(raw)) return { ok: false, error: "Use só números inteiros, sem vírgula, ponto ou sinal (de 5 a 300)." };
      const n = Number(raw);
      if (n < LIMIT_MIN) return { ok: false, error: `O mínimo é ${LIMIT_MIN} segundos.` };
      if (n > LIMIT_MAX) return { ok: false, error: `O máximo é ${LIMIT_MAX} segundos.` };
      return { ok: true, limit: n, custom: true };
    }
    if (c === "") return { ok: false, error: "Escolha uma das opções." };
    return { ok: true, limit: Number(c) };
  }

  function openTimePanel(ctx) {
    timeCtx = ctx;
    releaseInput();
    overlayEl.classList.add("hidden");
    selectEl.classList.add("hidden");
    settingsEl.classList.add("hidden");
    skipBtn.classList.add("hidden");
    buildTimeOptions();
    const cur = S.limit;
    const key = cur === 0 ? "none" : LIMIT_PRESETS.includes(cur) ? String(cur) : "custom";
    timeOptsEl.querySelector(`input[value="${key}"]`).checked = true;
    timeCustom.value = key === "custom" ? String(cur) : String(S.customLimit);
    updateCustomRow();
    setTimeErr("");
    $("time-ok").textContent = ctx.mode === "start" ? "Continuar" : "Aplicar";
    $("time-pause-note").classList.toggle("hidden", ctx.mode !== "pause");
    timeEl.classList.remove("hidden");
    (timeOptsEl.querySelector("input:checked") || timeOptsEl.querySelector("input")).focus();
  }
  function hideTimePanel() { timeEl.classList.add("hidden"); }
  function closeTimePanel() { const c = timeCtx; hideTimePanel(); timeCtx = null; if (c && c.back) c.back(); }

  /** Grava a escolha (vale a partir da PRÓXIMA tentativa). */
  function applyLimit(r) {
    S.limit = r.limit;
    if (r.custom) S.customLimit = r.limit;
    S.limitChosen = true;
    saveSettings();
  }

  $("time-ok").addEventListener("click", () => {
    const r = readTimeChoice();
    if (!r.ok) { setTimeErr(r.error); (timeChoice() === "custom" ? timeCustom : timeOptsEl.querySelector("input")).focus(); return; } // inválido: não aplica nem inicia nada
    const c = timeCtx;
    if (c.mode === "pause") {
      if (r.limit === S.limit) { closeTimePanel(); return; }
      hideTimePanel();
      // Na pausa só muda depois de confirmar, porque a sala é reiniciada.
      pauseTapResumes = false;
      showOverlay({
        title: "Reiniciar a sala?",
        text: `Para usar "${fmtLimit(r.limit)}", a sala atual será reiniciada e a tentativa em andamento será descartada.\nLimite atual: ${fmtLimit(S.limit)}.`,
        primary: { label: "Reiniciar com o novo tempo", fn: () => { applyLimit(r); timeCtx = null; pauseTapResumes = true; G.prevState = null; loadLevel(G.levelIdx); } },
        secondary: { label: "Manter limite atual", fn: () => { timeCtx = null; showPauseOverlay(); } },
      });
      return;
    }
    applyLimit(r);
    hideTimePanel();
    timeCtx = null;
    if (c.onDone) c.onDone(); else if (c.back) c.back();
  });
  $("time-back").addEventListener("click", closeTimePanel);
  timeCustom.addEventListener("input", () => setTimeErr(""));
  timeCustom.addEventListener("keydown", (e) => { if (e.code === "Enter") { e.preventDefault(); $("time-ok").click(); } });
  $("sel-time").addEventListener("click", () => openTimePanel({ mode: "select", back: () => openSelect(), onDone: () => openSelect() }));
  $("set-time").addEventListener("click", () => {
    const sb = settingsBack;
    openTimePanel({ mode: G.state === "paused" ? "pause" : "settings", back: () => openSettings(sb) });
  });

  /* ------------------------------------------------------------------
   * Tela PERSONAGEM: prévia animada, requisito/progresso, equipar. Skin escolhida vale em todo o jogo.
   * ------------------------------------------------------------------ */
  const charBig = $("char-big"), charList = $("char-list");
  let charSel = "explorer", charBack = null, charRaf = 0;
  const DEMO = [["Parado", 1.6], ["Andando", 1.6], ["Impulso", 0.7], ["Coleta", 0.8], ["Vitória", 1.3]]; // ciclo da prévia (s)
  const DEMO_TOTAL = DEMO.reduce((a, d) => a + d[1], 0);
  const DEMO_POSE = { t: 0, fx: 0, fy: 1, walk: 0, phase: 0, dash: false, glow: 0, dead: -1, win: false, rm: false };
  /** Preenche DEMO_POSE para o instante `t` (s); devolve o nome da pose. */
  function demoPose(t, rm) {
    const p = DEMO_POSE; let k = t % DEMO_TOTAL, i = 0;
    while (k >= DEMO[i][1]) { k -= DEMO[i][1]; i++; }
    p.t = t; p.rm = rm; p.dash = false; p.glow = 0; p.win = false; p.walk = 0; p.fx = 0; p.fy = 1; p.dead = -1;
    if (rm) return "Parado (efeitos reduzidos)";
    if (i === 1) { p.walk = 1; p.fx = 1; p.fy = 0; p.phase = t * 9; }
    else if (i === 2) { p.dash = true; p.fx = 1; p.fy = 0; }
    else if (i === 3) p.glow = k / DEMO[3][1];
    else if (i === 4) p.win = true;
    return DEMO[i][0];
  }
  function drawPreview(c, cv, skin, name) {
    const w = cv.width, h = cv.height, k = w / 44;
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w, h);
    c.setTransform(k, 0, 0, k, w / 2, h * 0.55);
    drawCharacter(c, 0, 0, skin, DEMO_POSE);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  function charFrame(ts) {
    if (charEl.classList.contains("hidden")) { charRaf = 0; return; }
    const rm = RM(), name = demoPose(ts / 1000, rm);
    $("char-pose").textContent = "Pose: " + name;
    drawPreview(charBig.getContext("2d"), charBig, charSel);
    charList.querySelectorAll("canvas").forEach((cv) => drawPreview(cv.getContext("2d"), cv, cv.dataset.skin));
    charRaf = requestAnimationFrame(charFrame);
  }
  function stopCharLoop() { if (charRaf) { cancelAnimationFrame(charRaf); charRaf = 0; } }
  function updateCharInfo() {
    const k = SKINS.find((x) => x.id === charSel), pr = skinProgress(k), eq = equippedSkin() === k.id;
    $("char-name").textContent = k.name + (eq ? "  ✔ equipada" : "");
    $("char-desc").textContent = k.desc;
    $("char-req").textContent = pr.ok ? (k.req ? `Desbloqueada: ${k.req.text}.` : "Disponível desde o início.") : `Bloqueada — ${k.req.text}: ${pr.cur}/${pr.n}`;
    $("char-bar").style.width = Math.round((pr.cur / pr.n) * 100) + "%";
    $("char-bar-wrap").classList.toggle("off", pr.ok);
    const b = $("char-equip");
    b.disabled = !pr.ok || eq;
    b.textContent = !pr.ok ? "Bloqueada 🔒" : eq ? "Equipada ✔" : "Equipar";
    charList.querySelectorAll(".skin-btn").forEach((el) => {
      const id = el.dataset.skin, ok = skinProgress(SKINS.find((x) => x.id === id)).ok;
      el.setAttribute("aria-checked", String(id === charSel));
      el.querySelector(".badge").textContent = equippedSkin() === id ? "✔" : ok ? "" : "🔒";
    });
  }
  function openCharacter(back) {
    charBack = back;
    releaseInput();
    overlayEl.classList.add("hidden"); selectEl.classList.add("hidden"); settingsEl.classList.add("hidden"); timeEl.classList.add("hidden"); skipBtn.classList.add("hidden"); missEl.classList.add("hidden");
    charSel = equippedSkin();
    charList.textContent = "";
    SKINS.forEach((k) => {
      const ok = skinProgress(k).ok, b = document.createElement("button");
      b.className = "skin-btn" + (ok ? "" : " locked");
      b.dataset.skin = k.id; b.setAttribute("role", "radio");
      b.innerHTML = `<span class="badge"></span><canvas width="112" height="112" data-skin="${k.id}"></canvas><small>${k.name}</small>`;
      b.setAttribute("aria-label", `${k.name}${ok ? "" : " (bloqueada)"}`);
      b.addEventListener("click", () => { charSel = k.id; updateCharInfo(); });
      charList.appendChild(b);
    });
    updateCharInfo();
    charEl.classList.remove("hidden");
    if (!charRaf) charRaf = requestAnimationFrame(charFrame);
    $("char-equip").focus();
  }
  function closeCharacter() { charEl.classList.add("hidden"); stopCharLoop(); const b = charBack; charBack = null; if (b) b(); }
  $("char-equip").addEventListener("click", () => {
    if (!skinProgress(SKINS.find((x) => x.id === charSel)).ok) return;
    S.skin = charSel; saveSettings(); updateCharInfo();
  });
  $("char-back").addEventListener("click", closeCharacter);
  $("sel-char").addEventListener("click", () => openCharacter(() => openSelect()));

  /* ------------------------------------------------------------------
   * MISSÕES: lista (filtro por tipo), briefing, jogo e resultado. Dados em missions.js; progresso em MP.
   * ------------------------------------------------------------------ */
  let misFilter = "all";
  function missionReq(m) {
    if (!missionsUnlocked()) return "Conclua a fase 10 da campanha para liberar as missões.";
    if (!P.done.has(m.base - 1)) return `Conclua a sala ${m.base} (${LEVELS[m.base - 1].name}) da campanha.`;
    return "";
  }
  function openMissions(filter) {
    if (typeof filter === "string") misFilter = filter; // (chamado por botões também com o evento: ignora)
    releaseInput();
    G.winCam = null;
    G.state = "missions";
    hideOverlay(); settingsEl.classList.add("hidden"); timeEl.classList.add("hidden"); charEl.classList.add("hidden"); stopCharLoop(); selectEl.classList.add("hidden"); skipBtn.classList.add("hidden");
    $("mis-info").textContent = missionsUnlocked()
      ? `Concluídas: ${MP.done.size}/${MISSIONS.length} · Selos "Desafio original": ${MP.orig.size}/${MISSIONS.length} · Tempo por sala: ${fmtLimit(S.limit)}`
      : "Modo bloqueado: conclua a fase 10 da campanha para liberar.";
    const fl = $("mis-filter");
    fl.textContent = "";
    [["all", "Todas"], ...Object.keys(MGOALS).map((k) => [k, MGOALS[k].label])].forEach(([k, label]) => {
      const b = document.createElement("button");
      b.textContent = label; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(misFilter === k));
      b.addEventListener("click", () => openMissions(k));
      fl.appendChild(b);
    });
    const grid = $("mis-grid");
    grid.textContent = "";
    MISSIONS.forEach((m, mi) => {
      if (misFilter !== "all" && m.goal !== misFilter) return;
      const g = MGOALS[m.goal], req = missionReq(m), done = MP.done.has(m.id), orig = MP.orig.has(m.id);
      const b = document.createElement("button");
      b.className = "mis-card " + (req ? "locked" : done ? "done" : "avail");
      b.innerHTML = `<b>${m.name}</b><small>${g.icon} ${g.label} · Sala ${m.base} (${LEVELS[m.base - 1].name})</small>` +
        `<span class="st">${req ? "🔒 Bloqueada — " + req : done ? "✔ Concluída" : "▶ Disponível"}${orig ? ' <span class="seal">🏅 Desafio original</span>' : ""}</span>`;
      b.setAttribute("aria-label", `${m.name}, ${g.label}, sala ${m.base}. ${req ? "Bloqueada: " + req : done ? "Concluída" : "Disponível"}${orig ? ", com selo Desafio original" : ""}`);
      b.addEventListener("click", () => { if (req) $("mis-info").textContent = "🔒 " + req; else openBrief(mi); });
      grid.appendChild(b);
    });
    missEl.classList.remove("hidden");
    updateHud();
  }
  $("mis-back").addEventListener("click", showMenu);

  /** Antes de jogar: objetivo, regra especial, limite de tempo escolhido e botão Começar. */
  function openBrief(mi) {
    const m = MISSIONS[mi], g = MGOALS[m.goal];
    G.state = "brief";
    const best = missionBest(m, S.limit);
    showOverlay({
      title: m.name,
      text: `${g.icon} Objetivo: ${m.desc}\nRegra especial: ${g.rule}\nSala-base: ${m.base} (${LEVELS[m.base - 1].name})\nTempo por sala: ${fmtLimit(S.limit)}` +
        (S.limit > 0 && S.limit < 10 ? "\n⚠ Menos de 10 s é um desafio extra: pode ser impossível." : "") +
        (S.limit === 10 ? "" : "\nO selo \"Desafio original\" só vale em 10 s.") + `\nMelhor (${fmtMode(S.limit)}): ${fmt(best)}`,
      primary: { label: "Começar", fn: () => startMission(mi) },
      secondary: { label: "Voltar", fn: () => openMissions() },
      tertiary: { label: "Tempo por sala ⏱", fn: () => openTimePanel({ mode: "select", back: () => openBrief(mi), onDone: () => openBrief(mi) }) },
    });
  }
  function startMission(mi) {
    G.mission = mi; G.custom = false;
    loadLevel(N + mi);
    G.fade = RM() ? 0 : 0.35;
    beginAttempt();
  }
  const nextMission = (mi) => { for (let k = mi + 1; k < MISSIONS.length; k++) if (!missionReq(MISSIONS[k])) return k; return -1; };

  /** Vitória de missão: objetivo cumprido, selos novos, repetir / próxima / lista. Não toca na campanha. */
  function winMission() {
    const mi = G.mission, m = MISSIONS[mi], g = MGOALS[m.goal], limit = G.limit;
    G.state = "won"; G.dash = null; G.vel = { x: 0, y: 0 };
    const time = Math.round(G.elapsed * 100) / 100, prev = missionBest(m, limit);
    const newDone = !MP.done.has(m.id), newOrig = limit === 10 && !MP.orig.has(m.id);
    const isRecord = prev !== undefined && time < prev, first = prev === undefined;
    const skinsBefore = unlockedSkinIds();
    MP.done.add(m.id);
    if (limit === 10) MP.orig.add(m.id);
    if (first || time < prev) (MP.best[m.id] = MP.best[m.id] || {})[String(limit)] = time;
    saveMissions();
    const newSkins = unlockedSkinIds().filter((id) => !skinsBefore.includes(id)).map((id) => SKINS.find((k) => k.id === id).name);
    Sfx.play("win");
    const lv = lvAt(G.levelIdx);
    burst(lv.door.x, lv.door.y, "#39ff88", 40, 280);
    const mode = fmtMode(limit);
    const extra =
      `<div>✔ Objetivo cumprido: ${g.short}</div><div class="times">Tempo: <b>${fmt(time)}</b> · Melhor (${mode}): <b>${fmt(missionBest(m, limit))}</b></div>` +
      (isRecord ? `<div class="record">★ Novo recorde (${mode})! Antes: ${fmt(prev)}</div>` : first ? `<div>Primeiro tempo registrado (${mode}).</div>` : "") +
      `<div class="medals"><span class="medal on${newDone ? " new" : ""}">✔ Missão concluída${newDone ? " ★ novo" : ""}</span>` +
      `<span class="medal${MP.orig.has(m.id) ? " on" : ""}${newOrig ? " new" : ""}">🏅 Desafio original${newOrig ? " ★ novo" : limit === 10 ? "" : " (só em 10 s)"}</span></div>` +
      (newSkins.length ? `<div class="record">★ Skin desbloqueada: ${newSkins.join(", ")} (veja em Personagem)</div>` : "");
    const nx = nextMission(mi);
    const showResult = () => {
      if (G.state !== "won") return;
      showOverlay({
        title: "Missão cumprida!",
        text: m.name,
        extra,
        primary: nx >= 0 ? { label: "Próxima missão", fn: () => openBrief(nx) } : { label: "Repetir", fn: () => startMission(mi) },
        secondary: nx >= 0 ? { label: "Repetir", fn: () => startMission(mi) } : { label: "Voltar à lista", fn: () => openMissions() },
        tertiary: nx >= 0 ? { label: "Voltar à lista", fn: () => openMissions() } : null,
        kind: "good",
      });
    };
    if (RM()) showResult(); else G.winCam = { t: 0, dur: 1.0, show: showResult };
    updateHud();
  }

  /** Seleção de fases agrupada por setor. opts.missing: destaca fases com medalha pendente. */
  function openSelect(opts) {
    const missingMode = !!(opts && opts.missing === true);
    G.winCam = null;
    releaseInput();
    G.state = "select";
    hideOverlay();
    settingsEl.classList.add("hidden");
    timeEl.classList.add("hidden");
    charEl.classList.add("hidden"); stopCharLoop(); missEl.classList.add("hidden");
    skipBtn.classList.add("hidden");
    const grid = $("level-grid");
    grid.textContent = "";
    const nextIdx = P.unlocked;
    const on = (v) => (v ? " on" : "");
    let pending = 0;
    SECTORS.forEach((sc, si) => {
      const wrap = document.createElement("section");
      wrap.className = "sector";
      wrap.style.setProperty("--sec", sc.theme.accent);
      const done5 = LEVELS.slice(sc.first, sc.last + 1).filter((_, k) => P.done.has(sc.first + k)).length;
      wrap.innerHTML = `<div class="sector-head"><b>${si + 1}. ${sc.name}</b><small>Salas ${sc.first + 1}–${sc.last + 1} · ${done5}/${sc.last - sc.first + 1}</small></div><div class="grid"></div>`;
      const row = wrap.querySelector(".grid");
      for (let i = sc.first; i <= sc.last; i++) {
        const lv = LEVELS[i];
        const b = document.createElement("button");
        b.className = "lvl";
        const locked = i > P.unlocked, done = P.done.has(i);
        const coin = P.coins.has(i), fast = P.fast.has(i), best = bestFor(S.limit, i);
        if (done) b.classList.add("done");
        else if (!locked && i === nextIdx) b.classList.add("next");
        if (missingMode && !locked && !(done && coin && fast)) { b.classList.add("todo"); pending++; }
        b.disabled = locked;
        b.title = locked ? `Fase ${i + 1} bloqueada` : `Fase ${i + 1}: ${lv.name} · melhor (${fmtMode(S.limit)}) ${fmt(best)} · meta ⏱ ${lv.target} s (só no modo 10 s)`;
        b.setAttribute("aria-label", locked ? b.title : `${b.title} · ${done ? "concluída" : "não concluída"}, moeda ${coin ? "conquistada" : "pendente"}, medalha de tempo ${fast ? "conquistada" : "pendente"}`);
        b.innerHTML = locked
          ? `<b>${i + 1}</b><span class="mds">🔒</span>`
          : `<b>${i + 1}</b><span class="mds"><span class="md${on(done)}">✔</span><span class="md coin${on(coin)}">●</span><span class="md${on(fast)}">⏱</span></span><small class="bt">${best === undefined ? "—" : best.toFixed(2) + " s"}</small>`;
        b.addEventListener("click", () => { selectEl.classList.add("hidden"); enterLevel(i); });
        row.appendChild(b);
      }
      grid.appendChild(wrap);
    });
    $("sel-time").textContent = `⏱ Tempo por sala: ${fmtLimit(S.limit)} — alterar`;
    $("sel-info").textContent =
      (S.limit === 10 ? "" : `Tempos mostrados: ${fmtLimit(S.limit)} · ⏱ só no modo 10 s · `) + `Medalhas ${P.done.size + P.coins.size + P.fast.size}/${N * 3} · Moedas ${P.coins.size}/${N}` +
      (missingMode ? ` · Fases com medalha pendente (borda tracejada): ${pending}` : "");
    selectEl.classList.remove("hidden");
    updateHud();
  }
  $("sel-back").addEventListener("click", showMenu);
  $("btn-levels").addEventListener("click", (e) => { e.currentTarget.blur(); if (IN_LEVEL.includes(G.state)) { if (G.custom) { if (customBack) customBack(); } else if (G.mission >= 0) openMissions(); else openSelect(); } });

  /* ------------------------------------------------------------------
   * 5. FLUXO DO JOGO
   * ------------------------------------------------------------------ */
  function showMenu() {
    releaseInput();
    G.state = "menu";
    selectEl.classList.add("hidden");
    loadProgress();
    loadMissions();
    const progress = hasProgress();
    const allDone = P.done.size >= N;
    const startCampaign = () => {
      const go = () => (allDone ? openSelect() : progress ? enterLevel(Math.min(P.unlocked, N - 1)) : enterLevel(0));
      if (!S.limitChosen) openTimePanel({ mode: "start", back: showMenuKeep, onDone: go }); else go();
    };
    const misOk = missionsUnlocked();
    showOverlay({
      title: "DEZ SEGUNDOS PARA FUGIR",
      text: "Pegue a chave 🗝 e alcance a porta antes que o tempo acabe.",
      focus: true,
      foot: "Versão 1.0",
      items: [
        { label: allDone ? "Campanha concluída 🏆" : progress ? "Continuar campanha" : "Nova campanha", sub: allDone ? "Escolha uma fase para rejogar" : progress ? `Fase ${Math.min(P.unlocked, N - 1) + 1} · ${P.done.size}/${N} concluídas` : "Comece pela fase 1", fn: startCampaign },
        { label: "Seleção de fases", sub: progress ? `Moedas ${P.coins.size}/${N}` : "Fases 1–" + N, fn: () => openSelect() },
        { label: misOk ? "Missões 🎯" : "Missões 🔒", sub: misOk ? `${MP.done.size}/${MISSIONS.length} concluídas` : "Conclua a fase 10 da campanha", locked: !misOk,
          onLocked: () => { const sb = menuEl.querySelectorAll(".menu-item")[2].querySelector("small"); sb.textContent = "🔒 Falta concluir a fase 10 da campanha."; }, fn: () => openMissions() },
        { label: "Tempo por sala ⏱", sub: fmtLimit(S.limit), fn: () => openTimePanel({ mode: "select", back: showMenuKeep, onDone: showMenuKeep }) },
        { label: "Online · 3 jogadores 🌐", sub: "Cooperativo: ajudem-se a fugir", fn: () => { if (window.OnlineCoop) window.OnlineCoop.open(); } },
        { label: "Criar fase ✏", sub: "Editor e Minhas fases", fn: () => { if (window.Editor) window.Editor.openHub(); } },
        { label: "Personagem 🧑‍🚀", sub: "Skins", fn: () => openCharacter(showMenuKeep) },
        { label: "Configurações ⚙", sub: "Som, controles, backup", fn: () => openSettings(showMenuKeep) },
        { label: "Como jogar ?", sub: "Controles e regras", fn: showHowTo },
      ],
      primary: { label: "Continuar", fn: startCampaign },
    });
    G.mission = -1; G.custom = false;
    loadLevel(Math.min(P.unlocked, N - 1), true);
  }

  const showMenuKeep = () => showMenu();

  /** Tela curta de ajuda (menu e pausa). */
  function showHowTo(back) {
    const backFn = typeof back === "function" ? back : showMenuKeep;
    showOverlay({
      title: "Como jogar",
      kind: "howto",
      focus: true,
      text: "",
      extra:
        "<ul class='howto'>" +
        "<li><b>Objetivo:</b> pegue a chave 🗝 e entre na porta. Espinhos, serras, lasers e inimigos eliminam você.</li>" +
        "<li><b>Mover:</b> WASD ou setas. No celular: direcional na tela.</li>" +
        "<li><b>Impulso ⚡:</b> Espaço (ou botão ⚡), uma vez por tentativa, na última direção.</li>" +
        "<li><b>Tempo por sala:</b> começa quando você se mexe. 10 s é o desafio original; escolha outro tempo ou “sem limite” no menu.</li>" +
        "<li><b>Reiniciar:</b> R ou ↻. <b>Voltar:</b> Esc ou ☰. Sair da aba pausa o jogo.</li>" +
        "<li><b>Opcionais:</b> moeda ● e medalha ⏱ (só no modo 10 s) nas fases; Missões com objetivos especiais; Criar fase para montar as suas.</li>" +
        "</ul>",
      primary: { label: "Voltar", fn: backFn },
    });
  }

  /** Abre uma fase vinda do menu/seleção/“próxima”: mostra a instrução, se houver. */
  function enterLevel(idx) {
    G.mission = -1; // campanha
    G.custom = false;
    loadLevel(idx);
    G.fade = RM() ? 0 : 0.35; // transição breve (escurece→revela; sem flash); desligada com efeitos reduzidos
    const intro = LEVELS[idx].intro;
    if (intro) {
      G.state = "intro";
      showOverlay({
        title: intro.title,
        text: intro.text,
        primary: { label: "Entendi", fn: () => { if (G.state === "intro") beginAttempt(); } },
      });
    } else beginAttempt();
  }

  /** Começa a sala: breve aproximação no personagem que volta ao enquadramento completo ANTES de liberar o controle.
   * O cronômetro só corre no 1º movimento, então nada disso gasta tempo. Pulável (toque/tecla); sem aproximação com efeitos reduzidos. */
  function beginAttempt() {
    hideOverlay();
    if (RM()) { G.state = "ready"; return; }
    G.state = "cam"; G.camT = 0;
  }
  let skipGuardAt = -1e9;
  function skipCam() { if (G.state === "cam") G.state = "ready"; }
  /** Pulo feito pelo jogador: o mesmo toque/tecla não aciona o impulso (por 150 ms). */
  function userSkip() { skipGuardAt = performance.now(); skipCam(); }
  function finishWinCam() { const w = G.winCam; G.winCam = null; if (w) w.show(); }
  /** Zoom atual da câmera (1 = sala inteira). Fora das transições é sempre 1: nada jogável fica cortado. */
  function camZoom() {
    const st = G.state === "paused" ? G.prevState : G.state;
    if (st === "cam") { const k = Math.min(1, G.camT / G.camDur); return 1 + 1.1 * (1 - k * k * (3 - 2 * k)); }
    if (G.winCam) return 1 + 0.8 * Math.sin((Math.PI * G.winCam.t) / G.winCam.dur);
    return 1;
  }

  /** Restaura TUDO da tentativa: personagem, chave, interruptores/passagens, portais, ciclos. */
  function loadLevel(idx, quiet) {
    G.levelIdx = idx;
    const lv = lvAt(idx);
    G.pos = { x: lv.start.x, y: lv.start.y };
    G.noDash = !!lv.noDash; // restrição de missão: restaurada (ou removida) a cada tentativa a partir dos dados da sala
    G.frag = 0; // fragmentos recomeçam após derrota/reinício
    G.stillT = 0; G.anchor.x = lv.start.x; G.anchor.y = lv.start.y;
    G.elapsed = 0; // serras e lasers dependem deste tempo -> voltam ao ciclo inicial
    G.limit = S.limit; // o limite vale para esta tentativa inteira; muda só ao reiniciar a sala
    G.winCam = null;
    G.lastTick = null;
    G.hasKey = false;
    G.coin = false; // moeda perdida em derrota volta na próxima tentativa
    G.vel = { x: 0, y: 0 }; // sem deslizar de tentativa anterior
    G.faceV.x = lv.dashDir.dx; G.faceV.y = lv.dashDir.dy; G.walk = 0; G.phase = 0; G.glowAt = -9; G.deadAt = -9; // visual: nada sobra da tentativa anterior
    G.dash = null;
    G.dashUsed = false; // impulso restaurado a cada tentativa
    G.lastDir = { dx: lv.dashDir.dx, dy: lv.dashDir.dy };
    G.trail = [];
    G.rt = E.newRuntime(lv);
    G.gateAge = lv.gates.map(() => 0);
    G.shake = 0;
    G.flash = 0;
    particles = [];
    rings = [];
    const sc = sectorOf(G.mission >= 0 ? MISSIONS[G.mission].base - 1 : idx);
    hintEl.textContent = G.custom
      ? `Teste do editor · ${lv.name} — nada deste teste vale moedas, medalhas, skins ou recordes · ${limitWord(G.limit)}`
      : G.mission >= 0
      ? `Missão ${G.mission + 1}/${MISSIONS.length} · ${lv.name} — ${MGOALS[lv.mission.goal].short} · ${limitWord(G.limit)}`
      : `${sc.name} · ${lv.name} — ${lv.hint} · ${limitWord(G.limit)}` + (G.limit === 10 ? ` · meta ⏱ ${lv.target} s` : " · ⏱ só no modo 10 s");
    canvas.style.boxShadow = `0 0 0 2px ${sc.theme.accent}55, 0 0 30px ${sc.theme.accent}22`;
    skipBtn.classList.add("hidden");
    G.endT = 0;
    if (!quiet) { G.state = "ready"; hideOverlay(); selectEl.classList.add("hidden"); }
    updateHud();
  }

  function retry() { loadLevel(G.levelIdx); }

  function lose(reason) {
    if (G.state !== "playing") return;
    G.state = "lost";
    G.deadAt = G.time;
    G.dash = null;
    G.vel = { x: 0, y: 0 }; // sem deslizar depois da derrota
    Sfx.play("lose");
    if (G.mission < 0 && !G.custom) { P.attempts++; saveProgress(); } // missões e testes do editor não mexem nos dados da campanha
    if (!RM()) { G.shake = 0.45; G.flash = 1; }
    burst(G.pos.x, G.pos.y, "#ff2d55", 36, 260);
    burst(G.pos.x, G.pos.y, "#ffffff", 12, 160);
    const msg = {
      time: `O tempo (${G.limit} s) acabou!`,
      spike: "Você tocou em espinhos!",
      mover: "Você foi atingido por uma serra!",
      laser: "Você foi atingido por um laser!",
      drone: "Você foi pego por um drone de patrulha!",
      sentinel: "A sentinela viu você por tempo demais!",
      chaser: "O perseguidor pegou você!",
      woke: "Missão de furtividade: você acordou o perseguidor (entrou no raio dele com visão livre)!",
      still: "Missão \"Sem parar\": você ficou parado por mais de 1 segundo seguido.",
    }[reason];
    updateHud();
    const mm = G.mission >= 0;
    if (G.custom) {
      showOverlay({ title: "Você perdeu", text: `${msg}\nÉ só um teste: nada é registrado.`, primary: { label: "Tentar novamente", fn: retry }, secondary: { label: "Voltar ao editor", fn: () => customBack && customBack() }, kind: "bad" });
      return;
    }
    showOverlay({
      title: "Você perdeu",
      text: mm ? `${msg}\nObjetivo: ${MGOALS[lvAt(G.levelIdx).mission.goal].short}` : `${msg}\nTentativas até agora: ${P.attempts}`,
      primary: { label: "Tentar novamente", fn: retry },
      secondary: mm ? { label: "Missões", fn: () => openMissions() } : { label: "Fases", fn: openSelect },
      kind: "bad",
    });
  }

  /** Medalhas (cada uma é independente e pode vir em tentativas diferentes). */
  function medalsHtml(idx, flags, limit) {
    const target = LEVELS[idx].target;
    const items = [
      ["✔ Concluída", P.done.has(idx), flags.done],
      ["● Moeda", P.coins.has(idx), flags.coin],
      [limit === 10 ? `⏱ ≤ ${target} s` : `⏱ ≤ ${target} s (só no modo 10 s)`, P.fast.has(idx), flags.fast],
    ];
    return `<div class="medals">${items.map(([t, on, isNew]) => `<span class="medal${on ? " on" : ""}${isNew ? " new" : ""}">${t}${isNew ? " ★" : ""}</span>`).join("")}</div>`;
  }

  /** Vitória em teste do editor: nenhum progresso, moeda, medalha, skin ou recorde é tocado. */
  function winCustom() {
    G.state = "won"; G.dash = null; G.vel = { x: 0, y: 0 };
    const time = Math.round(G.elapsed * 100) / 100;
    Sfx.play("win");
    if (customWin) { try { customWin({ limit: G.limit, time }); } catch (e) { /* o editor registra a conclusão; falha dele não trava o teste */ } }
    burst(customLv.door.x, customLv.door.y, "#39ff88", 40, 280);
    const showResult = () => {
      if (G.state !== "won") return;
      showOverlay({
        title: "Teste concluído!",
        text: `Você completou "${customLv.name}" em ${fmt(time)} (limite: ${fmtLimit(G.limit)}).\nÉ só um teste: nada é registrado nos outros modos.`,
        primary: { label: "Voltar ao editor", fn: () => customBack && customBack() },
        secondary: { label: "Testar de novo", fn: retry },
        kind: "good",
      });
    };
    if (RM()) showResult(); else G.winCam = { t: 0, dur: 1.0, show: showResult };
    updateHud();
  }

  function win() {
    if (G.state !== "playing") return;
    if (G.custom) return winCustom();
    if (G.mission >= 0) return winMission();
    const idx = G.levelIdx, lv = LEVELS[idx];
    G.state = "won";
    G.dash = null;
    P.attempts++;

    // Resultado da tentativa: tempo em centésimos, comparado ao recorde salvo.
    const time = Math.round(G.elapsed * 100) / 100;
    const limit = G.limit;
    const prev = bestFor(limit, idx);
    const isRecord = prev !== undefined && time < prev; // só "recorde" com melhora real
    const first = prev === undefined;
    if (first || time < prev) setBest(limit, idx, time);
    const flags = {
      done: !P.done.has(idx),
      coin: G.coin && !P.coins.has(idx), // moeda só vale ao vencer na mesma tentativa
      fast: limit === 10 && time <= lv.target && !P.fast.has(idx), // medalha de tempo só no modo original
    };
    const skinsBefore = unlockedSkinIds();
    P.done.add(idx);
    if (G.coin) P.coins.add(idx);
    if (limit === 10 && time <= lv.target) P.fast.add(idx);
    P.unlocked = Math.max(P.unlocked, Math.min(idx + 1, N - 1));
    saveProgress();

    G.vel = { x: 0, y: 0 };
    Sfx.play("win");
    burst(lv.door.x, lv.door.y, "#39ff88", 50, 300);
    burst(lv.door.x, lv.door.y, "#19f0ff", 30, 220);
    const mode = fmtMode(limit);
    const newSkins = unlockedSkinIds().filter((id) => !skinsBefore.includes(id)).map((id) => SKINS.find((k) => k.id === id).name);
    const skinLine = newSkins.length ? `<div class="record">★ Skin desbloqueada: ${newSkins.join(", ")} (veja em Personagem)</div>` : "";
    const recordLine = isRecord ? `<div class="record">★ Novo recorde (${mode})! Antes: ${fmt(prev)}</div>` : first ? `<div>Primeiro tempo registrado (${mode}).</div>` : "";
    const extra =
      `<div class="times">Modo de tempo: <b>${fmtLimit(limit)}</b></div><div class="times">Tempo: <b>${fmt(time)}</b> · Melhor (${mode}): <b>${fmt(bestFor(limit, idx))}</b></div>${recordLine}` +
      skinLine + (G.coin ? "<div>Moeda coletada!</div>" : lv.coin ? "<div>Moeda não coletada nesta tentativa.</div>" : "") +
      medalsHtml(idx, flags, limit);
    if (idx === CORE_N - 1) {
      // Fim do núcleo da campanha: sequência de fuga (pode ser pulada) e depois o resumo; libera o setor extra.
      P.finished = true;
      P.unlocked = Math.min(N - 1, Math.max(P.unlocked, CORE_N));
      saveProgress();
      G.endExtra = extra;
      startEnding();
    } else {
      // Resultado após uma breve aproximação da câmera no personagem (volta ao enquadramento completo antes de liberar os botões).
      // Pulável com toque/tecla; sem aproximação com efeitos reduzidos. O tempo da tentativa já está fechado: nada é contado aqui.
      const showResult = () => {
        if (G.state !== "won") return;
        if (idx === N - 1) {
          showOverlay({
            title: "Setor extra concluído!",
            text: `Você venceu todas as ${N} salas.\nTentativas até agora: ${P.attempts}`,
            extra,
            primary: { label: "Seleção de fases", fn: () => openSelect() },
            secondary: { label: "Tentar de novo", fn: () => loadLevel(idx) },
            kind: "good",
          });
        } else {
          showOverlay({
            title: "Fase concluída!",
            text: `Tentativas até agora: ${P.attempts}`,
            extra,
            primary: { label: "Próxima fase", fn: () => enterLevel(idx + 1) },
            secondary: { label: "Tentar de novo", fn: () => loadLevel(idx) },
            kind: "good",
          });
        }
      };
      if (RM()) showResult(); else G.winCam = { t: 0, dur: 1.0, show: showResult };
    }
    updateHud();
  }

  /* ---- Final da campanha ---- */
  const END_DUR = 4.6; // segundos da sequência de fuga
  function startEnding() {
    G.state = "ending";
    G.endT = 0;
    G.endFrom = { x: G.pos.x, y: G.pos.y };
    hideOverlay();
    if (RM()) { G.endT = END_DUR - 1.2; } // efeitos reduzidos: versão curta, sem movimento
    skipBtn.classList.remove("hidden");
    updateHud();
  }
  function skipEnding() { if (G.state === "ending") finishEnding(); }
  function finishEnding() {
    skipBtn.classList.add("hidden");
    G.state = "finished";
    // resumo do NÚCLEO da campanha (salas 1-20); o setor extra não entra nesta conta
    const inCore = (i) => i < CORE_N;
    const cDone = [...P.done].filter(inCore).length, cCoins = [...P.coins].filter(inCore).length, cFast = [...P.fast].filter(inCore).length;
    const medals = cDone + cCoins + cFast;
    showOverlay({
      title: "VOCÊ ESCAPOU!",
      text: `Fases concluídas: ${cDone}/${CORE_N}\nMoedas conquistadas: ${cCoins}/${CORE_N}\nMedalhas obtidas: ${medals}/${CORE_N * 3}\nTotal de tentativas: ${P.attempts}` + (medals === CORE_N * 3 ? "\nTodas as medalhas — perfeito!" : "") + (N > CORE_N ? "\nSetores extras liberados: " + window.SECTORS.filter((sc) => sc.extra).map((sc) => `${sc.name.replace(" (extra)", "")} (salas ${sc.first + 1}–${sc.last + 1})`).join(" e ") + "." : ""),
      extra: G.endExtra || "",
      primary: { label: "Buscar medalhas", fn: () => openSelect({ missing: true }) },
      secondary: { label: "Seleção de fases", fn: () => openSelect() },
      kind: "good",
    });
  }
  skipBtn.addEventListener("click", (e) => { e.currentTarget.blur(); skipEnding(); });

  /** Pausa ao sair da aba/app; exige toque ou clique para voltar. Nada se move enquanto pausado. */
  function pauseIfNeeded() {
    releaseInput(); // perdeu o foco: nenhum comando fica "preso"
    if (G.state !== "ready" && G.state !== "playing" && G.state !== "ending" && G.state !== "cam") return;
    G.prevState = G.state;
    G.state = "paused";
    showPauseOverlay();
  }
  function showPauseOverlay() {
    skipBtn.classList.add("hidden");
    pauseTapResumes = true;
    showOverlay({
      title: "Pausado",
      text: `Toque ou clique para continuar. Tempo por sala: ${fmtLimit(G.limit)}.`,
      primary: { label: "Continuar", fn: resume },
      secondary: { label: "Configurações ⚙", fn: () => openSettings(showPauseOverlay) },
      tertiary: { label: "Tempo por sala ⏱", fn: () => openTimePanel({ mode: "pause", back: showPauseOverlay }) },
      quaternary: { label: "Como jogar ?", fn: () => { pauseTapResumes = false; showHowTo(() => { pauseTapResumes = true; showPauseOverlay(); }); } },
    });
  }
  function resume() {
    if (G.state !== "paused") return;
    G.state = G.prevState;
    hideOverlay();
    if (G.state === "ending") skipBtn.classList.remove("hidden");
    lastTs = 0; // evita um "salto" de tempo ao voltar
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) pauseIfNeeded(); });
  window.addEventListener("pagehide", pauseIfNeeded);
  window.addEventListener("blur", pauseIfNeeded);
  overlayEl.addEventListener("pointerdown", (e) => { if (G.state === "paused" && pauseTapResumes && !e.target.closest("#ov-secondary, #ov-tertiary, #ov-quaternary")) resume(); });

  $("btn-retry-hud").addEventListener("click", (e) => { e.currentTarget.blur(); if (["ready", "playing", "lost"].includes(G.state)) retry(); });
  $("btn-retry-touch").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (["ready", "playing", "lost"].includes(G.state)) retry();
  });

  /* ------------------------------------------------------------------
   * 6. ATUALIZAÇÃO (um passo por quadro, usando dt real)
   * ------------------------------------------------------------------ */
  function update(dt) {
    if (G.state === "paused") return; // pausado: nada avança (relógio, serras, lasers, animações)
    G.time += dt;
    G.fade = Math.max(0, G.fade - dt);
    if (G.state !== "playing") G.walk += (0 - G.walk) * Math.min(1, dt * 14); // parado: pernas descansam
    updateParticles(dt);
    G.shake = Math.max(0, G.shake - dt);
    G.flash = Math.max(0, G.flash - dt * 2.5);

    for (const t of G.trail) t.age += dt;
    G.trail = G.trail.filter((t) => t.age < 0.25);

    if (G.state === "cam") { G.camT += dt; if (G.camT >= G.camDur) G.state = "ready"; return; } // aproximação: sem contar tempo
    if (G.winCam) { G.winCam.t += dt; if (G.winCam.t >= G.winCam.dur) finishWinCam(); return; }
    if (G.state === "ending") { // sequência final (congela na pausa, pois update não roda pausado)
      G.endT += dt;
      const dd = LEVELS[G.levelIdx].door, k = Math.min(1, G.endT / 1.4), e = k * k * (3 - 2 * k);
      G.pos = RM() ? { x: dd.x, y: dd.y } : { x: G.endFrom.x + (dd.x - G.endFrom.x) * e, y: G.endFrom.y + (dd.y - G.endFrom.y) * e };
      if (G.endT >= END_DUR) finishEnding();
      return;
    }
    if (G.state !== "ready" && G.state !== "playing") return;
    const lv = lvAt(G.levelIdx);
    const v = inputVector();
    const moving = v.dx !== 0 || v.dy !== 0;

    // Cronômetro: começa no primeiro movimento da tentativa (andar ou usar o impulso).
    if (G.state === "ready") {
      if (!moving && !G.dash) return;
      G.state = "playing";
    }
    const t0 = G.elapsed;
    const px0 = G.pos.x, py0 = G.pos.y;
    G.elapsed += dt;
    for (let i = 0; i < G.gateAge.length; i++) if (G.rt.open[i]) G.gateAge[i] += dt;

    // Movimento normal (E.stepPlayer: velocidade, gelo e esteira) ou impulso (E.advance, ignora pisos);
    // os dois checam colisões e perigos em micro-passos, então nada atravessa nada entre quadros.
    let res = null;
    if (G.dash) {
      const d = G.dash;
      const dist = Math.min(d.left, E.DASH_SPEED * dt); // mesma distância total em qualquer taxa de quadros
      if (d.dx) G.face = d.dx;
      G.faceV.x = d.dx; G.faceV.y = d.dy;
      res = E.advance(lv, G, d.dx, d.dy, dist, t0, dt, { stopOnTeleport: true });
      d.left -= dist;
      if (!RM()) G.trail.push({ x: G.pos.x, y: G.pos.y, age: 0 });
      if (d.left <= 1e-6 || res.teleports.length) G.dash = null;
    } else {
      if (moving) { G.lastDir = { dx: v.dx, dy: v.dy }; if (v.dx) G.face = v.dx; G.faceV.x = v.dx; G.faceV.y = v.dy; }
      res = E.stepPlayer(lv, G, v.dx, v.dy, dt, t0); // parado também: continua deslizando no gelo / sendo levado pela esteira e lasers/serras ainda acertam
    }

    // animação de caminhada: intensidade pela velocidade real e passos pela distância andada (sem dar saltos em impulso/portal)
    if (!G.dash && !res.teleports.length) {
      const mv = Math.hypot(G.pos.x - px0, G.pos.y - py0);
      if (mv < 40) { G.walk += (Math.min(1, mv / dt / 200) - G.walk) * Math.min(1, dt * 14); G.phase += mv * 0.28; }
    }
    for (const i of res.switches) onSwitch(lv, i);
    if (res.gotKey || res.gotCoin || res.gotFrag.length) G.glowAt = G.time;
    if (res.gotFrag.length) { Sfx.play("coin"); for (const i of res.gotFrag) { const f = lv.fragments[i]; ring(f.x, f.y, "#99ffff", 30, 0.3); burst(f.x, f.y, "#8ff6ff", 12, 140); } }
    if (res.gotKey) {
      Sfx.play("key");
      burst(lv.key.x, lv.key.y, "#ffd23f", 26, 200);
      burst(lv.door.x, lv.door.y, "#39ff88", 14, 90);
    }
    if (res.gotCoin) { Sfx.play("coin"); ring(lv.coin.x, lv.coin.y, "#ffcf33", 36, 0.3); burst(lv.coin.x, lv.coin.y, "#ffcf33", 16, 160); }
    for (const tp of res.teleports) onPortal(tp);

    if (res.hazard) return lose(res.hazard);
    if (res.won) return win();
    if (lv.nonstop) { // missão "sem parar": mede o deslocamento REAL a partir de uma âncora (oscilação < tolerância e parede contam como parado)
      if (G.dash || res.teleports.length) { G.anchor.x = G.pos.x; G.anchor.y = G.pos.y; G.stillT = 0; } // impulso e portal nunca derrubam
      else if (Math.hypot(G.pos.x - G.anchor.x, G.pos.y - G.anchor.y) >= NONSTOP_TOL) { G.anchor.x = G.pos.x; G.anchor.y = G.pos.y; G.stillT = 0; }
      else { G.stillT += dt; if (G.stillT > NONSTOP_MAX) return lose("still"); }
    }
    if (G.limit !== 0) { // sem limite (0): nunca perde por tempo
      const left = G.limit - G.elapsed;
      if (left <= 3) { const c = Math.ceil(left); if (c >= 1 && c !== G.lastTick) { G.lastTick = c; Sfx.play("tick"); } } // aviso sonoro nos 3 últimos segundos
      if (G.elapsed >= G.limit) { G.elapsed = G.limit; return lose("time"); }
    }
    updateHud();
  }

  /** Impulso: uma vez por tentativa; só em jogo (ready/playing) — nunca em pausa, transição ou derrota. */
  function tryDash() {
    if (G.state !== "ready" && G.state !== "playing") return;
    if (G.noDash) { G.noDashMsgAt = G.time; return; } // missão "sem impulso": o impulso não funciona (mostra um aviso breve)
    if (G.dashUsed || G.dash) return;
    if (performance.now() - skipGuardAt < 150) return; // acabou de pular a transição
    const v = inputVector();
    const d = v.dx || v.dy ? v : G.lastDir; // parado: última direção (ou a inicial da fase)
    G.dashUsed = true;
    G.dash = { dx: d.dx, dy: d.dy, left: E.DASH_DIST };
    G.trail = [];
    if (G.state === "ready") G.state = "playing";
    Sfx.play("dash");
    ring(G.pos.x, G.pos.y, DASH_COLOR, 34, 0.25);
    updateHud();
  }

  function onSwitch(lv, i) {
    const s = lv.switches[i], g = lv.gates[s.gate], col = g.color || GATE_COLORS[s.gate % GATE_COLORS.length];
    Sfx.play("switch");
    ring(s.x, s.y, col, 40, 0.35);
    burst(s.x, s.y, col, 14, 140);
    burst(g.x + g.w / 2, g.y + g.h / 2, col, 18, 120);
  }
  function onPortal(tp) {
    const col = PORTAL_COLORS[tp.pair % PORTAL_COLORS.length];
    Sfx.play("portal");
    ring(tp.from.x, tp.from.y, col, 50, 0.4);
    ring(tp.to.x, tp.to.y, col, 50, 0.4);
    burst(tp.from.x, tp.from.y, col, 12, 160);
    burst(tp.to.x, tp.to.y, col, 12, 160);
  }

  /* ------------------------------------------------------------------
   * 7. PARTÍCULAS E ANÉIS (desligados com movimento reduzido)
   * ------------------------------------------------------------------ */
  function burst(x, y, color, n, speed) {
    if (RM()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.25 + Math.random() * 0.75);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, color, size: 2 + Math.random() * 3 });
    }
  }
  function ring(x, y, color, maxR, dur) {
    if (RM()) return;
    rings.push({ x, y, color, maxR, dur, age: 0 });
  }
  function updateParticles(dt) {
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) r.age += dt;
    rings = rings.filter((r) => r.age < r.dur);
  }

  /* ------------------------------------------------------------------
   * 8. DESENHO (tudo em coordenadas do mundo 800x500; a escala vem do resize)
   * ------------------------------------------------------------------ */
  const canvas = $("game");
  const ctx = canvas.getContext("2d");
  let scale = 1, dpr = 1;

  function resize() {
    const stage = $("stage");
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w < 10 || h < 10) return;
    scale = Math.min(w / E.WORLD_W, h / E.WORLD_H);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const cw = Math.floor(E.WORLD_W * scale), ch = Math.floor(E.WORLD_H * scale);
    canvas.style.width = cw + "px";
    canvas.style.height = ch + "px";
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  new ResizeObserver(resize).observe($("stage"));
  window.addEventListener("resize", resize);

  function glow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  function noGlow() { ctx.shadowBlur = 0; }
  const wave = (speed, amp) => (RM() ? 0 : Math.sin(G.time * speed) * amp);

  const theme = () => sectorOf(G.mission >= 0 ? MISSIONS[G.mission].base - 1 : G.levelIdx).theme;
  const doorReady = (lv) => G.hasKey && E.fragmentsDone(lv, G); // porta pronta: chave + (missão de coleta) todos os fragmentos

  function drawBackground() {
    const th = theme();
    ctx.fillStyle = th.bg;
    ctx.fillRect(0, 0, E.WORLD_W, E.WORLD_H);
    ctx.fillStyle = "rgba(255,255,255,.02)"; // piso em placas alternadas (bem discreto)
    for (let j = 0; j < 13; j++) for (let i = (j % 2); i < 20; i += 2) ctx.fillRect(i * 40, j * 40, 40, 40);
    ctx.strokeStyle = th.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= E.WORLD_W; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, E.WORLD_H); }
    for (let y = 0; y <= E.WORLD_H; y += 40) { ctx.moveTo(0, y); ctx.lineTo(E.WORLD_W, y); }
    ctx.stroke();
    ctx.fillStyle = th.grid; // parafusos nos cruzamentos (decoração discreta)
    for (let x = 120; x < E.WORLD_W; x += 120) for (let y = 120; y < E.WORLD_H; y += 120) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = 3; // moldura da sala
    ctx.strokeRect(2, 2, E.WORLD_W - 4, E.WORLD_H - 4);
    ctx.globalAlpha = 1;
  }

  /** Paredes: cada setor tem cor E textura própria (tijolos, pontos, diagonais, chapas rebitadas). */
  function drawWalls(lv) {
    const th = theme();
    ctx.fillStyle = "rgba(0,0,0,.35)"; // sombra projetada pelas paredes
    for (const w of lv.walls) ctx.fillRect(w.x + 4, w.y + 5, w.w, w.h);
    for (const w of lv.walls) {
      glow(th.wallGlow, 10);
      ctx.fillStyle = th.wallFill;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      noGlow();
      ctx.strokeStyle = th.wallStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
      ctx.save();
      ctx.beginPath(); ctx.rect(w.x + 2, w.y + 2, w.w - 4, w.h - 4); ctx.clip();
      ctx.strokeStyle = th.wallStroke; ctx.fillStyle = th.wallStroke; ctx.globalAlpha = 0.3; ctx.lineWidth = 1.5;
      if (th.pattern === "dots") {
        for (let y = w.y + 8; y < w.y + w.h; y += 14) for (let x = w.x + 8; x < w.x + w.w; x += 14) { ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill(); }
      } else if (th.pattern === "diag") {
        ctx.beginPath();
        for (let k = -w.h; k < w.w + w.h; k += 14) { ctx.moveTo(w.x + k, w.y + w.h); ctx.lineTo(w.x + k + w.h, w.y); }
        ctx.stroke();
      } else if (th.pattern === "plates") {
        ctx.strokeRect(w.x + 5, w.y + 5, w.w - 10, w.h - 10);
        ctx.globalAlpha = 0.55;
        const vertical = w.h >= w.w;
        for (let k = 22; k < (vertical ? w.h : w.w) - 8; k += 40) { ctx.beginPath(); ctx.arc(vertical ? w.x + w.w / 2 : w.x + k, vertical ? w.y + k : w.y + w.h / 2, 2.2, 0, Math.PI * 2); ctx.fill(); }
      } else if (th.pattern === "scan") {
        ctx.beginPath();
        for (let y = w.y + 4; y < w.y + w.h; y += 6) { ctx.moveTo(w.x + 2, y); ctx.lineTo(w.x + w.w - 2, y); }
        ctx.stroke();
        for (let y = w.y + 10, r = 0; y < w.y + w.h; y += 30, r++) ctx.fillRect(w.x + 3 + (r % 2) * 4, y, 4, 2); // marcas de painel
      } else if (th.pattern === "hex") {
        for (let y = w.y + 6, r = 0; y < w.y + w.h; y += 10, r++) for (let x = w.x + 4 + (r % 2) * 6; x < w.x + w.w; x += 12) ctx.fillRect(x, y, 3, 3);
      } else { // bricks
        ctx.beginPath();
        for (let y = w.y + 20; y < w.y + w.h; y += 20) { ctx.moveTo(w.x + 2, y); ctx.lineTo(w.x + w.w - 2, y); }
        ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,.16)"; // brilho de quina (profundidade)
      ctx.fillRect(w.x + 2, w.y + 2, w.w - 4, 2); ctx.fillRect(w.x + 2, w.y + 2, 2, w.h - 4);
    }
  }

  /** Gelo: placa azul-clara com borda contínua, hachura diagonal e cristais "+" (a forma, não só a cor, indica o piso). */
  function drawIce(lv) {
    for (const r of lv.ice) {
      ctx.fillStyle = "rgba(170,235,255,.16)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
      ctx.strokeStyle = "rgba(200,245,255,.22)"; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = -r.h; k < r.w; k += 22) { ctx.moveTo(r.x + k, r.y + r.h); ctx.lineTo(r.x + k + r.h, r.y); }
      ctx.stroke();
      ctx.strokeStyle = "rgba(230,250,255,.6)"; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let y = r.y + 30; y < r.y + r.h; y += 70) for (let x = r.x + 30 + ((y / 70) % 2 ? 35 : 0); x < r.x + r.w; x += 70) {
        ctx.moveTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#bff3ff"; ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
    }
  }

  /** Esteira: placa escura com borda tracejada e setas ">" que correm no sentido do empurrão (paradas com efeitos reduzidos). */
  function drawBelts(lv) {
    for (const b of lv.belts) {
      ctx.fillStyle = "#1b1f27";
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      const gap = 36;
      const off = RM() ? 0 : (G.time * b.speed * 0.6) % gap; // G.time para na pausa: setas congelam
      ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.globalAlpha = 0.85;
      const horiz = b.dx !== 0;
      const rowStep = 34;
      const along = horiz ? b.w : b.h, across = horiz ? b.h : b.w;
      for (let r2 = rowStep / 2; r2 < across; r2 += rowStep) {
        for (let k = -gap; k < along + gap; k += gap) {
          const p = (k + off) * (b.dx + b.dy); // posição ao longo do fluxo
          const pos = (b.dx + b.dy) > 0 ? k + off : along - (k + off);
          const cx = horiz ? b.x + pos : b.x + r2, cy = horiz ? b.y + r2 : b.y + pos;
          const sx = b.dx, sy = b.dy;
          ctx.beginPath();
          ctx.moveTo(cx - 6 * sx - 6 * (sy !== 0 ? 1 : 0), cy - 6 * sy - 6 * (sx !== 0 ? 1 : 0));
          ctx.lineTo(cx + 4 * sx, cy + 4 * sy);
          ctx.lineTo(cx - 6 * sx + 6 * (sy !== 0 ? 1 : 0), cy - 6 * sy + 6 * (sx !== 0 ? 1 : 0));
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = "#9aa7b8"; ctx.lineWidth = 3; ctx.setLineDash([10, 7]);
      ctx.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
      ctx.setLineDash([]);
    }
  }

  /** Passagem fechada: barreira listrada na cor do interruptor. Aberta: contorno verde tracejado. */
  function drawGates(lv) {
    lv.gates.forEach((g, i) => {
      const col = g.color || GATE_COLORS[i % GATE_COLORS.length];
      const open = G.rt.open[i];
      if (!open || G.gateAge[i] < 0.25) {
        const a = open ? 1 - G.gateAge[i] / 0.25 : 1; // some em 0,25 s ao abrir
        ctx.save();
        ctx.globalAlpha = a;
        glow(col, 12);
        ctx.fillStyle = "#2a1a05";
        ctx.fillRect(g.x, g.y, g.w, g.h);
        noGlow();
        ctx.beginPath(); ctx.rect(g.x, g.y, g.w, g.h); ctx.clip();
        ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.beginPath();
        for (let k = -g.h; k < g.w + g.h; k += 12) { ctx.moveTo(g.x + k, g.y + g.h); ctx.lineTo(g.x + k + g.h, g.y); }
        ctx.stroke();
        ctx.restore();
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.strokeRect(g.x + 1.5, g.y + 1.5, g.w - 3, g.h - 3); ctx.restore();
      }
      if (open) {
        ctx.strokeStyle = "rgba(57,255,136,.7)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 6]);
        ctx.strokeRect(g.x + 1, g.y + 1, g.w - 2, g.h - 2);
        ctx.setLineDash([]);
      }
    });
  }

  function drawSwitches(lv) {
    lv.switches.forEach((s, i) => {
      const g = lv.gates[s.gate], col = g.color || GATE_COLORS[s.gate % GATE_COLORS.length], on = G.rt.sw[i];
      if (!on) { // fio pontilhado mostra qual passagem ele abre
        ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = 2; ctx.setLineDash([3, 8]);
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(g.x + g.w / 2, g.y + g.h / 2); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#17142e";
      ctx.strokeStyle = on ? "#39ff88" : col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(s.x - 15, s.y - 15, 30, 30, 7); ctx.fill(); ctx.stroke();
      glow(on ? "#39ff88" : col, on ? 8 : 12 + wave(5, 4));
      ctx.fillStyle = on ? "#39ff88" : col;
      ctx.beginPath(); ctx.arc(s.x, s.y, on ? 5 : 8, 0, Math.PI * 2); ctx.fill();
      noGlow();
    });
  }

  function drawPortals(lv) {
    lv.portals.forEach((pr, i) => {
      const col = PORTAL_COLORS[i % PORTAL_COLORS.length];
      ctx.strokeStyle = col; ctx.globalAlpha = 0.22; ctx.lineWidth = 2; ctx.setLineDash([2, 9]);
      ctx.beginPath(); ctx.moveTo(pr.a.x, pr.a.y); ctx.lineTo(pr.b.x, pr.b.y); ctx.stroke(); // conexão do par
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      for (const end of ["a", "b"]) {
        const p = pr[end], locked = G.rt.lock && G.rt.lock.pair === i && G.rt.lock.end === end;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.globalAlpha = locked ? 0.45 : 1; // destino ainda "recarregando"
        glow(col, 16);
        ctx.strokeStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, E.PORTAL_R, 0, Math.PI * 2); ctx.stroke();
        noGlow();
        ctx.fillStyle = col; ctx.globalAlpha *= 0.18;
        ctx.beginPath(); ctx.arc(0, 0, E.PORTAL_R, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = locked ? 0.45 : 0.9;
        ctx.rotate(RM() ? 0 : G.time * 3 * (end === "a" ? 1 : -1));
        ctx.lineWidth = 3; ctx.lineCap = "round";
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, 9, k * 2.1, k * 2.1 + 1.1); ctx.stroke(); }
        ctx.restore();
      }
    });
  }

  function drawSpikes(lv) {
    const T = 18;
    for (const s of lv.spikes) {
      ctx.fillStyle = "rgba(255,45,85,.14)";
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeStyle = "rgba(255,45,85,.7)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); // borda tracejada: superfície perigosa
      ctx.strokeRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2); ctx.setLineDash([]);
      glow("#ff2d55", 10);
      ctx.fillStyle = "#ff2d55";
      ctx.beginPath();
      for (let x = s.x; x < s.x + s.w - 1; x += T) {
        for (let y = s.y; y < s.y + s.h - 1; y += T) {
          const w = Math.min(T, s.x + s.w - x), h = Math.min(T, s.y + s.h - y);
          ctx.moveTo(x + 1, y + h - 1);
          ctx.lineTo(x + w / 2, y + 1);
          ctx.lineTo(x + w - 1, y + h - 1);
          ctx.closePath();
        }
      }
      ctx.fill();
      noGlow();
    }
  }

  /** Laser: apagado = fio fraco; aviso = tracejado amarelo piscando; ligado = feixe grosso com núcleo branco. */
  function drawLasers(lv) {
    for (const l of lv.lasers) {
      const st = E.laserState(l, G.elapsed);
      const horiz = l.w >= l.h;
      const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
      const ax = horiz ? l.x : cx, ay = horiz ? cy : l.y;
      const bx = horiz ? l.x + l.w : cx, by = horiz ? cy : l.y + l.h;
      ctx.lineCap = "butt";
      if (st === 0) {
        ctx.strokeStyle = LASER_COLOR; ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      } else if (st === 1) {
        const blink = RM() ? 0.8 : 0.5 + 0.5 * Math.sin(G.time * 32);
        ctx.strokeStyle = "#ffd23f"; ctx.globalAlpha = 0.35 + 0.65 * blink; ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        glow(LASER_COLOR, 20);
        ctx.strokeStyle = LASER_COLOR; ctx.globalAlpha = 1; ctx.lineWidth = Math.min(l.w, l.h);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        noGlow();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, Math.min(l.w, l.h) / 3);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // emissores nas pontas (acendem no aviso e quando ligado)
      for (const [ex, ey] of [[ax, ay], [bx, by]]) {
        ctx.fillStyle = "#2a1020";
        ctx.strokeStyle = st === 1 ? "#ffd23f" : LASER_COLOR; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(ex - 9, ey - 9, 18, 18, 4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = st === 0 ? "#5a2a3a" : st === 1 ? "#ffd23f" : "#fff";
        ctx.beginPath(); ctx.arc(ex, ey, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  function drawMovers(lv) {
    for (const m of lv.movers) {
      if (!m.r) continue;
      ctx.strokeStyle = "rgba(255,61,242,.25)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 8]);
      ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2); ctx.stroke();
      ctx.setLineDash([]);
      const p = E.moverPos(m, G.elapsed);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(RM() ? 0 : G.time * 6);
      glow("#ff3df2", 14);
      ctx.fillStyle = "#ff3df2";
      ctx.beginPath();
      const teeth = 10;
      for (let i = 0; i < teeth * 2; i++) {
        const a = (i / (teeth * 2)) * Math.PI * 2, rr = i % 2 ? m.r * 0.78 : m.r + 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      noGlow();
      ctx.fillStyle = "#1a0830";
      ctx.beginPath(); ctx.arc(0, 0, m.r * 0.35, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawDoor(lv) {
    const d = lv.door, h = E.DOOR_HALF, open = doorReady(lv);
    const color = open ? "#39ff88" : "#6a6690";
    glow(open ? "#39ff88" : "#000", open ? 18 + wave(6, 6) : 0);
    ctx.fillStyle = open ? "rgba(57,255,136,.18)" : "#17142e";
    ctx.strokeStyle = color; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(d.x - h, d.y + h); ctx.lineTo(d.x - h, d.y - h + 12);
    ctx.arc(d.x, d.y - h + 12, h, Math.PI, 0);
    ctx.lineTo(d.x + h, d.y + h); ctx.closePath();
    ctx.fill(); ctx.stroke();
    noGlow();
    if (open) {
      ctx.fillStyle = "#b8ffd6";
      ctx.fillRect(d.x - 8, d.y - 6, 16, h + 6);
    } else {
      ctx.fillStyle = "#8c88b8";
      ctx.fillRect(d.x - 8, d.y - 2, 16, 13);
      ctx.strokeStyle = "#8c88b8"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(d.x, d.y - 3, 6, Math.PI, 0); ctx.stroke();
    }
  }

  function drawKey(lv) {
    if (G.hasKey) return;
    const k = lv.key, bob = wave(4, 3);
    ctx.save();
    ctx.translate(k.x, k.y + bob);
    ctx.rotate(-0.6);
    glow("#ffd23f", 16);
    ctx.strokeStyle = "#ffd23f"; ctx.fillStyle = "#ffd23f"; ctx.lineWidth = 3.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(-8, 0, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(12, 0); ctx.moveTo(8, 0); ctx.lineTo(8, 6); ctx.moveTo(12, 0); ctx.lineTo(12, 5); ctx.stroke();
    ctx.restore();
    noGlow();
  }

  /** Moeda opcional (círculo dourado girando); um "✓" indica que já foi conquistada antes. */
  function drawCoin(lv) {
    if (!lv.coin || G.coin) return;
    const c = lv.coin, sx = RM() ? 1 : 0.35 + 0.65 * Math.abs(Math.cos(G.time * 3));
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.scale(sx, 1);
    glow("#ffcf33", 14);
    ctx.fillStyle = "#ffcf33";
    ctx.beginPath(); ctx.arc(0, 0, E.COIN_R - 1, 0, Math.PI * 2); ctx.fill();
    noGlow();
    ctx.strokeStyle = "#8a5a00"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, E.COIN_R - 4.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (P.coins.has(G.levelIdx)) { ctx.fillStyle = "#39ff88"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.fillText("✓", c.x, c.y - 16); }
  }

  /** Rastro do impulso (desligado com movimento reduzido). */
  function drawTrail() {
    for (const t of G.trail) {
      ctx.globalAlpha = Math.max(0, 0.5 - t.age * 2);
      ctx.fillStyle = DASH_COLOR;
      ctx.fillRect(t.x - 9, t.y - 9, 18, 18);
    }
    ctx.globalAlpha = 1;
  }

  /** Impulso disponível: anel e seta âmbar na direção em que ele vai (atual ou última/inicial). */
  function drawDashHint() {
    if ((G.state !== "ready" && G.state !== "playing") || G.dashUsed || G.dash) return;
    const v = inputVector();
    const d = v.dx || v.dy ? v : G.lastDir, m = Math.hypot(d.dx, d.dy), ux = d.dx / m, uy = d.dy / m;
    const { x, y } = G.pos;
    ctx.strokeStyle = DASH_COLOR; ctx.lineWidth = 2; ctx.globalAlpha = 0.55 + wave(6, 0.2);
    ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x + ux * 27, y + uy * 27);
    ctx.rotate(Math.atan2(uy, ux));
    glow(DASH_COLOR, 10);
    ctx.fillStyle = DASH_COLOR;
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7); ctx.closePath(); ctx.fill();
    ctx.restore();
    noGlow();
  }

  /* ------------------------------------------------------------------
   * PERSONAGEM pixel-art procedural. O desenho é independente da colisão: a colisão é sempre um círculo
   * de raio E.PLAYER_R (11 u) no engine; o sprite (12x14 "pixels" de 2 u = 24x28 u) só é desenhado em cima.
   * Nenhuma skin ou animação altera tamanho/posição de colisão nem a velocidade.
   * ------------------------------------------------------------------ */
  const CU = 2; // tamanho de cada pixel do sprite em unidades do mundo
  const SKIN_STYLE = {
    explorer: { suit: "#e9eeff", suit2: "#9fb2d9", helmet: "#cfe0ff", visor: "#19f0ff", glow: "#19f0ff", outline: "#0b1030", accent: "#ffb02e" },
    astro: { suit: "#ffffff", suit2: "#c5cbe0", helmet: "#f4f7ff", visor: "#ffcf5a", glow: "#ffe08a", outline: "#0b1030", accent: "#ff5a36" },
    robot: { suit: "#8fa3b8", suit2: "#5b6d82", helmet: "#a9bccf", visor: "#ff4d6d", glow: "#ff4d6d", outline: "#0b1030", accent: "#39ff88" },
    ninja: { suit: "#2b2f4a", suit2: "#1a1d33", helmet: "#2b2f4a", visor: "#ffffff", glow: "#ffffff", outline: "#aeb9ff", accent: "#ff3d5a" },
    holo: { suit: "#6dffe0", suit2: "#2bd6b0", helmet: "#a8fff0", visor: "#ffffff", glow: "#6dffe0", outline: "#e6fffb", accent: "#19f0ff", alpha: 0.88 },
    scarlet: { suit: "#d62839", suit2: "#8d1b28", helmet: "#d62839", visor: "#ffffff", glow: "#ffd23f", outline: "#2a0508", accent: "#ffd23f", cape: "#a3121f" },
    speed: { suit: "#1e6bff", suit2: "#0d3fa8", helmet: "#2d7bff", visor: "#fff35c", glow: "#fff35c", outline: "#06113a", accent: "#ffffff" },
    shadow: { suit: "#3a4868", suit2: "#222b45", helmet: "#2c3652", visor: "#3cf0d0", glow: "#3cf0d0", outline: "#b6c4f0", accent: "#3cf0d0", cape: "#1c2338" },
    titan: { suit: "#9a8f86", suit2: "#6e655e", helmet: "#b3a79d", visor: "#ff9d2e", glow: "#ff9d2e", outline: "#1d1410", accent: "#ff7a1a" },
    sentinel: { suit: "#2aa7a0", suit2: "#17706b", helmet: "#3dd0c8", visor: "#ffffff", glow: "#9ffff8", outline: "#04201f", accent: "#ffffff" },
    agent: { suit: "#262b3a", suit2: "#14171f", helmet: "#3a3f52", visor: "#0a0a12", glow: "#aac4ff", outline: "#cfd8ff", accent: "#e63946" },
    spectre: { suit: "#8b6cff", suit2: "#5a3fd0", helmet: "#a58bff", visor: "#ffffff", glow: "#d9ccff", outline: "#efe9ff", accent: "#ffffff", alpha: 0.82 },
    arcane: { suit: "#6a3dc0", suit2: "#3f2480", helmet: "#7b4fd6", visor: "#ffb8ff", glow: "#d77bff", outline: "#1a0a3a", accent: "#ffd23f", cape: "#4a2a95" },
    gold: { suit: "#ffd23f", suit2: "#d19a00", helmet: "#ffe58a", visor: "#fff6c9", glow: "#ffd23f", outline: "#3b2600", accent: "#fff3b0" },
  };
  // estado de desenho reutilizado (sem alocar objetos por quadro)
  let _c = null, _ox = 0, _oy = 0, _flip = false, _outline = false, _ocol = "#000";
  /** Retângulo do sprite em "pixels" (gx,gy,gw,gh), orientação "olhando para a direita"; espelha se olhar para a esquerda. */
  function px(color, gx, gy, gw, gh) {
    const x0 = _flip ? 12 - gx - gw : gx, pad = _outline ? 1 : 0;
    _c.fillStyle = _outline ? _ocol : color;
    _c.fillRect(_ox + x0 * CU - pad, _oy + gy * CU - pad, gw * CU + pad * 2, gh * CU + pad * 2);
  }
  const POSE = { t: 0, fx: 1, fy: 0, walk: 0, phase: 0, dash: false, glow: 0, dead: -1, win: false, rm: false };

  function bodyParts(st, id, view, p, dy, walking, step) {
    const dash = p.dash, win = p.win, lean = dash ? 1 : 0;
    const sw = walking && !dash ? Math.round(step * 1.5) : 0;
    const legCol = st.suit2, th = 4 - dy;
    // --- pernas (y 10..13)
    if (id === "holo") { px(st.suit2, 4, 10, 4, 2); px(st.suit2, 5, 12, 2, 2); }
    else if (id === "spectre") { px(st.suit2, 3, 10, 6, 1); px(st.suit2, 4, 11, 5, 1); px(st.suit2, 3, 12, 2, 1); px(st.suit2, 6, 12, 3, 1); px(st.suit2, p.rm ? 5 : 4 + (Math.sin(p.t * 6) > 0 ? 1 : 0), 13, 2, 1); } // cauda de fumaça
    else if (view === 0) {
      if (dash) { px(legCol, 2, 10, 3, 2); px(legCol, 1, 12, 3, 2); px(legCol, 4, 11, 3, 2); }
      else { const la = walking && sw > 0 ? 3 : 4, lb = walking && sw < 0 ? 3 : 4; px(legCol, 4 + sw, 14 - la, 2, la); px(legCol, 6 - sw, 14 - lb, 2, lb); }
    } else { const la = walking && sw > 0 ? 3 : 4, lb = walking && sw < 0 ? 3 : 4; px(legCol, 3, 14 - la, 2, la); px(legCol, 7, 14 - lb, 2, lb); }
    // --- capa (atrás do corpo; de costas ela cobre o corpo e é desenhada depois do tronco)
    const capeExt = walking || dash ? 2 : 0, capeFl = p.rm ? 0 : Math.sin(p.t * 7) > 0 ? 1 : 0;
    if (st.cape) {
      if (view === 0) { px(st.cape, 0 - lean, 6 + dy, 4, 5 + capeExt + capeFl); px(st.cape, 1 - lean, 10 + dy, 2, 2 + capeExt); }
      else if (view === 1) { px(st.cape, 1, 6 + dy, 2, 6 + capeExt); px(st.cape, 9, 6 + dy, 2, 6 + capeExt); }
    }
    // --- mochila / acessório de costas
    if (id === "explorer") { if (view === 0) px(st.accent, 1, 6 + dy, 3, 4); else if (view === 2) px(st.accent, 3, 6 + dy, 6, 4); }
    if (id === "astro" && view === 0) px(st.suit2, 1, 6 + dy, 3, 4);
    // --- tronco
    if (id === "titan") { if (view === 0) px(st.suit, 3 + lean, 6 + dy, 7, th); else px(st.suit, 2, 6 + dy, 8, th); }
    else if (view === 0) px(st.suit, 4 + lean, 6 + dy, 5, th); else px(st.suit, 3, 6 + dy, 6, th);
    if (st.cape && view === 2) px(st.cape, 2, 6 + dy, 8, 6 + capeExt); // capa de costas
    px(st.suit2, view === 0 ? 4 + lean : 3, 9, view === 0 ? 5 : 6, 1); // cinto
    if (id === "astro" && view !== 2) px(st.accent, view === 0 ? 6 : 5, 7 + dy, 2, 2);
    if (id === "agent" && view !== 2) { px("#f4f4f8", view === 0 ? 6 : 5, 6 + dy, 2, 1); px(st.accent, view === 0 ? 6 : 5, 7 + dy, 1, 3); } // camisa e gravata
    if (id === "spectre") { px(st.helmet, 2, 6 + dy, 1, 1); px(st.helmet, 9, 6 + dy, 1, 1); } // barra esfarrapada
    if (id === "robot" && view !== 2) px(st.accent, view === 0 ? 6 : 5, 8 + dy, 2, 1);
    if (id === "ninja" && view !== 0) px(st.accent, 3, 6 + dy, 6, 1); // cachecol no pescoço
    if (view !== 2) {
      if (id === "scarlet") px(st.accent, view === 0 ? 6 : 5, 7 + dy, 2, 2); // emblema dourado
      if (id === "speed") { px(st.accent, view === 0 ? 6 : 5, 7 + dy, 2, 1); px(st.accent, view === 0 ? 5 : 4, 8 + dy, 2, 1); px(st.accent, view === 0 ? 7 : 6, 8 + dy, 1, 1); } // raio
      if (id === "titan") { px(st.accent, view === 0 ? 6 : 4, 7 + dy, 1, 2); px(st.accent, view === 0 ? 7 : 7, 9, 1, 1); } // rachaduras de lava
      if (id === "shadow") px(st.accent, view === 0 ? 4 + lean : 3, 9, view === 0 ? 5 : 6, 1); // cinto de utilidades
      if (id === "sentinel") px(st.accent, view === 0 ? 6 : 5, 7 + dy, 2, 1); // faixa no peito
    }
    if (id === "arcane" && view !== 1) { px(st.accent, 1, 8 + dy, 1, 1); px(st.accent, 2, 10 + dy, 1, 1); if (view === 2) { px(st.accent, 4, 8 + dy, 1, 1); px(st.accent, 7, 10 + dy, 1, 1); } } // runas
    // --- braços
    const armCol = id === "astro" ? st.accent : st.suit2;
    if (win) { if (view === 0) px(armCol, 6, 2, 2, 5); else { px(armCol, 1, 2, 1, 5); px(armCol, 10, 2, 1, 5); } }
    else if (view === 0) px(armCol, 5 + lean + sw, 7 + dy, 2, 3);
    else { px(armCol, 2, 7 + dy + (sw > 0 ? 1 : 0), 1, 3); px(armCol, 9, 7 + dy + (sw < 0 ? 1 : 0), 1, 3); }
    if (id === "titan" && !win) { if (view === 0) px(armCol, 7 + lean + sw, 7 + dy, 2, 4); else { px(armCol, 0, 7 + dy, 2, 4); px(armCol, 10, 7 + dy, 2, 4); } }
    if (id === "sentinel" && !win) { if (view === 0) { px(st.accent, 6 + lean, 6 + dy, 3, 5); px(st.suit2, 7 + lean, 7 + dy, 1, 3); } else if (view === 1) { px(st.accent, 0, 6 + dy, 3, 5); px(st.suit2, 1, 7 + dy, 1, 3); } } // escudo hexagonal
    // --- cachecol do ninja: cauda ao vento
    if (id === "ninja") { const ty = p.rm ? 0 : Math.sin(p.t * 8) > 0 ? 0 : 1; if (view === 0) { px(st.accent, 0, 6 + dy + ty, 4, 1); px(st.accent, 0, 7 + dy + ty, 2, 1); } else px(st.accent, 9, 7 + dy + ty, 1, 3); }
    // --- cabeça
    const wide = id === "astro", sq = id === "robot" || id === "titan";
    const small = id === "titan";
    const hx = (wide ? 1 : small ? 3 : 2) + (view === 0 ? lean : 0), hw = wide ? 10 : small ? 6 : 8;
    if (sq) px(st.helmet, hx, dy, hw, 6);
    else { px(st.helmet, hx + 1, dy, hw - 2, 1); px(st.helmet, hx, dy + 1, hw, 4); px(st.helmet, hx + 1, dy + 5, hw - 2, 1); }
    if (id === "ninja") px(st.accent, hx, dy + 1, hw, 1); // faixa na testa
    if (id === "speed") { px(st.accent, hx - 1, dy + 1, 1, 2); px(st.accent, hx + hw, dy + 1, 1, 2); px(st.accent, hx - 2, dy + 2, 1, 1); px(st.accent, hx + hw + 1, dy + 2, 1, 1); } // aletas
    if (id === "scarlet") px(st.suit2, hx, dy + 4, hw, 1); // máscara cobrindo o queixo
    // acessórios do topo
    if (id === "agent") px(st.suit2, hx, dy, hw, 2); // cabelo curto
    if (id === "spectre") { px(st.helmet, hx + 2, dy - 1, hw - 4, 1); px(st.helmet, hx + 3, dy - 2, hw - 6, 1); } // ponta do capuz
    if (id === "arcane") { px(st.helmet, hx - 1, dy, hw + 2, 1); px(st.helmet, hx + 1, dy - 1, hw - 2, 1); px(st.helmet, hx + 2, dy - 2, hw - 4, 1); px(st.helmet, hx + 3, dy - 3, 2, 1); px(st.accent, hx + 1, dy, hw - 2, 1); } // chapéu pontudo com faixa
    if (id === "explorer") { px(st.suit2, 6, -2 + dy, 1, 2); px(st.accent, 5, -3 + dy, 3, 1); }
    if (id === "robot") { px(st.suit2, 5, -2 + dy, 2, 2); px(st.accent, 4, -4 + dy, 4, 2); }
    if (id === "gold") { px(st.accent, 3, -2 + dy, 1, 2); px(st.accent, 5, -3 + dy, 2, 3); px(st.accent, 8, -2 + dy, 1, 2); px(st.accent, 3, -1 + dy, 6, 1); }
    // --- visor (brilho só na passada de preenchimento)
    if (view !== 2) {
      if (!_outline) { _c.shadowColor = st.glow; _c.shadowBlur = p.glow > 0 && !p.rm ? 12 : 5; }
      if (id === "shadow") { if (view === 0) { px(st.visor, 6 + lean, 2 + dy, 2, 2); px(st.visor, 3 + lean, 2 + dy, 2, 2); } else { px(st.visor, 3, 2 + dy, 2, 2); px(st.visor, 7, 2 + dy, 2, 2); } }
      else if (id === "arcane") { if (view === 0) px(st.visor, 7 + lean, 3 + dy, 2, 1); else { px(st.visor, 4, 3 + dy, 1, 1); px(st.visor, 7, 3 + dy, 1, 1); } }
      else if (id === "robot") { if (view === 0) px(st.visor, 7 + lean, 2 + dy, 2, 2); else { px(st.visor, 3, 2 + dy, 2, 2); px(st.visor, 7, 2 + dy, 2, 2); } }
      else if (id === "ninja") { if (view === 0) px(st.visor, 6 + lean, 3 + dy, 3, 1); else px(st.visor, 3, 3 + dy, 6, 1); }
      else if (view === 0) { px(st.visor, 6 + lean, 2 + dy, 4, 3); if (!_outline) px("#ffffff", 6 + lean, 2 + dy, 1, 1); }
      else { px(st.visor, 3, 2 + dy, 6, 3); if (!_outline) px("#ffffff", 3, 2 + dy, 1, 1); }
      if (!_outline) _c.shadowBlur = 0;
    } else if (id !== "ninja") px(st.suit2, 5, 2 + dy, 2, 1); // nuca: sem visor
  }

  /** Desenha o personagem de `skin` em (x,y) no contexto `c` com a pose `p`. */
  function drawCharacter(c, x, y, skin, p) {
    const st = SKIN_STYLE[skin] || SKIN_STYLE.explorer;
    const horiz = Math.abs(p.fx) >= Math.abs(p.fy);
    const view = horiz ? 0 : p.fy > 0 ? 1 : 2; // 0 de lado, 1 de frente, 2 de costas
    _flip = horiz && p.fx < 0;
    _c = c; _ox = -6 * CU; _ocol = st.outline;
    const walking = p.walk > 0.25, step = Math.sin(p.phase);
    let dy = 0;
    if (!p.rm) dy = walking ? (Math.abs(step) > 0.75 ? -1 : 0) : Math.sin(p.t * 2.4) > 0.3 ? -1 : 0; // passo / respiração
    const jump = p.win && !p.rm ? -Math.abs(Math.sin(p.t * 9)) * 5 : 0;
    _oy = -7 * CU + jump;
    c.save();
    c.translate(x, y);
    c.fillStyle = "rgba(0,0,0,.3)"; // sombra no chão
    c.beginPath(); c.ellipse(0, 12, 9, 3, 0, 0, Math.PI * 2); c.fill();
    if (p.dead >= 0) { c.rotate(p.dead * 2.4 * (p.fx < 0 ? -1 : 1)); const k = 1 - 0.35 * p.dead; c.scale(k, k); c.globalAlpha = 1 - p.dead * 0.9; }
    if (p.dash && !p.rm) { // rastro curto do impulso
      const m = Math.hypot(p.fx, p.fy) || 1, ux = p.fx / m, uy = p.fy / m;
      c.strokeStyle = st.glow; c.lineWidth = 2; c.globalAlpha *= 0.55;
      c.beginPath();
      for (let o = -6; o <= 6; o += 6) { c.moveTo(-ux * 14 - uy * o, -uy * 14 + ux * o); c.lineTo(-ux * 30 - uy * o, -uy * 30 + ux * o); }
      c.stroke();
      c.globalAlpha /= 0.55;
    }
    if (st.alpha) c.globalAlpha *= st.alpha;
    for (let pass = 0; pass < 2; pass++) { _outline = pass === 0; bodyParts(st, skin, view, p, dy, walking, step); }
    _outline = false;
    if (skin === "holo") { c.fillStyle = "rgba(255,255,255,.22)"; for (let gy = 1; gy < 14; gy += 3) c.fillRect(_ox + 3 * CU, _oy + gy * CU, 6 * CU, 1); } // linhas de varredura
    if (p.glow > 0 && !p.rm) { c.strokeStyle = st.glow; c.lineWidth = 2; c.globalAlpha = 1 - p.glow; c.beginPath(); c.arc(0, 0, 15 + p.glow * 14, 0, Math.PI * 2); c.stroke(); } // brilho de coleta
    c.restore();
  }

  /** Pose do jogador a partir do estado do jogo (tempo decorrido real: independe da taxa de quadros). */
  function drawPlayer() {
    if ((G.state === "ending" || (G.state === "paused" && G.prevState === "ending")) && G.endT > 1.4) return; // já passou pela porta
    const rm = RM();
    let dead = -1;
    if (G.state === "lost") { dead = rm ? 1 : (G.time - G.deadAt) / 0.45; if (dead >= 1) return; } // derrota: animação curta (o reinício não espera por ela)
    POSE.t = G.time; POSE.fx = G.faceV.x; POSE.fy = G.faceV.y; POSE.walk = G.walk; POSE.phase = G.phase;
    POSE.dash = !!G.dash; POSE.rm = rm; POSE.dead = dead;
    const g = (G.time - G.glowAt) / 0.4; POSE.glow = g >= 0 && g < 1 && G.state !== "lost" ? g : 0;
    POSE.win = G.state === "won" || G.state === "finished" || G.state === "ending" || (G.state === "paused" && G.prevState === "ending");
    drawCharacter(ctx, G.pos.x, G.pos.y, equippedSkin(), POSE);
  }

  /* ------------------------------------------------------------------
   * LUZES suaves (sprites de brilho pré-renderizados e reutilizados: nada é criado por quadro)
   * ------------------------------------------------------------------ */
  const glowCache = {};
  function glowSprite(color) {
    let cv = glowCache[color];
    if (cv) return cv;
    cv = document.createElement("canvas"); cv.width = cv.height = 96;
    const c = cv.getContext("2d"), g = c.createRadialGradient(48, 48, 2, 48, 48, 48);
    g.addColorStop(0, color); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, 96, 96);
    return (glowCache[color] = cv);
  }
  function light(x, y, color, radius, alpha) {
    const a = alpha * (RM() ? 1 : 0.88 + 0.12 * Math.sin(G.time * 2 + x * 0.05));
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = a;
    ctx.drawImage(glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }
  /** Luzes suaves na saída, chave, moeda, portais, interruptores e inimigos (só decoração: não escondem nada). */
  function drawLights(lv) {
    const d = lv.door;
    light(d.x, d.y, doorReady(lv) ? "rgba(57,255,136,.55)" : "rgba(150,150,190,.25)", 52, 0.55);
    if (!G.hasKey) light(lv.key.x, lv.key.y, "rgba(255,210,63,.55)", 40, 0.6);
    if (lv.coin && !G.coin) light(lv.coin.x, lv.coin.y, "rgba(255,207,51,.5)", 30, 0.5);
    lv.portals.forEach((pr, i) => { const col = PORTAL_COLORS[i % PORTAL_COLORS.length]; for (const e of [pr.a, pr.b]) light(e.x, e.y, col + "99", 46, 0.55); });
    lv.switches.forEach((sw, i) => { if (!G.rt.sw[i]) light(sw.x, sw.y, (lv.gates[sw.gate].color || GATE_COLORS[sw.gate % GATE_COLORS.length]) + "88", 34, 0.5); });
    for (const dr of lv.drones) { E.dronePos(dr, G.elapsed, DP); light(DP.x, DP.y, "rgba(255,80,100,.45)", 40, 0.45); }
    for (const sn of lv.sentinels) light(sn.x, sn.y, "rgba(255,214,90,.5)", 40, 0.5);
    for (let i = 0; i < lv.chasers.length; i++) { const c = G.rt.ch[i]; light(c.x, c.y, c.state ? "rgba(190,90,255,.6)" : "rgba(160,120,220,.35)", 42, 0.5); }
  }

  /** SENTINELA: cone de visão (raios cortados por paredes/passagens fechadas), alerta e corpo com lente. */
  function drawSentinels(lv) {
    const rm = RM();
    for (let k = 0; k < lv.sentinels.length; k++) {
      const s = lv.sentinels[k], al = G.rt.al[k], ang = E.sentinelAngle(s, G.elapsed), half = s._half;
      const N_RAYS = 28;
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      for (let i = 0; i <= N_RAYS; i++) {
        const a = ang - half + (2 * half * i) / N_RAYS, d = E.castRay(lv, G.rt, s.x, s.y, a, s.range);
        ctx.lineTo(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d);
      }
      ctx.closePath();
      ctx.fillStyle = al > 0 ? `rgba(255,${Math.round(214 - 130 * al)},${Math.round(90 - 40 * al)},${0.16 + 0.22 * al})` : "rgba(255,214,90,.14)";
      ctx.fill();
      ctx.strokeStyle = al > 0.5 ? "rgba(255,110,90,.85)" : "rgba(255,226,130,.75)"; ctx.lineWidth = 2; ctx.stroke(); // limites bem marcados
      // corpo: base hexagonal + cabeça-câmera que gira com o cone
      ctx.save(); ctx.translate(s.x, s.y);
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(0, 12, 14, 5, 0, 0, TAU_G); ctx.fill();
      ctx.fillStyle = "#2c3328"; ctx.strokeStyle = "#a6e35a"; ctx.lineWidth = 2.5;
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + Math.PI / 6; ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * 15, Math.sin(a) * 15); } ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.rotate(ang);
      ctx.fillStyle = "#1a1f16"; ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(-6, -8, 20, 16, 4); ctx.fill(); ctx.stroke(); // cabeça-câmera
      glow("#ffd23f", rm ? 0 : 8); ctx.fillStyle = al > 0.3 ? "#ff5a4d" : "#ffd23f"; ctx.beginPath(); ctx.arc(11, 0, 4, 0, TAU_G); ctx.fill(); noGlow(); // lente
      ctx.restore();
      if (al > 0) { // alerta: anel que enche + símbolo "!" em triângulo (forma, não só cor)
        ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(s.x, s.y, 22, 0, TAU_G); ctx.stroke();
        ctx.strokeStyle = "#ff5a4d"; ctx.beginPath(); ctx.arc(s.x, s.y, 22, -Math.PI / 2, -Math.PI / 2 + TAU_G * al); ctx.stroke();
        ctx.fillStyle = "#ff5a4d"; ctx.beginPath(); ctx.moveTo(s.x, s.y - 40); ctx.lineTo(s.x - 8, s.y - 26); ctx.lineTo(s.x + 8, s.y - 26); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", s.x, s.y - 28);
      }
    }
  }
  const TAU_G = Math.PI * 2;

  /** PERSEGUIDOR: corpo angular com olhos e pernas; círculo pontilhado = raio de detecção; "!" ao sinalizar. */
  function drawChasers(lv) {
    const rm = RM();
    for (let i = 0; i < lv.chasers.length; i++) {
      const cfg = lv.chasers[i], c = G.rt.ch[i];
      if (c.state === 0) { // raio de detecção, discreto no chão
        ctx.strokeStyle = "rgba(190,120,255,.34)"; ctx.lineWidth = 2; ctx.setLineDash([5, 7]);
        ctx.beginPath(); ctx.arc(c.x, c.y, cfg.detect, 0, TAU_G); ctx.stroke(); ctx.setLineDash([]);
      }
      const t = G.time, run = c.state === 2, lean = run && c.pi < c.pl ? 0 : 0;
      ctx.save(); ctx.translate(c.x, c.y);
      ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(0, cfg.r + 4, cfg.r * 0.9, 4, 0, 0, TAU_G); ctx.fill();
      // pernas (alternam enquanto persegue)
      ctx.strokeStyle = "#8a4fd0"; ctx.lineWidth = 3; ctx.lineCap = "round";
      const sw = run && !rm ? Math.sin(t * 14) : 0;
      for (let q = 0; q < 4; q++) { const sx = q < 2 ? -1 : 1, ph = q % 2 ? sw : -sw, lx = sx * (cfg.r + 6), ly = (q % 2 ? 1 : -1) * 6 + ph * 3; ctx.beginPath(); ctx.moveTo(sx * 6, (q % 2 ? 1 : -1) * 4); ctx.lineTo(lx, ly); ctx.stroke(); }
      // corpo: losango arredondado
      const R = cfg.r + 4;
      ctx.fillStyle = c.state === 0 ? "#3b3350" : "#5a2fa8"; ctx.strokeStyle = c.state === 2 ? "#ff7ab8" : "#c28bff"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R, 0); ctx.lineTo(0, R); ctx.lineTo(-R, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      // olhos: fechados (dormindo) / abertos (sinalizando) / vermelhos (perseguindo)
      ctx.strokeStyle = "#fff"; ctx.fillStyle = c.state === 2 ? "#ff3b4d" : "#fff"; ctx.lineWidth = 2;
      if (c.state === 0) { ctx.beginPath(); ctx.moveTo(-6, -1); ctx.lineTo(-2, -1); ctx.moveTo(2, -1); ctx.lineTo(6, -1); ctx.stroke(); }
      else { ctx.beginPath(); ctx.arc(-4, -1, 2.6, 0, TAU_G); ctx.arc(4, -1, 2.6, 0, TAU_G); ctx.fill(); }
      ctx.restore();
      if (c.state === 1) { // sinalização de 0,5 s: anel que fecha + "!"
        const k = Math.min(1, c.timer / E.CHASE_WARN);
        ctx.strokeStyle = "#ffe27a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c.x, c.y, cfg.r + 12, -Math.PI / 2, -Math.PI / 2 + TAU_G * k); ctx.stroke();
        ctx.fillStyle = "#ffe27a"; ctx.beginPath(); ctx.moveTo(c.x, c.y - 38); ctx.lineTo(c.x - 8, c.y - 24); ctx.lineTo(c.x + 8, c.y - 24); ctx.closePath(); ctx.fill();
        ctx.fillStyle = "#2a1a00"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", c.x, c.y - 26);
      }
    }
  }
  /** Medidor de alerta junto ao personagem: mostra a MAIOR sentinela observando (barra + "!"). */
  function drawAlertMeter() {
    const al = G.rt.al; let m = 0; for (let i = 0; i < al.length; i++) if (al[i] > m) m = al[i];
    if (m <= 0 || G.state === "lost") return;
    const x = G.pos.x, y = G.pos.y - 26;
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x - 14, y, 28, 6);
    ctx.fillStyle = m > 0.66 ? "#ff3b4d" : "#ffb02e"; ctx.fillRect(x - 13, y + 1, 26 * m, 4);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x - 14, y, 28, 6);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", x, y - 2);
  }

  /** Drone de patrulha: rota pontilhada discreta com setas; corpo escuro com hélices, olho vermelho e indicador de direção. */
  const DP = { x: 0, y: 0, dx: 0, dy: 0 };
  function drawDrones(lv) {
    const rm = RM();
    for (let k = 0; k < lv.drones.length; k++) {
      const d = lv.drones[k], pts = d._pts;
      ctx.strokeStyle = "rgba(255,120,135,.42)"; ctx.lineWidth = 2; ctx.setLineDash([2, 8]);
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) { if (i) ctx.lineTo(pts[i].x, pts[i].y); else ctx.moveTo(pts[i].x, pts[i].y); }
      ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,150,165,.5)"; // setas no meio de cada trecho mostram o sentido
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ang = Math.atan2(b.y - a.y, b.x - a.x);
        ctx.save(); ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      E.dronePos(d, G.elapsed, DP);
      const R = d.r + 5, fl = rm ? 0 : Math.sin(G.time * 3 + k * 1.7) * 2; // flutuação
      ctx.fillStyle = "rgba(0,0,0,.28)"; // sombra no chão (mostra que flutua)
      ctx.beginPath(); ctx.ellipse(DP.x, DP.y + R + 9, R * 0.8, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.translate(DP.x, DP.y + fl);
      const spin = rm ? 0.6 : G.time * 22;
      ctx.strokeStyle = "#8d93a8"; ctx.lineWidth = 2;
      for (let q = 0; q < 4; q++) { // 4 braços com hélices
        const a = Math.PI / 4 + (q * Math.PI) / 2, ex = Math.cos(a) * (R + 3), ey = Math.sin(a) * (R + 3);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(spin + q); ctx.fillStyle = "rgba(200,205,225,.75)"; ctx.fillRect(-6, -1.2, 12, 2.4); ctx.restore();
      }
      glow("#ff3b4d", 10);
      ctx.fillStyle = "#2a2d3d"; ctx.strokeStyle = "#ff5a6e"; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      noGlow();
      ctx.fillStyle = "#ff3b4d"; ctx.beginPath(); ctx.arc(DP.dx * 2, DP.dy * 2, 6, 0, Math.PI * 2); ctx.fill(); // olho
      ctx.fillStyle = "#fff"; ctx.fillRect(DP.dx * 4 - 1, DP.dy * 4 - 1, 2, 2);
      ctx.save(); ctx.rotate(Math.atan2(DP.dy, DP.dx)); // indicador de direção na borda
      ctx.fillStyle = "#ffd6dc"; ctx.beginPath(); ctx.moveTo(R + 6, 0); ctx.lineTo(R - 1, -5); ctx.lineTo(R - 1, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      ctx.restore();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    for (const r of rings) {
      const k = r.age / r.dur;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r.x, r.y, 8 + (r.maxR - 8) * k, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Fragmentos da missão "coleta completa": losangos azul-claros (formato próprio, diferente de chave e moeda). */
  function drawFragments(lv) {
    for (let i = 0; i < lv.fragments.length; i++) {
      if (G.frag & (1 << i)) continue;
      const f = lv.fragments[i], bob = wave(3, 2.5);
      light(f.x, f.y, "rgba(120,240,255,.6)", 30, 0.55);
      ctx.save(); ctx.translate(f.x, f.y + bob);
      glow("#7ff3ff", 12);
      ctx.fillStyle = "#c9fbff"; ctx.strokeStyle = "#19c8e8"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(7, 0); ctx.lineTo(0, 10); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      noGlow(); ctx.restore();
    }
  }
  /** Indicador da missão (canto da sala): só o que a missão precisa mostrar. */
  function drawMissionBadge(lv) {
    if (G.mission < 0) return;
    const g = lv.mission.goal;
    let t = "";
    if (g === "noDash") t = "🚫 SEM IMPULSO";
    else if (g === "collect") t = `◆ ${bitCount(G.frag)}/${lv.fragments.length} fragmentos${G.hasKey ? " · chave ✔" : " · falta a chave"}`;
    else if (g === "stealth") t = "👁 FURTIVO";
    else if (g === "nonstop") t = "⏱ SEM PARAR";
    ctx.font = "bold 14px 'Trebuchet MS', sans-serif"; ctx.textAlign = "left";
    const w = ctx.measureText(t).width + 18;
    ctx.fillStyle = "rgba(7,6,15,.72)"; ctx.beginPath(); ctx.roundRect(8, 8, w, 26, 8); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.fillText(t, 17, 26);
    if (G.time - G.noDashMsgAt < 1.2) { // tentou o impulso numa missão sem impulso
      ctx.fillStyle = "rgba(255,90,80,.92)"; ctx.textAlign = "center"; ctx.fillText("Impulso desativado nesta missão", E.WORLD_W / 2, 56);
    }
  }
  const bitCount = (m) => { let c = 0; for (; m; m &= m - 1) c++; return c; };
  /** "Sem parar": barra junto ao personagem quando perto do limite de 1 s parado. */
  function drawStillMeter(lv) {
    if (!lv.nonstop || G.state !== "playing" || G.stillT < 0.4) return;
    const k = Math.min(1, G.stillT / NONSTOP_MAX), x = G.pos.x, y = G.pos.y - 28;
    ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(x - 16, y, 32, 7);
    ctx.fillStyle = k > 0.75 ? "#ff3b4d" : "#ffb02e"; ctx.fillRect(x - 15, y + 1, 30 * k, 5);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.strokeRect(x - 16, y, 32, 7);
    ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center"; ctx.fillText("⏸ MEXA-SE!", x, y - 3);
  }

  function draw() {
    if (!canvas.width) return;
    const lv = lvAt(G.levelIdx);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.save();
    const z = camZoom();
    if (z > 1.001) { // aproximação nas transições; o centro fica dentro da sala (nada fora do mapa aparece)
      const hw = E.WORLD_W / (2 * z), hh = E.WORLD_H / (2 * z);
      const cx = Math.max(hw, Math.min(E.WORLD_W - hw, G.pos.x)), cy = Math.max(hh, Math.min(E.WORLD_H - hh, G.pos.y));
      ctx.translate(E.WORLD_W / 2, E.WORLD_H / 2); ctx.scale(z, z); ctx.translate(-cx, -cy);
    }
    if (G.shake > 0 && !RM()) ctx.translate((Math.random() - 0.5) * 20 * G.shake, (Math.random() - 0.5) * 20 * G.shake);
    drawBackground();
    drawIce(lv);
    drawBelts(lv);
    drawWalls(lv);
    drawGates(lv);
    drawSpikes(lv);
    drawLasers(lv);
    drawMovers(lv);
    drawLights(lv);
    drawSentinels(lv);
    drawChasers(lv);
    drawDrones(lv);
    drawSwitches(lv);
    drawPortals(lv);
    drawDoor(lv);
    drawKey(lv);
    drawFragments(lv);
    drawCoin(lv);
    drawTrail();
    drawPlayer();
    drawAlertMeter();
    drawStillMeter(lv);
    if (!G.noDash) drawDashHint();
    drawParticles();
    ctx.restore();
    drawMissionBadge(lv);
    if (G.fade > 0) { ctx.fillStyle = `rgba(8,6,18,${Math.min(1, G.fade / 0.35) * 0.9})`; ctx.fillRect(0, 0, E.WORLD_W, E.WORLD_H); } // transição breve (escuro, sem flash)
    if (G.flash > 0 && !RM()) { ctx.fillStyle = `rgba(255,45,85,${G.flash * 0.3})`; ctx.fillRect(0, 0, E.WORLD_W, E.WORLD_H); }
    if (G.state === "ending" || (G.state === "paused" && G.prevState === "ending")) drawEnding(lv);
  }

  /** Sequência de fuga: o personagem corre à porta, ela abre, a luz toma a tela e aparece o título. */
  function drawEnding(lv) {
    const t = G.endT, d = lv.door;
    if (t > 1.2) { // feixe de luz saindo da porta
      const k = Math.min(1, (t - 1.2) / 1.0);
      const g = ctx.createRadialGradient(d.x, d.y, 4, d.x, d.y, 60 + 520 * k);
      g.addColorStop(0, `rgba(255,255,255,${0.9 * k})`); g.addColorStop(1, "rgba(180,255,220,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, E.WORLD_W, E.WORLD_H);
    }
    if (t > 2.2) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.92, (t - 2.2) / 1.6)})`; ctx.fillRect(0, 0, E.WORLD_W, E.WORLD_H); }
    if (t > 2.8) {
      ctx.globalAlpha = Math.min(1, (t - 2.8) / 0.8);
      ctx.fillStyle = "#0a0818"; ctx.textAlign = "center"; ctx.font = "bold 54px 'Trebuchet MS', sans-serif";
      ctx.fillText("VOCÊ ESCAPOU!", E.WORLD_W / 2, E.WORLD_H / 2);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------
   * 9. LOOP
   * ------------------------------------------------------------------ */
  let lastTs = 0;
  function frame(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0;
    lastTs = ts;
    if (G.state !== "paused") update(dt); // pausado: nada avança (serras, lasers, animações)
    draw();
    requestAnimationFrame(frame);
  }

  // Ganchos para testes automatizados (não afetam o jogo).
  /* ------------------------------------------------------------------
   * API para o editor de fases (editor.js): testar uma sala feita no editor com o MESMO motor.
   * ------------------------------------------------------------------ */
  function startCustomTest(level, back, onWin) {
    customLv = E.normalize(level);
    customBack = back; customWin = onWin || null;
    G.mission = -1; G.custom = true; G.winCam = null;
    G.state = "brief";
    const brief = () => showOverlay({
      title: "Testar fase",
      text: `${customLv.name}\nTempo por sala: ${fmtLimit(S.limit)}\nEncontrar um caminho no editor não garante concluir dentro desse tempo.\nNada deste teste vale moedas, medalhas, skins ou recordes.`,
      primary: { label: "Começar teste", fn: () => { loadLevel(CUSTOM_IDX); G.fade = RM() ? 0 : 0.35; beginAttempt(); } },
      secondary: { label: "Voltar ao editor", fn: () => back && back() },
      tertiary: { label: "Tempo por sala ⏱", fn: () => openTimePanel({ mode: "select", back: brief, onDone: brief }) },
    });
    brief();
  }
  /** Recarrega tudo o que vem do armazenamento (depois de importar ou apagar um backup). */
  function reloadAll() {
    loadSettings(); applySettings(); loadProgress(); loadMissions();
    const st = G.state;
    if (st !== "menu") { G.winCam = null; G.custom = false; customBack = null; }
  }
  /* Teclado: com qualquer tela aberta, HUD e controles de toque saem da ordem de Tab (inert). */
  const panelEls = [overlayEl, selectEl, settingsEl, timeEl, charEl, missEl, ...document.querySelectorAll(".ed-panel")];
  function syncInert() {
    const open = panelEls.some((el) => !el.classList.contains("hidden"));
    ["hud", "controls"].forEach((id) => { const el = $(id); if (el) el.inert = open; });
  }
  const focusables = [selectEl, timeEl, charEl, missEl]; // painéis que não são do editor: foco vai ao primeiro controle ao abrir (teclado)
  const inertObs = new MutationObserver((recs) => {
    syncInert();
    for (const r of recs) {
      const el = r.target;
      if (focusables.includes(el) && !el.classList.contains("hidden") && !el.contains(document.activeElement)) { const f = el.querySelector("button:not(:disabled), input:not(:disabled)"); if (f) f.focus({ preventScroll: true }); }
    }
  });
  panelEls.forEach((el) => inertObs.observe(el, { attributes: true, attributeFilter: ["class"] }));
  syncInert();

  window.GameAPI = {
    reloadAll, showHowTo, N, MISSIONS, SKIN_IDS, openSettingsAgain: () => openSettings(settingsBack), getSettingsBack: () => settingsBack, clearSettingsBack: () => { settingsBack = null; }, hideSettings: () => settingsEl.classList.add("hidden"),
    G, S, E, showOverlay, hideOverlay, openTimePanel, fmtLimit, releaseInput, showMenu, RM, Sfx, startCustomTest, drawCharacter, equippedSkin,
    setState: (st) => { G.state = st; G.custom = false; hideOverlay(); },
    leaveTest: () => { G.custom = false; customBack = null; customWin = null; },
  };

  window.__game = { startCustomTest, CUSTOM_IDX, MP, MISSIONS, missionReq, missionAvail, missionsUnlocked, openMissions, openBrief, startMission, loadMissions, saveMissions, lvAt, skipCam, finishWinCam, camZoom, G, P, S, SKINS, skinProgress, unlockedSkinIds, equippedSkin, openCharacter, closeCharacter, drawCharacter, POSE, CORE_N, LEVELS, openTimePanel, readTimeChoice, bestFor, fmtLimit, E, inputVector, keys, step: update, retry, pause: pauseIfNeeded, resume, openSelect, enterLevel, showMenu, loadProgress, draw, tryDash, saveProgress, S, Sfx, applySettings, openSettings, closeSettings, skipEnding, sectorOf, RM };

  applySettings(); // preferências salvas valem já na primeira tela
  resize();
  showMenu();
  requestAnimationFrame(frame);
})();
