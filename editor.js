/* =====================================================================
 * editor.js — interface do EDITOR DE FASES: editor em grade, "Minhas fases" e "Importar fase".
 * Toda a lógica de dados (grade, validação, código, armazenamento) está em mapkit.js; o teste de uma
 * fase usa o MESMO motor do jogo (GameAPI.startCustomTest em game.js).
 * ===================================================================== */
(function () {
  "use strict";
  const API = window.GameAPI, MK = window.MapKit;
  const $ = (id) => document.getElementById(id);
  const { COLS, ROWS, CELL } = MK;
  const PANELS = ["editor", "mymaps", "importer"];
  const OTHERS = ["select", "settings", "timesel", "charsel", "missions"];

  const TOOLS = [
    { g: "Estrutura", id: "wall", label: "Parede", icon: "▦" },
    { g: "Estrutura", id: "floor", label: "Piso", icon: "▢" },
    { g: "Objetivos", id: "start", label: "Início", icon: "🙂" },
    { g: "Objetivos", id: "key", label: "Chave", icon: "🗝" },
    { g: "Objetivos", id: "door", label: "Saída", icon: "🚪" },
    { g: "Perigos", id: "spike", label: "Espinhos", icon: "▲" },
    { g: "Perigos", id: "laser", label: "Laser", icon: "⚡" },
    { g: "Perigos", id: "drone", label: "Drone", icon: "🛸" },
    { g: "Mecanismos", id: "portal", label: "Portal", icon: "◎" },
    { g: "Mecanismos", id: "switch", label: "Interruptor", icon: "⏻" },
    { g: "Mecanismos", id: "gate", label: "Porta", icon: "▥" },
    { g: "Edição", id: "select", label: "Selecionar", icon: "☝" },
    { g: "Edição", id: "eraser", label: "Borracha", icon: "⌫" },
  ];
  const TOOL_HELP = {
    wall: "Parede: bloqueia o personagem. Arraste para pintar.",
    floor: "Piso: apaga parede/espinhos e deixa o chão livre. Arraste para pintar.",
    start: "Início: onde o personagem começa (só um; mover apaga o anterior).",
    key: "Chave: precisa ser pega antes da saída (só uma).",
    door: "Saída: porta de 2x2 quadrados (só uma).",
    spike: "Espinhos: causam derrota ao tocar. Arraste para pintar.",
    laser: "Laser: toque num quadrado para criar; ajuste direção, tamanho e tempos no painel. Toque num laser para selecioná-lo.",
    drone: "Drone: toque para criar o 1º ponto da rota e continue tocando para acrescentar pontos. Toque num ponto para selecioná-lo.",
    portal: "Portal: toque para colocar uma ponta; a 2ª ponta fecha o par (até 3 pares).",
    switch: "Interruptor: toque para colocar; depois ligue-o a portas no painel (ou coloque portas com ele selecionado).",
    gate: "Porta controlada (2x2): toque para colocar; com um interruptor selecionado ela já fica ligada a ele.",
    select: "Selecionar: toque num elemento para ver e editar suas propriedades.",
    eraser: "Borracha: apaga o elemento do quadrado (ou o terreno). Arraste para apagar terreno.",
  };
  const KIND_NAME = { start: "Início", key: "Chave", door: "Saída", portal: "Portal", switch: "Interruptor", gate: "Porta controlada", laser: "Laser", drone: "Drone" };
  const DRONE_COL = ["#ff5c8a", "#ffb347", "#7cf5ff", "#c3ff6b"];
  const SWC = MK.SW_COL;

  let ED = null; // estado do editor
  let msgTimer = 0;
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const portalName = (i) => `${MK.PORTAL_LET[i]} ${MK.PORTAL_SYM[i]}`;

  /* ---------------- painéis ---------------- */
  function hideAll() {
    PANELS.forEach((p) => $(p).classList.add("hidden"));
    OTHERS.forEach((p) => $(p).classList.add("hidden"));
    document.body.classList.remove("editing", "ed-lists");
    API.hideOverlay();
  }
  function showPanel(id) {
    hideAll();
    $(id).classList.remove("hidden");
    document.body.classList.toggle("editing", id === "editor");
    document.body.classList.toggle("ed-lists", id !== "editor"); // listas: sem o direcional embaixo
    API.releaseInput();
    API.G.state = "editor"; // nada do jogo avança enquanto edita (e pausa/troca de app não afetam o mapa)
    API.G.custom = false;
  }
  function toMenu() { hideAll(); API.showMenu(); }

  /* ---------------- desenho (editor e prévias) ---------------- */
  function drawMap(cv, map, opts) {
    opts = opts || {};
    const ctx = cv.getContext("2d"), k = cv.width / 800, big = !!opts.grid;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = "#0b0920"; ctx.fillRect(0, 0, 800, 500);
    ctx.fillStyle = "rgba(255,255,255,.03)"; // piso em placas
    for (let r = 0; r < ROWS; r++) for (let c = (r % 2); c < COLS; c += 2) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const t = map.cells[MK.idx(c, r)], x = c * CELL, y = r * CELL;
      if (t === MK.WALL) { ctx.fillStyle = "#1a1f55"; ctx.fillRect(x, y, CELL, CELL); ctx.strokeStyle = "#6c7bff"; ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, CELL - 1.5, CELL - 1.5); }
      else if (t === MK.SPIKE) { ctx.fillStyle = "rgba(255,45,85,.18)"; ctx.fillRect(x, y, CELL, CELL); ctx.fillStyle = "#ff2d55"; ctx.beginPath(); ctx.moveTo(x + 2, y + CELL - 2); ctx.lineTo(x + CELL / 2, y + 3); ctx.lineTo(x + CELL - 2, y + CELL - 2); ctx.closePath(); ctx.fill(); }
    }
    if (opts.grid) { ctx.strokeStyle = "rgba(120,130,255,.22)"; ctx.lineWidth = 1; ctx.beginPath(); for (let c = 0; c <= COLS; c++) { ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, 500); } for (let r = 0; r <= ROWS; r++) { ctx.moveTo(0, r * CELL); ctx.lineTo(800, r * CELL); } ctx.stroke(); }
    const ctr = (p) => ({ x: p.c * CELL + CELL / 2, y: p.r * CELL + CELL / 2 });
    const label = (t, x, y, col, size) => { ctx.font = `bold ${size || 11}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 3; ctx.strokeStyle = "#07060f"; ctx.strokeText(t, x, y); ctx.fillStyle = col || "#fff"; ctx.fillText(t, x, y); };
    const sel = opts.sel || null;
    const isSel = (kind, i) => sel && sel.kind === kind && sel.i === i;
    // --- conexões interruptor -> portas (símbolo + cor); mais fortes quando o interruptor ou a porta está selecionado
    map.switches.forEach((s, si) => {
      const col = SWC[si % SWC.length], a = ctr(s);
      s.gates.forEach((gid) => {
        const gi = map.gates.findIndex((g) => g.id === gid); if (gi < 0) return;
        const g = map.gates[gi], hot = isSel("switch", si) || isSel("gate", gi);
        ctx.strokeStyle = col; ctx.globalAlpha = hot ? 0.95 : 0.4; ctx.lineWidth = hot ? 3 : 1.5; ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(g.c * CELL + CELL, g.r * CELL + CELL); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      });
    });
    // --- portas controladas
    map.gates.forEach((g, gi) => {
      const o = MK.ownerOf(map, g.id), col = o >= 0 ? SWC[o % SWC.length] : "#8a86b8", x = g.c * CELL, y = g.r * CELL;
      ctx.fillStyle = "rgba(20,14,5,.85)"; ctx.fillRect(x, y, 2 * CELL, 2 * CELL);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, 2 * CELL, 2 * CELL); ctx.clip(); ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath();
      for (let q = -40; q < 40; q += 10) { ctx.moveTo(x + q, y + 40); ctx.lineTo(x + q + 40, y); } ctx.stroke(); ctx.restore();
      ctx.strokeStyle = o >= 0 ? col : "#ff8a4d"; ctx.lineWidth = 3; if (o < 0) ctx.setLineDash([5, 4]); ctx.strokeRect(x + 1.5, y + 1.5, 2 * CELL - 3, 2 * CELL - 3); ctx.setLineDash([]);
      if (big || o < 0) label(o >= 0 ? `P${gi + 1}·S${o + 1}` : `P${gi + 1} ?`, x + CELL, y + CELL, "#fff", big ? 11 : 16);
    });
    // --- interruptores
    map.switches.forEach((s, si) => {
      const col = SWC[si % SWC.length], p = ctr(s);
      ctx.fillStyle = "#17142e"; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(p.x - 8, p.y - 8, 16, 16, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2); ctx.fill();
      if (big || !s.gates.length) label(`S${si + 1}`, p.x, p.y - 15, col, big ? 11 : 16);
    });
    // --- portais: anel + letra/símbolo + linha entre as pontas
    map.portals.forEach((pr, i) => {
      const col = MK.PORTAL_COL[i % 3], nm = portalName(i);
      if (pr.a && pr.b) { const a = ctr(pr.a), b = ctr(pr.b); ctx.strokeStyle = col; ctx.globalAlpha = 0.55; ctx.lineWidth = isSel("portal", i) ? 3.5 : 2; ctx.setLineDash([3, 8]); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
      ["a", "b"].forEach((end, n) => {
        const e = pr[end]; if (!e) return; const p = ctr(e), ok = pr.a && pr.b;
        ctx.strokeStyle = ok ? col : "#ff3b4d"; ctx.fillStyle = ok ? col : "#ff3b4d"; ctx.lineWidth = 3; if (!ok) ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 0.2; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        if (big || !ok) label(`${nm}${ok ? "" : "?"}`, p.x, p.y, "#fff", big ? 10 : 15);
      });
    });
    // --- lasers: extensão REAL (para na parede); vermelho cheio = começa ligado; contorno tracejado = começa apagado
    map.lasers.forEach((L, i) => {
      const e = MK.laserExtent(map, L); if (!e.real) { const p = ctr(L); label("✖", p.x, p.y, "#ff3b4d", 14); return; }
      const rc = e.rect, hot = isSel("laser", i);
      ctx.fillStyle = L.init === "on" ? "rgba(255,59,77,.55)" : "rgba(255,59,77,.18)"; ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      ctx.strokeStyle = "#ff3b4d"; ctx.lineWidth = hot ? 3 : 1.8; if (L.init !== "on") ctx.setLineDash([5, 3]); ctx.strokeRect(rc.x, rc.y, rc.w, rc.h); ctx.setLineDash([]);
      const a = L.dir === "h" ? { x: rc.x, y: rc.y + rc.h / 2 } : { x: rc.x + rc.w / 2, y: rc.y }, b = L.dir === "h" ? { x: rc.x + rc.w, y: rc.y + rc.h / 2 } : { x: rc.x + rc.w / 2, y: rc.y + rc.h };
      ctx.fillStyle = "#ffd0d6"; for (const q of [a, b]) { ctx.beginPath(); ctx.arc(q.x, q.y, 4.5, 0, Math.PI * 2); ctx.fill(); }
      if (e.real < L.len) label("✂", b.x + (L.dir === "h" ? 8 : 0), b.y + (L.dir === "v" ? 8 : 0), "#ffd23f", 12); // cortado por parede
      if (big) label(`L${i + 1} ${L.on}s/${L.off}s`, (a.x + b.x) / 2, rc.y - 7, "#ff9aa6", 10);
    });
    // --- drones: rota (ponto 1 preenchido), setas, fechamento do circuito tracejado
    map.drones.forEach((d, i) => {
      const col = DRONE_COL[i % 4], pts = d.route.map(ctr), hot = isSel("drone", i);
      ctx.strokeStyle = col; ctx.lineWidth = hot ? 3.5 : 2; ctx.globalAlpha = hot ? 1 : 0.8;
      for (let n = 0; n + 1 < pts.length; n++) { ctx.beginPath(); ctx.moveTo(pts[n].x, pts[n].y); ctx.lineTo(pts[n + 1].x, pts[n + 1].y); ctx.stroke(); arrow(ctx, pts[n], pts[n + 1], col); }
      if (d.mode === "loop" && pts.length > 2) { ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y); ctx.lineTo(pts[0].x, pts[0].y); ctx.stroke(); ctx.setLineDash([]); arrow(ctx, pts[pts.length - 1], pts[0], col); }
      ctx.globalAlpha = 1;
      pts.forEach((p, n) => {
        const cur = hot && sel.pt === n;
        ctx.fillStyle = n === 0 ? col : "#0b0920"; ctx.strokeStyle = cur ? "#fff" : col; ctx.lineWidth = cur ? 3 : 2; ctx.beginPath(); ctx.arc(p.x, p.y, n === 0 ? 8 : 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (big) label(String(n + 1), p.x, p.y - (n === 0 ? 14 : 12), col, 10);
      });
      if (pts.length) { ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, MK.DRONE_R, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; } // tamanho de colisão
      if (big && pts.length > 1) label(`D${i + 1} ${d.mode === "loop" ? "⟲" : "↔"}`, pts[0].x + 20, pts[0].y - 16, col, 10);
    });
    if (map.door) { const d = map.door; ctx.fillStyle = "rgba(57,255,136,.2)"; ctx.strokeStyle = "#39ff88"; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(d.c * CELL + 2, d.r * CELL + 2, 2 * CELL - 4, 2 * CELL - 4, 8); ctx.fill(); ctx.stroke(); ctx.fillStyle = "#b8ffd6"; ctx.fillRect(d.c * CELL + CELL - 5, d.r * CELL + 12, 10, 2 * CELL - 14); }
    if (map.key) { const x = map.key.c * CELL + CELL / 2, y = map.key.r * CELL + CELL / 2; ctx.strokeStyle = "#ffd23f"; ctx.fillStyle = "#ffd23f"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(x - 4, y, 4.5, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 8, y); ctx.moveTo(x + 5, y); ctx.lineTo(x + 5, y + 4); ctx.stroke(); }
    if (map.start) { const x = map.start.c * CELL + CELL / 2, y = map.start.r * CELL + CELL / 2; ctx.fillStyle = "#19f0ff"; ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#06222c"; ctx.fillRect(x - 5, y - 3, 3, 5); ctx.fillRect(x + 2, y - 3, 3, 5); }
    const mark = (list, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash(dash); for (const p of list) for (const i of p.cells) ctx.strokeRect((i % COLS) * CELL + 1.5, ((i / COLS) | 0) * CELL + 1.5, CELL - 3, CELL - 3); ctx.setLineDash([]); };
    if (opts.warnings && opts.warnings.length) mark(opts.warnings, "#ffd23f", [2, 4]);
    if (opts.problems && opts.problems.length) mark(opts.problems, "#ff3b4d", [5, 4]); // problemas destacados (contorno vermelho tracejado)
    if (sel) { // elemento selecionado: contorno branco
      const box = selBox(map, sel);
      if (box) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.setLineDash([4, 3]); ctx.strokeRect(box.x - 3, box.y - 3, box.w + 6, box.h + 6); ctx.setLineDash([]); }
    }
    if (opts.cursor) { ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 3; ctx.strokeRect(opts.cursor.c * CELL + 1, opts.cursor.r * CELL + 1, CELL - 2, CELL - 2); }
    ctx.strokeStyle = "#19f0ff"; ctx.lineWidth = opts.grid ? 4 : 6; ctx.strokeRect(1, 1, 798, 498); // limite da área jogável
    if (opts.grid) { ctx.fillStyle = "rgba(25,240,255,.75)"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillText("limite da área jogável", 790, 494); }
  }
  function arrow(ctx, a, b, col) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 26) return;
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(mx + Math.cos(ang) * 6, my + Math.sin(ang) * 6); ctx.lineTo(mx + Math.cos(ang + 2.5) * 6, my + Math.sin(ang + 2.5) * 6); ctx.lineTo(mx + Math.cos(ang - 2.5) * 6, my + Math.sin(ang - 2.5) * 6); ctx.closePath(); ctx.fill();
  }
  function selBox(m, s) {
    const cell = (p) => ({ x: p.c * CELL, y: p.r * CELL, w: CELL, h: CELL });
    if (s.kind === "start" || s.kind === "key") return m[s.kind] && cell(m[s.kind]);
    if (s.kind === "door") return m.door && { x: m.door.c * CELL, y: m.door.r * CELL, w: 2 * CELL, h: 2 * CELL };
    if (s.kind === "gate") return m.gates[s.i] && MK.gateRect(m.gates[s.i]);
    if (s.kind === "switch") return m.switches[s.i] && cell(m.switches[s.i]);
    if (s.kind === "portal") { const e = m.portals[s.i] && m.portals[s.i][s.end]; return e && cell(e); }
    if (s.kind === "laser") { const L = m.lasers[s.i]; if (!L) return null; const e = MK.laserExtent(m, L); return e.real ? e.rect : cell(L); }
    if (s.kind === "drone") { const d = m.drones[s.i]; if (!d) return null; const p = d.route[s.pt == null ? 0 : s.pt]; return p && cell(p); }
    return null;
  }

  /* ---------------- editor ---------------- */
  function say(text, err) {
    const m = $("ed-msg"); m.textContent = text || ""; m.classList.toggle("err", !!err);
    clearTimeout(msgTimer); if (text) msgTimer = setTimeout(() => { m.textContent = ""; }, 6000);
  }
  function openEditor(map) {
    ED = { map: map ? MK.cloneMap(map) : MK.newMap(), tool: "wall", sel: null, moving: null, cursor: { c: 20, r: 12 }, undo: [], redo: [], dirty: false, problems: [], warnings: [], stroke: null, ptr: null, chk: null };
    $("ed-name").value = ED.map.name || "";
    buildTools();
    showPanel("editor");
    $("ed-helptext").classList.add("hidden"); $("ed-help").setAttribute("aria-expanded", "false");
    sizeCanvas(); refresh();
    say(ED.map.id ? "" : "Escolha uma ferramenta e toque na grade. Coloque início, chave e saída.");
  }
  function resume() { // volta do teste: o mapa em ED não foi tocado
    API.leaveTest();
    showPanel("editor");
    sizeCanvas(); refresh();
    say(MK.proofOk(ED.map) ? `De volta ao editor. Conclusão registrada para esta revisão (limite ${API.fmtLimit(ED.map.proof.limit)}, ${ED.map.proof.time.toFixed(2)} s). Salve para guardar.` : "De volta ao editor: seu mapa continua como estava.");
  }
  function buildTools() {
    const box = $("ed-tools"); box.textContent = "";
    const groups = [...new Set(TOOLS.map((t) => t.g))];
    groups.forEach((g) => {
      const wrap = document.createElement("div"); wrap.className = "tg"; wrap.setAttribute("role", "radiogroup"); wrap.setAttribute("aria-label", g);
      const h = document.createElement("span"); h.className = "tg-h"; h.textContent = g; wrap.appendChild(h);
      const row = document.createElement("div"); row.className = "tg-b";
      TOOLS.filter((t) => t.g === g).forEach((t) => {
        const b = document.createElement("button");
        b.type = "button"; b.setAttribute("role", "radio"); b.dataset.tool = t.id; b.setAttribute("aria-checked", String(ED.tool === t.id));
        b.setAttribute("aria-label", `${t.label}. ${TOOL_HELP[t.id]}`);
        b.innerHTML = `<b>${t.icon}</b><span>${t.label}</span>`;
        b.addEventListener("click", () => { ED.tool = t.id; ED.moving = null; box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.tool === ED.tool))); say(TOOL_HELP[t.id]); renderProps(); });
        row.appendChild(b);
      });
      wrap.appendChild(row); box.appendChild(wrap);
    });
  }
  function setTool(id) { ED.tool = id; $("ed-tools").querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.tool === id))); }

  /* --- estado e verificação (estrutura -> percurso -> teste jogável) --- */
  function check() { syncName(); ED.chk = MK.validate(ED.map); return ED.chk; }
  let chkTimer = 0;
  function scheduleCheck() { clearTimeout(chkTimer); chkTimer = setTimeout(() => { if (ED && !$("editor").classList.contains("hidden")) { check(); status(); } }, 350); }
  function status() {
    const m = ED.map, c = ED.chk, el = $("ed-status");
    const proof = MK.proofOk(m);
    let t, cls;
    if (!m.start || !m.key || !m.door) { t = "Rascunho incompleto"; cls = "draft"; }
    else if (!c) { t = "Verificando…"; cls = "draft"; }
    else if (!c.ok) { t = `Rascunho: ${pl(c.errors.length, "erro", "erros")}`; cls = "draft"; }
    else if (proof) { t = `Concluída por você (${API.fmtLimit(m.proof.limit)})`; cls = "ok"; }
    else { t = "Estrutura e percurso OK · falta concluir no teste"; cls = "ok"; }
    if (c && c.ok && c.warnings.length) t += ` · ${pl(c.warnings.length, "aviso", "avisos")}`;
    if (m.proof && !proof) t += " · conclusão antiga invalidada";
    el.textContent = t + (ED.dirty ? " · ● não salva" : m.id ? " · salva" : "");
    el.className = "ed-status " + cls;
  }
  function refresh() {
    ED.problems = []; ED.warnings = []; ED.chk = null;
    $("ed-undo").disabled = !ED.undo.length; $("ed-redo").disabled = !ED.redo.length;
    fixSel(); status(); render(); renderProps(); scheduleCheck();
  }
  function render() { const cv = $("ed-canvas"); if (cv.width) drawMap(cv, ED.map, { grid: true, problems: ED.problems, warnings: ED.warnings, sel: ED.sel, cursor: document.activeElement === cv ? ED.cursor : null }); }
  function sizeCanvas() {
    const wrap = $("ed-wrap"), cv = $("ed-canvas");
    const w = wrap.clientWidth, h = Math.max(wrap.clientHeight, 140);
    if (w < 40) return;
    const s = Math.min(w / 800, h / 500), dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.floor(800 * s), ch = Math.floor(500 * s);
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    render();
  }
  new ResizeObserver(sizeCanvas).observe($("ed-wrap"));
  window.addEventListener("resize", sizeCanvas);

  /* --- histórico por instantâneos do mapa inteiro (terreno + elementos + propriedades + ligações). Ação = um arrasto ou uma edição --- */
  const sigOf = (m) => MK.gameSig(m) + "|" + (m.proof ? m.proof.sig + m.proof.limit : "");
  function pushHistory(before) { ED.undo.push(before); if (ED.undo.length > 100) ED.undo.shift(); ED.redo = []; ED.dirty = true; }
  /** Executa uma edição como UMA ação desfazível (só entra no histórico se algo mudou). */
  function act(fn) {
    const before = MK.cloneMap(ED.map), s0 = sigOf(ED.map);
    const msg = fn();
    if (sigOf(ED.map) !== s0) pushHistory(before);
    refresh();
    if (msg) say(msg, /^(Não|Sem|Falta|Máximo|Esse|Há)/.test(msg));
  }
  function applyHistory(from, to) { if (!ED || !from.length) return; const cur = MK.cloneMap(ED.map); ED.map = from.pop(); to.push(cur); ED.map.name = MK.cleanName($("ed-name").value).trim() || ED.map.name; ED.dirty = true; ED.moving = null; refresh(); }
  const undo = () => ED && applyHistory(ED.undo, ED.redo);
  const redo = () => ED && applyHistory(ED.redo, ED.undo);
  $("ed-undo").addEventListener("click", undo);
  $("ed-redo").addEventListener("click", redo);

  /* --- seleção --- */
  function exists(s) { return !!s && !!selBox(ED.map, s); }
  function fixSel() { if (ED.sel && !exists(ED.sel)) ED.sel = null; if (ED.moving && !exists(ED.moving.ref)) ED.moving = null; }
  const gl = () => ED.map.gates, sw = () => ED.map.switches;
  function describe(e) {
    const m = ED.map;
    switch (e.kind) {
      case "portal": return `Portal ${portalName(e.i)} (ponta ${e.end === "a" ? 1 : 2})`;
      case "switch": return `Interruptor ${e.i + 1}`;
      case "gate": return `Porta controlada ${e.i + 1}`;
      case "laser": return `Laser ${e.i + 1}`;
      case "drone": return `Drone ${e.i + 1}` + (e.pt != null ? ` · ponto ${e.pt + 1}` : "");
      default: return KIND_NAME[e.kind] || e.kind;
    }
  }
  function allElements() {
    const m = ED.map, out = [];
    m.portals.forEach((p, i) => ["a", "b"].forEach((end) => { if (p[end]) out.push({ kind: "portal", i, end }); }));
    m.switches.forEach((_, i) => out.push({ kind: "switch", i }));
    m.gates.forEach((_, i) => out.push({ kind: "gate", i }));
    m.lasers.forEach((_, i) => out.push({ kind: "laser", i }));
    m.drones.forEach((_, i) => out.push({ kind: "drone", i, pt: 0 }));
    return out;
  }

  /* --- ações por ferramenta (cada toque/arrasto vira uma ação desfazível) --- */
  const occ = (c, r) => { // ocupante de um quadrado (feixes de laser só contam na origem: paredes podem cortá-los)
    const e = MK.elementAt(ED.map, c, r); if (!e) return null;
    if (e.kind === "laser") { const L = ED.map.lasers[e.i]; return L.c === c && L.r === r ? e : null; }
    return e;
  };
  const solidAt = (c, r) => ED.map.cells[MK.idx(c, r)] !== MK.FLOOR;
  const BUSY = "Há um elemento neste quadrado: use a borracha ou outro quadrado.";

  function removeEl(e) {
    const m = ED.map;
    if (e.kind === "start" || e.kind === "key" || e.kind === "door") { m[e.kind] = null; return `${KIND_NAME[e.kind]} removido.`; }
    if (e.kind === "portal") {
      const p = m.portals[e.i], nm = portalName(e.i); p[e.end] = null;
      if (!p.a && !p.b) { m.portals.splice(e.i, 1); return `Par ${nm} removido.`; }
      return `Atenção: o par ${nm} ficou incompleto (falta uma ponta). Coloque outra ponta ou exclua a restante.`;
    }
    if (e.kind === "switch") { const n = m.switches[e.i].gates.length; m.switches.splice(e.i, 1); return n ? `Interruptor excluído. Atenção: ${pl(n, "porta ficou", "portas ficaram")} sem interruptor (fechadas para sempre até ligá-las a outro).` : "Interruptor excluído."; }
    if (e.kind === "gate") {
      const id = m.gates[e.i].id; let warnTxt = ""; m.switches.forEach((s, si) => { const k = s.gates.indexOf(id); if (k >= 0) { s.gates.splice(k, 1); if (!s.gates.length) warnTxt = ` Atenção: o interruptor ${si + 1} ficou sem portas.`; } });
      m.gates.splice(e.i, 1); return "Porta controlada excluída." + warnTxt;
    }
    if (e.kind === "laser") { m.lasers.splice(e.i, 1); return "Laser excluído."; }
    if (e.kind === "drone") {
      const d = m.drones[e.i];
      if (e.pt == null) { m.drones.splice(e.i, 1); return "Drone excluído."; }
      d.route.splice(e.pt, 1);
      if (!d.route.length) { m.drones.splice(e.i, 1); return "Drone excluído (sem pontos)."; }
      return d.route.length < 2 ? "Atenção: a rota do drone ficou com 1 ponto; ela precisa de pelo menos 2." : `Ponto ${e.pt + 1} da rota excluído.`;
    }
    return "";
  }

  /** Um toque/pressão da ferramenta atual no quadrado (c,r). Devolve mensagem opcional. */
  function applyAt(c, r, isTap) {
    const m = ED.map, i = MK.idx(c, r), t = ED.tool, o = occ(c, r), L = MK.LIM;
    if (ED.moving) return performMove(c, r);
    if (t === "wall" || t === "spike") {
      if (o) return BUSY; // paredes/espinhos não cobrem elementos (laser: a parede apenas o corta)
      if (t === "wall" && m.lasers.some((l) => l.c === c && l.r === r)) return BUSY;
      m.cells[i] = t === "wall" ? MK.WALL : MK.SPIKE; return "";
    }
    if (t === "floor") { m.cells[i] = MK.FLOOR; return ""; }
    if (t === "select") { ED.sel = MK.elementAt(m, c, r); return ED.sel ? describe(ED.sel) + " selecionado." : ""; }
    if (t === "eraser") {
      const e = MK.elementAt(m, c, r);
      if (e && isTap !== false) { const msg = removeEl(e); ED.sel = null; return msg; }
      if (!e) m.cells[i] = MK.FLOOR; return "";
    }
    if (t === "start" || t === "key") {
      if (solidAt(c, r)) return "Esse quadrado é parede ou espinhos: use o piso ou a borracha antes.";
      if (o && o.kind !== t) return BUSY;
      m[t] = { c, r }; ED.sel = { kind: t }; return "";
    }
    if (t === "door") {
      if (c > COLS - 2 || r > ROWS - 2) return "A saída precisa de 2x2 quadrados dentro da área jogável.";
      for (const [cc2, rr] of [[c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]]) {
        if (solidAt(cc2, rr)) return "A saída não pode ficar sobre parede ou espinhos.";
        const x = occ(cc2, rr); if (x && x.kind !== "door") return "A saída não pode cobrir outro elemento.";
      }
      m.door = { c, r }; ED.sel = { kind: "door" }; return "";
    }
    if (t === "laser") {
      if (o && o.kind === "laser") { ED.sel = o; return "Laser selecionado."; }
      if (solidAt(c, r) && m.cells[i] === MK.WALL) return "Laser não pode nascer numa parede.";
      if (o) return BUSY;
      if (m.lasers.length >= L.lasers) return `Máximo de ${L.lasers} lasers.`;
      m.lasers.push({ c, r, dir: "h", len: 5, on: 1.5, off: 2.5, init: "off" });
      ED.sel = { kind: "laser", i: m.lasers.length - 1 }; return "Laser criado: ajuste no painel. Ele pisca (aviso) antes de ligar.";
    }
    if (t === "drone") {
      if (o && o.kind === "drone") { ED.sel = o; return "Ponto selecionado."; }
      if (m.cells[i] === MK.WALL) return "A rota do drone não pode ter pontos em paredes.";
      if (o) return BUSY;
      const s = ED.sel;
      if (s && s.kind === "drone" && m.drones[s.i]) {
        const d = m.drones[s.i];
        if (d.route.length >= L.route) return `Máximo de ${L.route} pontos por rota.`;
        d.route.push({ c, r }); ED.sel = { kind: "drone", i: s.i, pt: d.route.length - 1 }; return `Ponto ${d.route.length} adicionado.`;
      }
      if (m.drones.length >= L.drones) return `Máximo de ${L.drones} drones.`;
      m.drones.push({ mode: "pingpong", route: [{ c, r }] }); ED.sel = { kind: "drone", i: m.drones.length - 1, pt: 0 }; return "Drone criado. Toque para acrescentar pontos à rota (mínimo 2).";
    }
    if (t === "portal") {
      if (o && o.kind === "portal") { ED.sel = o; return "Portal selecionado."; }
      if (solidAt(c, r)) return "Portais ficam só sobre piso livre.";
      if (o) return BUSY;
      const inc = m.portals.findIndex((p) => !p.a || !p.b);
      if (inc >= 0) { const end = m.portals[inc].a ? "b" : "a"; m.portals[inc][end] = { c, r }; ED.sel = { kind: "portal", i: inc, end }; return `Par ${portalName(inc)} completo.`; }
      if (m.portals.length >= L.portals) return `Máximo de ${L.portals} pares de portais.`;
      m.portals.push({ a: { c, r }, b: null }); ED.sel = { kind: "portal", i: m.portals.length - 1, end: "a" };
      return `Par ${portalName(m.portals.length - 1)}: falta a 2ª ponta — toque em outro quadrado.`;
    }
    if (t === "switch") {
      if (o && o.kind === "switch") { ED.sel = o; return "Interruptor selecionado."; }
      if (solidAt(c, r)) return "Interruptores ficam só sobre piso livre.";
      if (o) return BUSY;
      if (m.switches.length >= L.switches) return `Máximo de ${L.switches} interruptores.`;
      m.switches.push({ c, r, gates: [] }); ED.sel = { kind: "switch", i: m.switches.length - 1 }; return "Interruptor criado: ligue-o a portas no painel.";
    }
    if (t === "gate") {
      const gc = Math.min(c, COLS - 2), gr = Math.min(r, ROWS - 2);
      const ex = MK.elementAt(m, c, r); if (ex && ex.kind === "gate") { ED.sel = ex; return "Porta selecionada."; }
      if (m.gates.length >= L.gates) return `Máximo de ${L.gates} portas controladas.`;
      for (const [cc2, rr] of [[gc, gr], [gc + 1, gr], [gc, gr + 1], [gc + 1, gr + 1]]) { if (solidAt(cc2, rr)) return "A porta (2x2) não pode ficar sobre parede ou espinhos."; if (occ(cc2, rr)) return BUSY; }
      const id = MK.nextGateId(m); m.gates.push({ id, c: gc, r: gr });
      let extra = " sem interruptor (selecione um interruptor e ligue-a no painel).";
      if (ED.sel && ED.sel.kind === "switch" && m.switches[ED.sel.i]) { m.switches[ED.sel.i].gates.push(id); extra = ` ligada ao interruptor ${ED.sel.i + 1}.`; }
      ED.sel = { kind: "gate", i: m.gates.length - 1 }; return "Porta controlada criada," + extra;
    }
    return "";
  }

  /* mover o elemento selecionado: botão "Mover" e depois toque no novo quadrado */
  function startMove(ref) { ED.moving = { ref: { ...ref } }; say("Toque no novo quadrado (Esc cancela).", false); renderProps(); }
  function performMove(c, r) {
    const m = ED.map, mv = ED.moving.ref; ED.moving = null;
    const ok = (cc2, rr, self) => { if (cc2 < 0 || rr < 0 || cc2 >= COLS || rr >= ROWS) return false; if (m.cells[MK.idx(cc2, rr)] !== MK.FLOOR) return false; const x = occ(cc2, rr); return !x || self(x); };
    const same = (a) => (x) => x.kind === a.kind && x.i === a.i && (a.end ? x.end === a.end : true) && (a.pt != null ? x.pt === a.pt : true);
    if (mv.kind === "portal") { if (!ok(c, r, same(mv))) return "Não dá para mover para lá: o quadrado está ocupado ou é parede/espinhos."; m.portals[mv.i][mv.end] = { c, r }; return "Portal movido."; }
    if (mv.kind === "switch") { if (!ok(c, r, same(mv))) return "Não dá para mover para lá: o quadrado está ocupado ou é parede/espinhos."; Object.assign(m.switches[mv.i], { c, r }); return "Interruptor movido."; }
    if (mv.kind === "laser") { if (m.cells[MK.idx(c, r)] === MK.WALL || (occ(c, r) && !same(mv)(occ(c, r)))) return "Não dá para mover para lá: o quadrado está ocupado ou é parede."; Object.assign(m.lasers[mv.i], { c, r }); return "Laser movido."; }
    if (mv.kind === "drone") { if (m.cells[MK.idx(c, r)] === MK.WALL || (occ(c, r) && !same(mv)(occ(c, r)))) return "Não dá para mover para lá: o quadrado está ocupado ou é parede."; m.drones[mv.i].route[mv.pt] = { c, r }; return `Ponto ${mv.pt + 1} movido.`; }
    if (mv.kind === "gate") {
      const g = m.gates[mv.i], gc = Math.min(c, COLS - 2), gr = Math.min(r, ROWS - 2);
      for (const [cc2, rr] of [[gc, gr], [gc + 1, gr], [gc, gr + 1], [gc + 1, gr + 1]]) if (!ok(cc2, rr, (x) => x.kind === "gate" && x.i === mv.i)) return "Não dá para mover para lá: o quadrado está ocupado ou é parede/espinhos.";
      g.c = gc; g.r = gr; return "Porta movida.";
    }
    return "";
  }

  /* --- pintura e toques na grade --- */
  function cellAt(e) {
    const r = $("ed-canvas").getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * COLS), rr = Math.floor(((e.clientY - r.top) / r.height) * ROWS);
    return c < 0 || rr < 0 || c >= COLS || rr >= ROWS ? null : { c, r: rr };
  }
  const PAINT = ["wall", "spike", "floor", "eraser"];
  function line(st, a, b) { // preenche o caminho entre dois quadrados (arrasto rápido sem buracos); no arrasto a borracha só apaga terreno
    let { c, r } = a; const dc = Math.abs(b.c - c), dr = Math.abs(b.r - r), sc = c < b.c ? 1 : -1, sr = r < b.r ? 1 : -1; let err = dc - dr;
    for (;;) { const msg = applyAt(c, r, false); if (msg) st.msg = msg; if (c === b.c && r === b.r) break; const e2 = 2 * err; if (e2 > -dr) { err -= dr; c += sc; } if (e2 < dc) { err += dc; r += sr; } }
  }
  const cv0 = $("ed-canvas");
  cv0.addEventListener("pointerdown", (e) => {
    if (!ED || API.G.state !== "editor" || $("editor").classList.contains("hidden")) return; // não edita enquanto joga
    e.preventDefault(); // não rola a página durante a pintura
    try { cv0.setPointerCapture(e.pointerId); } catch (_) {}
    const cell = cellAt(e); ED.ptr = e.pointerId; ED.stroke = { before: MK.cloneMap(ED.map), s0: sigOf(ED.map), last: cell, msg: "" };
    if (cell) { ED.cursor = cell; const msg = applyAt(cell.c, cell.r, true); if (msg) ED.stroke.msg = msg; }
    render();
  });
  cv0.addEventListener("pointermove", (e) => {
    if (!ED || !ED.stroke || e.pointerId !== ED.ptr || !PAINT.includes(ED.tool) || ED.moving) return; // só terreno é arrastável
    e.preventDefault();
    const cell = cellAt(e); if (!cell) return;
    const last = ED.stroke.last;
    if (!last) { const msg = applyAt(cell.c, cell.r, false); if (msg) ED.stroke.msg = msg; } else if (last.c !== cell.c || last.r !== cell.r) line(ED.stroke, last, cell);
    ED.stroke.last = cell; render();
  });
  const endStroke = (e) => {
    if (!ED || !ED.stroke || e.pointerId !== ED.ptr) return;
    const st = ED.stroke; ED.stroke = null; ED.ptr = null;
    if (sigOf(ED.map) !== st.s0) pushHistory(st.before);
    refresh(); if (st.msg) say(st.msg, /^(Não|Sem|Falta|Máximo|Esse|Há|A |Laser n|Portais|Interruptores)/.test(st.msg));
  };
  cv0.addEventListener("pointerup", endStroke);
  cv0.addEventListener("pointercancel", endStroke);
  cv0.addEventListener("contextmenu", (e) => e.preventDefault());

  /* --- teclado no mapa: setas movem o cursor; Enter/Espaço aplicam a ferramenta; Delete apaga; E seleciona --- */
  cv0.addEventListener("focus", render); cv0.addEventListener("blur", render);
  cv0.addEventListener("keydown", (e) => {
    if (!ED) return;
    const k = e.code, cur = ED.cursor;
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (mv) { e.preventDefault(); cur.c = Math.max(0, Math.min(COLS - 1, cur.c + mv[0])); cur.r = Math.max(0, Math.min(ROWS - 1, cur.r + mv[1])); const el = MK.elementAt(ED.map, cur.c, cur.r); say(`Coluna ${cur.c + 1}, linha ${cur.r + 1}: ${el ? describe(el) : ["piso", "parede", "espinhos"][ED.map.cells[MK.idx(cur.c, cur.r)]]}`); render(); }
    else if (k === "Enter" || k === "Space") { e.preventDefault(); act(() => applyAt(cur.c, cur.r, true)); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); const t = ED.tool; ED.tool = "eraser"; act(() => applyAt(cur.c, cur.r, true)); ED.tool = t; }
    else if (k === "KeyE") { e.preventDefault(); ED.sel = MK.elementAt(ED.map, cur.c, cur.r); refresh(); say(ED.sel ? describe(ED.sel) + " selecionado." : "Nada neste quadrado."); }
  });
  window.addEventListener("keydown", (e) => {
    if ($("editor").classList.contains("hidden") || !ED) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.code === "Escape" && e.target.tagName === "SELECT") e.target.blur(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.code === "KeyY") { e.preventDefault(); redo(); }
    else if (e.code === "Escape") { if (!$("overlay").classList.contains("hidden")) return; if (ED.moving) { ED.moving = null; say("Movimento cancelado."); renderProps(); } else if (ED.sel) { ED.sel = null; refresh(); } else exitEditor(); }
  });
  $("ed-name").addEventListener("input", () => { if (ED) { ED.dirty = true; status(); } });
  $("ed-help").addEventListener("click", () => { const h = $("ed-helptext"); h.classList.toggle("hidden"); $("ed-help").setAttribute("aria-expanded", String(!h.classList.contains("hidden"))); });

  /* --- painel de propriedades do elemento selecionado (toque e teclado; nada depende de hover) --- */
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const k of Object.keys(attrs || {})) { if (k === "text") e.textContent = attrs[k]; else if (k === "on") { for (const ev of Object.keys(attrs.on)) e.addEventListener(ev, attrs.on[ev]); } else if (k === "class") e.className = attrs[k]; else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]); }
    kids.flat().forEach((x) => x && e.appendChild(typeof x === "string" ? document.createTextNode(x) : x));
    return e;
  }
  const btn = (text, fn, cls) => h("button", { type: "button", class: "pp-btn" + (cls ? " " + cls : ""), text, on: { click: fn } });
  function field(label, control) { return h("label", { class: "pp-field" }, h("span", { text: label }), control); }
  function select(id, opts, value, onchange) {
    const s = h("select", { id }, opts.map(([v, t]) => h("option", { value: String(v), text: t })));
    s.value = String(value); s.addEventListener("change", () => onchange(s.value)); return s;
  }
  const stepOpts = (lo, hi, unit) => { const o = []; for (let v = lo; v <= hi + 1e-9; v += 0.5) o.push([v, `${String(v).replace(".", ",")} ${unit}`]); return o; };

  function renderProps() {
    const box = $("ed-props"); if (!box || !ED) return;
    const focusId = document.activeElement && document.activeElement.id && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.textContent = "";
    const m = ED.map, s = ED.sel;
    // lista de elementos (alternativa ao toque: escolha por teclado)
    const els = allElements();
    const list = h("select", { id: "pp-list", "aria-label": "Escolher elemento para editar" }, h("option", { value: "", text: els.length ? `Elementos (${els.length}) — escolha para editar` : "Nenhum mecanismo ou perigo ainda" }), els.map((e, n) => h("option", { value: String(n), text: describe(e) })));
    list.addEventListener("change", () => { if (list.value !== "") { ED.sel = els[+list.value]; ED.moving = null; refresh(); const f = $("pp-title"); if (f) f.focus(); } });
    box.appendChild(h("div", { class: "pp-top" }, list));
    if (ED.moving) { box.appendChild(h("p", { class: "pp-note", text: "Modo mover: toque no novo quadrado do mapa (ou Esc para cancelar)." }), btn("Cancelar movimento", () => { ED.moving = null; say("Movimento cancelado."); renderProps(); })); return; }
    if (!s || !exists(s)) { box.appendChild(h("p", { class: "pp-note", text: "Toque em um elemento do mapa (com a ferramenta Selecionar) ou escolha na lista para editar suas propriedades." })); restoreFocus(focusId); return; }
    const title = h("h2", { id: "pp-title", tabindex: "-1", text: describe(s) });
    const closeB = btn("Fechar painel", () => { ED.sel = null; refresh(); });
    const del = (txt, e) => btn(txt, () => act(() => { const msg = removeEl(e || s); ED.sel = null; return msg; }), "danger");
    box.appendChild(h("div", { class: "pp-head" }, title, closeB));
    const body = h("div", { class: "pp-body" });
    if (s.kind === "start" || s.kind === "key" || s.kind === "door") {
      body.appendChild(h("p", { class: "pp-note", text: `${KIND_NAME[s.kind]}: para mover, use a ferramenta correspondente e toque no novo quadrado.` })); body.appendChild(del("Excluir"));
    } else if (s.kind === "portal") {
      const p = m.portals[s.i], other = s.end === "a" ? "b" : "a";
      body.appendChild(h("p", { class: "pp-note", text: p.a && p.b ? `Par ${portalName(s.i)} completo: a linha tracejada liga as duas pontas. Entrar em uma leva à outra; o destino não reativa até você sair dele.` : `Par ${portalName(s.i)} INCOMPLETO: falta a outra ponta. Com a ferramenta Portal, toque em outro quadrado.` }));
      body.appendChild(h("div", { class: "pp-row" }, btn("Mover ponta", () => startMove(s)), p[other] ? btn("Ir para a outra ponta", () => { ED.sel = { kind: "portal", i: s.i, end: other }; refresh(); }) : null, del("Excluir ponta"), p.a && p.b ? btn("Excluir par", () => act(() => { m.portals.splice(s.i, 1); ED.sel = null; return `Par ${portalName(s.i)} excluído.`; }), "danger") : null));
    } else if (s.kind === "switch") {
      const sv = m.switches[s.i];
      body.appendChild(h("p", { class: "pp-note", text: "Pisar no interruptor abre as portas ligadas até o fim da tentativa. Cada porta pertence a um só interruptor. Marque as portas que ele abre:" }));
      if (!m.gates.length) body.appendChild(h("p", { class: "pp-note", text: "Ainda não há portas controladas: use a ferramenta Porta." }));
      m.gates.forEach((g, gi) => {
        const own = MK.ownerOf(m, g.id), mine = own === s.i;
        const cb = h("input", { type: "checkbox", id: `pp-g${gi}`, checked: mine });
        cb.checked = mine;
        cb.addEventListener("change", () => act(() => {
          if (cb.checked) { let msg = `Porta ${gi + 1} ligada ao interruptor ${s.i + 1}.`; if (own >= 0 && own !== s.i) { m.switches[own].gates.splice(m.switches[own].gates.indexOf(g.id), 1); msg = `Porta ${gi + 1} religada: saiu do interruptor ${own + 1} e agora é do ${s.i + 1}.`; if (!m.switches[own].gates.length) msg += ` Atenção: o interruptor ${own + 1} ficou sem portas.`; } sv.gates.push(g.id); return msg; }
          sv.gates.splice(sv.gates.indexOf(g.id), 1); return `Porta ${gi + 1} desligada deste interruptor` + (sv.gates.length ? "." : ". Atenção: ele ficou sem portas.");
        }));
        body.appendChild(h("label", { class: "pp-check" }, cb, h("span", { text: `Porta ${gi + 1}` + (own >= 0 && !mine ? ` (hoje do interruptor ${own + 1})` : own < 0 ? " (sem interruptor)" : "") }), h("i", { class: "sw", style: `background:${SWC[(own >= 0 ? own : s.i) % SWC.length]}` })));
      });
      body.appendChild(h("div", { class: "pp-row" }, btn("Mover", () => startMove(s)), del("Excluir")));
    } else if (s.kind === "gate") {
      const g = m.gates[s.i], own = MK.ownerOf(m, g.id);
      body.appendChild(h("p", { class: "pp-note", text: own >= 0 ? `Esta porta abre quando o interruptor ${own + 1} é pisado (linha tracejada colorida no mapa).` : "Sem interruptor: esta porta ficará fechada para sempre." }));
      body.appendChild(field("Interruptor", select("pp-owner", [["-1", "Nenhum"], ...m.switches.map((_, i) => [String(i), `Interruptor ${i + 1}`])], own, (v) => act(() => {
        const to = +v; let msg = to < 0 ? `Porta ${s.i + 1} sem interruptor.` : `Porta ${s.i + 1} ligada ao interruptor ${to + 1}.`;
        if (own >= 0) { m.switches[own].gates.splice(m.switches[own].gates.indexOf(g.id), 1); if (!m.switches[own].gates.length && own !== to) msg += ` Atenção: o interruptor ${own + 1} ficou sem portas.`; }
        if (to >= 0) m.switches[to].gates.push(g.id); return msg;
      }))));
      body.appendChild(h("div", { class: "pp-row" }, btn("Mover", () => startMove(s)), del("Excluir")));
    } else if (s.kind === "laser") {
      const L = m.lasers[s.i], ex = MK.laserExtent(m, L);
      body.appendChild(field("Direção", select("pp-dir", [["h", "Horizontal →"], ["v", "Vertical ↓"]], L.dir, (v) => act(() => { L.dir = v; return ""; }))));
      body.appendChild(field("Comprimento (quadrados)", h("input", { id: "pp-len", type: "number", min: 1, max: MK.LIM.lenMax, step: 1, value: L.len, inputmode: "numeric", on: { change: (e) => act(() => { const v = Math.round(+e.target.value); if (!(v >= 1 && v <= MK.LIM.lenMax)) { return `Comprimento deve ser de 1 a ${MK.LIM.lenMax}.`; } L.len = v; return ""; }) } })));
      body.appendChild(field("Ligado por", select("pp-on", stepOpts(MK.LIM.onMin, MK.LIM.onMax, "s"), L.on, (v) => act(() => { L.on = +v; return ""; }))));
      body.appendChild(field("Desligado por", select("pp-off", stepOpts(MK.LIM.offMin, MK.LIM.offMax, "s"), L.off, (v) => act(() => { L.off = +v; return ""; }))));
      body.appendChild(field("Estado inicial", select("pp-init", [["off", "Desligado (começa seguro)"], ["on", "Ligado"]], L.init, (v) => act(() => { L.init = v; return ""; }))));
      body.appendChild(h("p", { class: "pp-note", text: `Extensão real: ${pl(ex.real, "quadrado", "quadrados")}${ex.real < L.len ? " (o feixe para na parede)" : ""}. Nos últimos 0,5 s desligado ele pisca como aviso antes de ligar. Vermelho cheio = começa ligado.` }));
      body.appendChild(h("div", { class: "pp-row" }, btn("Mover origem", () => startMove(s)), del("Excluir")));
    } else if (s.kind === "drone") {
      const d = m.drones[s.i], pt = s.pt == null ? 0 : s.pt;
      body.appendChild(field("Tipo de rota", select("pp-mode", [["pingpong", "Ida e volta"], ["loop", "Circuito fechado"]], d.mode, (v) => act(() => { d.mode = v; return ""; }))));
      body.appendChild(h("p", { class: "pp-note", text: `Velocidade fixa (igual à da campanha). ${d.mode === "loop" ? "No circuito, o último ponto volta ao primeiro (trecho tracejado)." : "Vai até o último ponto e volta pelo mesmo caminho."} Ponto 1 = onde o drone começa.` }));
      const pts = h("div", { class: "pp-pts", role: "group", "aria-label": "Pontos da rota" }, d.route.map((p, n) => h("button", { type: "button", class: "pp-pt" + (n === pt ? " on" : ""), "aria-pressed": String(n === pt), text: String(n + 1), on: { click: () => { ED.sel = { kind: "drone", i: s.i, pt: n }; refresh(); } } })));
      body.appendChild(pts);
      body.appendChild(h("div", { class: "pp-row" },
        btn("Adicionar ponto", () => { setTool("drone"); ED.sel = { kind: "drone", i: s.i, pt }; say("Toque no mapa para acrescentar pontos ao fim da rota."); renderProps(); }),
        btn("Mover ponto", () => startMove({ kind: "drone", i: s.i, pt })),
        btn("Excluir ponto", () => act(() => removeEl({ kind: "drone", i: s.i, pt })), "danger"),
      ));
      body.appendChild(h("div", { class: "pp-row" }, btn("Novo drone", () => { if (m.drones.length >= MK.LIM.drones) { say(`Máximo de ${MK.LIM.drones} drones.`, true); return; } ED.sel = null; setTool("drone"); say("Toque no mapa para o 1º ponto do novo drone."); refresh(); }), del("Excluir drone", { kind: "drone", i: s.i })));
    }
    box.appendChild(body);
    restoreFocus(focusId);
  }
  function restoreFocus(id) { if (id) { const f = $(id); if (f) f.focus({ preventScroll: true }); } }

  /* --- limpar (desfazível), salvar, verificar, testar, sair --- */
  $("ed-clear").addEventListener("click", () => {
    API.showOverlay({
      keep: true, title: "Limpar mapa?", text: "Todo o mapa (terreno, elementos, mecanismos, lasers e drones) será apagado. Dá para desfazer logo depois.",
      primary: { label: "Limpar mapa", fn: () => { API.hideOverlay(); act(() => { const keep = ED.map.id, nm = ED.map.name; ED.map = MK.newMap(); ED.map.id = keep; ED.map.name = nm; ED.sel = null; return "Mapa limpo (use Desfazer para voltar)."; }); } },
      secondary: { label: "Cancelar", fn: () => API.hideOverlay() }, kind: "bad",
    });
  });
  function syncName() { ED.map.name = MK.cleanName($("ed-name").value).trim(); }
  function save() {
    syncName();
    if (!ED.map.name) { ED.map.name = "Fase sem nome"; $("ed-name").value = ED.map.name; }
    const r = MK.saveMap(ED.map);
    if (!r.ok) { say("NÃO foi salvo: " + r.error, true); return false; } // nunca anuncia salvo sem confirmação
    ED.dirty = false; refresh();
    say(r.validated ? (MK.proofOk(ED.map) ? "Salva — concluída por você: pronta para exportar." : "Salva — estrutura e percurso OK. Conclua no teste para poder exportar.") : "Salva como RASCUNHO: ainda falta algo ou há erros. Use Verificar para ver o que corrigir.");
    return true;
  }
  $("ed-save").addEventListener("click", save);
  const LEVELS_NOTE = "Níveis de confiança: (1) estrutura válida · (2) percurso (considera portais e interruptores; lasers e drones não contam como paredes) · (3) teste jogável: só concluindo a fase você confirma tempo e dificuldade. Achar um caminho não garante concluir dentro do tempo.";
  function problemsOverlay(v, title, onOk) {
    ED.problems = v.errors; ED.warnings = v.warnings; render();
    const list = v.errors.map((p) => "✖ " + p.msg).concat(v.warnings.map((p) => "⚠ " + p.msg)).join("\n");
    API.showOverlay({
      keep: true, title: title || "Corrija antes de continuar", text: list + "\n\nErros (vermelho) impedem testar; avisos (amarelo) pedem revisão.\n" + LEVELS_NOTE,
      primary: onOk ? { label: "Testar mesmo assim", fn: () => { API.hideOverlay(); onOk(); } } : { label: "Entendi", fn: () => API.hideOverlay() },
      secondary: onOk ? { label: "Revisar", fn: () => API.hideOverlay() } : null, kind: v.errors.length ? "bad" : null,
    });
  }
  $("ed-check").addEventListener("click", () => {
    const v = check(); status();
    if (!v.errors.length && !v.warnings.length) { ED.problems = []; render(); API.showOverlay({ keep: true, title: "Tudo certo (estrutura e percurso)", text: "Nenhum erro nem aviso.\n" + (MK.proofOk(ED.map) ? "Você já concluiu esta revisão no teste." : "Falta concluir a fase no teste para poder exportar.") + "\n" + LEVELS_NOTE, primary: { label: "Fechar", fn: () => API.hideOverlay() }, kind: "good" }); }
    else problemsOverlay(v, v.errors.length ? "Erros encontrados" : "Avisos para revisar");
  });
  function startTest() {
    ED.problems = []; ED.warnings = []; render();
    const level = MK.toLevel(ED.map); // cópia: o jogo não toca no mapa do editor
    hideAll();
    API.startCustomTest(level, resume, ({ limit, time }) => { if (!ED) return; ED.map.proof = MK.makeProof(ED.map, limit, time); ED.dirty = true; });
  }
  $("ed-test").addEventListener("click", () => {
    const v = check();
    if (!v.ok) { problemsOverlay(v, "Esta fase ainda não pode ser testada"); return; }
    if (v.warnings.length) { problemsOverlay(v, "Avisos antes de testar", startTest); return; }
    startTest();
  });
  function exitEditor() {
    if (!ED) return;
    if (!ED.dirty) { openHub(); return; }
    API.showOverlay({
      keep: true, title: "Alterações não salvas", text: "Você tem alterações que ainda não foram salvas.",
      primary: { label: "Salvar e sair", fn: () => { if (save()) { API.hideOverlay(); openHub(); } else API.hideOverlay(); } },
      secondary: { label: "Descartar", fn: () => { API.hideOverlay(); ED.dirty = false; openHub(); } },
      tertiary: { label: "Continuar editando", fn: () => API.hideOverlay() },
    });
  }
  $("ed-exit").addEventListener("click", exitEditor);

  /* ---------------- Minhas fases ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function badge(map) {
    const v = MK.validate(map);
    if (!v.ok) return ["draft", `✎ Rascunho (${v.errors.length ? pl(v.errors.length, "erro", "erros") : "incompleto"})`];
    if (MK.proofOk(map)) return ["ok", `✔ Concluída por você (${API.fmtLimit(map.proof.limit)})`];
    return ["mid", map.proof ? "◐ Estrutura OK · conclusão antiga invalidada (mapa mudou)" : "◐ Estrutura e percurso OK · falta concluir no teste"];
  }
  function openHub(msg, err) { showPanel("mymaps"); renderHub(msg, err); }
  function renderHub(msg, err) {
    const l = MK.loadAll(), box = $("mm-list"), m = $("mm-msg");
    m.textContent = msg || (l.ok ? (l.note || (l.items.length ? `${l.items.length} fase(s) salva(s) neste aparelho.` : "Você ainda não criou nenhuma fase.")) : l.error);
    m.style.color = err || !l.ok ? "var(--red)" : "";
    box.textContent = "";
    l.items.forEach((it) => {
      const card = document.createElement("div"); card.className = "mm-card"; card.dataset.id = it.map.id;
      const cv = document.createElement("canvas"); cv.width = 192; cv.height = 120; cv.setAttribute("aria-hidden", "true");
      const info = document.createElement("div"), [cls, txt] = badge(it.map);
      info.innerHTML = `<b>${esc(it.map.name || "Fase sem nome")}</b><span class="badge2 ${cls}">${esc(txt)}</span>`;
      const btns = document.createElement("div"); btns.className = "mm-btns";
      [["play", "▶ Jogar"], ["edit", "✏ Editar"], ["dup", "⧉ Duplicar"], ["export", "📤 Exportar"], ["del", "🗑 Excluir"]].forEach(([a, t]) => { const b = document.createElement("button"); b.dataset.act = a; b.textContent = t; if (a === "del") b.className = "danger"; btns.appendChild(b); });
      card.append(cv, info, btns); box.appendChild(card);
      drawMap(cv, it.map, {});
    });
  }
  function playSaved(it) {
    const v = MK.validate(it.map);
    if (!v.ok) { API.showOverlay({ keep: true, title: "Esta fase ainda não pode ser jogada", text: v.errors.map((p) => "✖ " + p.msg).join("\n") + "\n\nAbra no editor para corrigir.\n" + LEVELS_NOTE, primary: { label: "Editar", fn: () => { API.hideOverlay(); openEditor(it.map); } }, secondary: { label: "Fechar", fn: () => API.hideOverlay() }, kind: "bad" }); return; }
    hideAll();
    API.startCustomTest(MK.toLevel(it.map), () => { API.leaveTest(); openHub(); }, ({ limit, time }) => { MK.setProof(it.map.id, limit, time); });
  }
  $("mm-list").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest(".mm-card").dataset.id, it = MK.loadAll().items.find((x) => x.map.id === id);
    if (!it) { renderHub("Fase não encontrada.", true); return; }
    const act2 = b.dataset.act;
    if (act2 === "edit") openEditor(it.map);
    else if (act2 === "dup") { const r = MK.duplicateMap(id); renderHub(r.ok ? "Fase duplicada (cópia independente: ligações e rotas ficam só dentro dela)." : "Não foi possível duplicar: " + r.error, !r.ok); }
    else if (act2 === "del") {
      API.showOverlay({
        keep: true, title: "Excluir fase?", text: `"${it.map.name}" será excluída deste aparelho. Isso não pode ser desfeito.`,
        primary: { label: "Excluir", fn: () => { const r = MK.deleteMap(id); API.hideOverlay(); renderHub(r.ok ? "Fase excluída." : "Não foi possível excluir: " + r.error, !r.ok); } },
        secondary: { label: "Cancelar", fn: () => API.hideOverlay() }, kind: "bad",
      });
    } else if (act2 === "play") playSaved(it);
    else if (act2 === "export") exportMap(it);
  });
  $("mm-new").addEventListener("click", () => openEditor(null));
  $("mm-import").addEventListener("click", openImporter);
  $("mm-back").addEventListener("click", toMenu);

  /* ---------------- exportar ---------------- */
  function exportMap(it) {
    const map = it.map, r = MK.encode(map);
    if (!r.ok) {
      API.showOverlay({
        keep: true, title: r.needProof ? "Conclua a fase antes de compartilhar" : "Não dá para exportar", text: r.error + (r.needProof ? "\nJogue a fase até o fim uma vez (qualquer tempo por sala); isso vale só para esta revisão do mapa. Mudar o layout, mecanismos ou propriedades de jogo exige concluir de novo; mudar só o nome, não." : "\nAbra a fase no editor e corrija."),
        primary: r.needProof ? { label: "Jogar agora", fn: () => { API.hideOverlay(); playSaved(it); } } : { label: "Fechar", fn: () => API.hideOverlay() },
        secondary: r.needProof ? { label: "Fechar", fn: () => API.hideOverlay() } : null, kind: "bad",
      });
      return;
    }
    API.showOverlay({
      keep: true, title: "Código da fase",
      text: `Copie o código e envie a quem quiser. Compartilhar o código NÃO publica a fase em nenhum catálogo online: só quem receber o texto poderá importar.\nO código inclui o tempo validado: concluída em ${map.proof.time.toFixed(2)} s com limite "${API.fmtLimit(map.proof.limit)}". É uma confirmação LOCAL do editor: sem verificação online e sem proteção contra adulteração.`,
      extra: `<textarea id="ex-code" rows="5" readonly spellcheck="false" aria-label="Código da fase"></textarea><p id="ex-msg" role="status" class="notes"></p>`,
      primary: { label: "Copiar código", fn: () => copyCode(r.code) },
      secondary: { label: "Fechar", fn: () => API.hideOverlay() },
    });
    const ta = $("ex-code"); ta.value = r.code; ta.focus(); ta.select();
  }
  function copyCode(code) {
    const ta = $("ex-code"), msg = $("ex-msg"), manual = () => { ta.focus(); ta.select(); msg.textContent = "Não consegui copiar automaticamente: o texto está selecionado — copie com Ctrl+C (ou toque e segure → Copiar)."; };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(() => { msg.textContent = "Código copiado!"; }, manual);
      else { ta.focus(); ta.select(); if (document.execCommand && document.execCommand("copy")) msg.textContent = "Código copiado!"; else manual(); }
    } catch (e) { manual(); }
  }

  /* ---------------- importar ---------------- */
  let imported = null;
  function openImporter() {
    imported = null; showPanel("importer");
    $("im-text").value = ""; $("im-msg").textContent = ""; $("im-msg").className = ""; $("im-preview").classList.add("hidden"); $("im-ok").classList.add("hidden");
    $("im-text").focus();
  }
  $("im-text").addEventListener("input", () => { imported = null; $("im-ok").classList.add("hidden"); $("im-preview").classList.add("hidden"); });
  $("im-check").addEventListener("click", () => {
    const r = MK.decode($("im-text").value), msg = $("im-msg");
    imported = null; $("im-ok").classList.add("hidden"); $("im-preview").classList.add("hidden");
    if (!r.ok) { msg.className = ""; msg.textContent = r.error; return; }
    const v = MK.validate(r.map);
    if (!v.ok) { msg.className = ""; msg.textContent = "Código recusado (nada foi salvo): " + v.errors.slice(0, 3).map((p) => p.msg).join(" · "); return; }
    imported = { map: r.map, validated: true };
    const mm = r.map;
    msg.className = "good"; msg.textContent = `Código válido (formato ${r.format}). Confira a prévia e o nome antes de importar.`;
    $("im-preview").classList.remove("hidden"); drawMap($("im-canvas"), mm, {});
    $("im-name").textContent = mm.name;
    $("im-state").textContent = `Conteúdo: ${pl(mm.portals.length, "par de portais", "pares de portais")}, ${pl(mm.switches.length, "interruptor", "interruptores")}, ${pl(mm.gates.length, "porta controlada", "portas controladas")}, ${pl(mm.lasers.length, "laser", "lasers")}, ${pl(mm.drones.length, "drone", "drones")}. Estrutura e percurso verificados (não garante concluir no tempo)` +
      (r.claimed ? `. O autor informa conclusão em ${r.claimed.time.toFixed(2)} s com limite "${API.fmtLimit(r.claimed.limit)}" — informação sem verificação, que não vale como a sua conclusão.` : ". Fase antiga: sem tempo informado.") + (v.warnings.length ? ` Avisos: ${v.warnings.length}.` : "") + " Para reexportar, conclua a fase você mesmo.";
    $("im-ok").classList.remove("hidden");
  });
  $("im-ok").addEventListener("click", () => {
    if (!imported) return;
    const m = MK.cloneMap(imported.map); m.id = null; m.proof = null; // SEMPRE uma fase nova, sem comprovação herdada: nunca sobrescreve
    const r = MK.saveMap(m);
    if (!r.ok) { $("im-msg").className = ""; $("im-msg").textContent = "Não foi possível importar: " + r.error; return; }
    openHub(`Fase "${m.name}" importada como nova.`);
  });
  $("im-back").addEventListener("click", () => openHub());

  window.Editor = { openHub, openEditor, resume, drawMap, getState: () => ED, undo, redo, save, act, applyAt: (c, r, t) => { if (t) setTool(t), (ED.tool = t); let out = ""; act(() => { out = applyAt(c, r, true); return out; }); return out; }, setSel: (s) => { ED.sel = s; refresh(); }, check, startTest, playSaved, exportMap };
})();
