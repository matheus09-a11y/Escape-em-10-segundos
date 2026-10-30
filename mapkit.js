/* =====================================================================
 * mapkit.js — lógica PURA do editor de fases (sem DOM): grade, conversão para o motor,
 * validação, código de compartilhamento e armazenamento local. Usada por editor.js e testável sozinha.
 *
 * GRADE: 40 x 25 quadrados de 20 u (= a sala de 800 x 500 do motor). Tipos de quadrado:
 *   0 piso · 1 parede · 2 espinhos.  Objetos: start (1 quadrado), key (1 quadrado) e door (2x2 quadrados,
 *   guardada pelo quadrado de cima à esquerda). O personagem (raio 11) é um pouco maior que um quadrado:
 *   corredores precisam de pelo menos 2 quadrados de largura.
 *
 * EDITOR 2.0 — mecanismos e perigos (reaproveitam o comportamento da campanha, via toLevel -> motor):
 *   portals  [{a:{c,r}|null, b:{c,r}|null}]      até 3 pares; letra A/B/C + símbolo ◆ ● ▲
 *   switches [{c, r, gates:[idPorta,...]}]        interruptor (1 quadrado) que abre 1+ portas até o fim da tentativa
 *   gates    [{id, c, r}]                         porta controlada 2x2 (canto superior esquerdo); só UM interruptor por porta
 *   lasers   [{c, r, dir:"h"|"v", len, on, off, init:"on"|"off"}]   feixe fino que para na 1ª parede
 *   drones   [{mode:"loop"|"pingpong", route:[{c,r},...]}]          velocidade fixa (DRONE_SPEED)
 *   proof    {sig, limit, time} | null            conclusão pelo criador DESTA revisão (confirmação local, sem verificação online)
 *
 * TRÊS NÍVEIS DE CONFIANÇA (nunca misturados):
 *   1. validação ESTRUTURAL (validate().errors vazio) · 2. verificação de PERCURSO (considera portais e
 *   interruptores; lasers e drones NÃO são paredes permanentes) · 3. TESTE JOGÁVEL (a prova `proof`).
 * ===================================================================== */
(function (root) {
  const COLS = 40, ROWS = 25, CELL = 20, N = COLS * ROWS, MAX_NAME = 40;
  const FLOOR = 0, WALL = 1, SPIKE = 2;
  const R = 11; // raio do personagem (igual ao motor)
  const CODE_MAX = 9000, MAX_MAPS = 30, KEY = "dez-segundos-custom-v1", FORMAT = 2;
  const CH = [".", "#", "^"];
  const LIM = { portals: 3, switches: 4, gates: 6, lasers: 6, drones: 4, route: 12, lenMax: 12, onMin: 0.5, onMax: 4, offMin: 1, offMax: 5 };
  const DRONE_SPEED = 120, DRONE_R = 12; // iguais aos drones da campanha
  const LASER_THICK = 12, LASER_WARN = 0.5;
  const PORTAL_LET = ["A", "B", "C"], PORTAL_SYM = ["◆", "●", "▲"], PORTAL_COL = ["#b8ff3d", "#ff8ad8", "#5ee7ff"];
  const SW_COL = ["#ff9f1c", "#b388ff", "#39d0ff", "#ffd23f"];

  const blankElems = () => ({ portals: [], switches: [], gates: [], lasers: [], drones: [], proof: null });
  const newMap = () => Object.assign({ id: null, name: "", cells: new Uint8Array(N), start: null, key: null, door: null }, blankElems());
  const cloneMap = (m) => ({
    id: m.id, name: m.name, cells: new Uint8Array(m.cells), start: m.start && { ...m.start }, key: m.key && { ...m.key }, door: m.door && { ...m.door },
    portals: (m.portals || []).map((p) => ({ a: p.a && { ...p.a }, b: p.b && { ...p.b } })),
    switches: (m.switches || []).map((s) => ({ c: s.c, r: s.r, gates: s.gates.slice() })),
    gates: (m.gates || []).map((g) => ({ id: g.id, c: g.c, r: g.r })),
    lasers: (m.lasers || []).map((l) => ({ ...l })),
    drones: (m.drones || []).map((d) => ({ mode: d.mode, route: d.route.map((p) => ({ ...p })) })),
    proof: m.proof ? { ...m.proof } : null,
  });
  const idx = (c, r) => r * COLS + c;
  const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, MAX_NAME);
  const sameCell = (a, b) => a && b && a.c === b.c && a.r === b.r;
  const doorCells = (d) => (d ? [idx(d.c, d.r), idx(d.c + 1, d.r), idx(d.c, d.r + 1), idx(d.c + 1, d.r + 1)] : []);
  const gateCells = (g) => doorCells(g);
  const cc = (p) => ({ x: p.c * CELL + CELL / 2, y: p.r * CELL + CELL / 2 });
  const gateRect = (g) => ({ x: g.c * CELL, y: g.r * CELL, w: 2 * CELL, h: 2 * CELL });
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dRect = (x, y, rc) => Math.hypot(x - clamp(x, rc.x, rc.x + rc.w), y - clamp(y, rc.y, rc.y + rc.h));
  const circleRect = (cx, cy, r, rc) => dRect(cx, cy, rc) < r;
  const inGrid = (c, r, cm, rm) => Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < (cm || COLS) && r < (rm || ROWS);
  const nextGateId = (m) => m.gates.reduce((a, g) => Math.max(a, g.id), 0) + 1;
  const ownerOf = (m, gateId) => m.switches.findIndex((s) => s.gates.includes(gateId));
  const gateById = (m, id) => m.gates.find((g) => g.id === id);

  /** Célula de objeto básico (início/chave/saída). */
  function objectAt(m, c, r) {
    if (m.start && m.start.c === c && m.start.r === r) return "start";
    if (m.key && m.key.c === c && m.key.r === r) return "key";
    if (m.door && c >= m.door.c && c <= m.door.c + 1 && r >= m.door.r && r <= m.door.r + 1) return "door";
    return null;
  }

  /** Extensão REAL de um laser: parte do quadrado de origem na direção dada e para na primeira parede (ou na borda). */
  function laserExtent(m, L) {
    let real = 0;
    const cells = [];
    for (let i = 0; i < L.len; i++) {
      const c = L.dir === "h" ? L.c + i : L.c, r = L.dir === "v" ? L.r + i : L.r;
      if (c >= COLS || r >= ROWS || m.cells[idx(c, r)] === WALL) break;
      real++; cells.push(idx(c, r));
    }
    const rect = L.dir === "h" ? { x: L.c * CELL, y: L.r * CELL + (CELL - LASER_THICK) / 2, w: real * CELL, h: LASER_THICK } : { x: L.c * CELL + (CELL - LASER_THICK) / 2, y: L.r * CELL, w: LASER_THICK, h: real * CELL };
    return { real, cells, rect };
  }

  /** Qual elemento está neste quadrado? {kind, i, end?, pt?} ou null. */
  function elementAt(m, c, r) {
    if (m.start && m.start.c === c && m.start.r === r) return { kind: "start" };
    if (m.key && m.key.c === c && m.key.r === r) return { kind: "key" };
    for (let i = 0; i < m.portals.length; i++) for (const end of ["a", "b"]) { const p = m.portals[i][end]; if (p && p.c === c && p.r === r) return { kind: "portal", i, end }; }
    for (let i = 0; i < m.switches.length; i++) if (m.switches[i].c === c && m.switches[i].r === r) return { kind: "switch", i };
    for (let i = 0; i < m.drones.length; i++) for (let k = 0; k < m.drones[i].route.length; k++) { const p = m.drones[i].route[k]; if (p.c === c && p.r === r) return { kind: "drone", i, pt: k }; }
    for (let i = 0; i < m.gates.length; i++) { const g = m.gates[i]; if (c >= g.c && c <= g.c + 1 && r >= g.r && r <= g.r + 1) return { kind: "gate", i }; }
    if (m.door && c >= m.door.c && c <= m.door.c + 1 && r >= m.door.r && r <= m.door.r + 1) return { kind: "door" };
    for (let i = 0; i < m.lasers.length; i++) if (laserExtent(m, m.lasers[i]).cells.includes(idx(c, r)) || (m.lasers[i].c === c && m.lasers[i].r === r)) return { kind: "laser", i };
    return null;
  }

  function toRows(m) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) { let s = ""; for (let c = 0; c < COLS; c++) s += CH[m.cells[idx(c, r)]]; rows.push(s); }
    return rows;
  }

  /** Retângulos mesclados (linhas -> blocos) de um tipo de quadrado. */
  function rectsOf(m, type) {
    const out = [], open = new Map();
    for (let r = 0; r <= ROWS; r++) {
      const runs = [];
      if (r < ROWS) for (let c = 0; c < COLS; c++) { if (m.cells[idx(c, r)] !== type) continue; let c2 = c; while (c2 + 1 < COLS && m.cells[idx(c2 + 1, r)] === type) c2++; runs.push([c, c2]); c = c2; }
      const next = new Map();
      for (const [c0, c1] of runs) {
        const k = c0 + "-" + c1, o = open.get(k);
        if (o) { o.h += CELL; next.set(k, o); } else { const rc = { x: c0 * CELL, y: r * CELL, w: (c1 - c0 + 1) * CELL, h: CELL }; out.push(rc); next.set(k, rc); }
      }
      open.clear(); next.forEach((v, k) => open.set(k, v));
    }
    return out;
  }

  /** Ida e volta vira um laço fechado do motor: p0..pn, pn-1..p1 (o último volta ao primeiro). */
  const droneLoopPts = (d) => (d.mode === "pingpong" && d.route.length > 2 ? d.route.concat(d.route.slice(1, -1).reverse()) : d.route);

  /** Mapa -> objeto de sala para o MOTOR (mesmo formato de levels.js). As cores dos mecanismos vão em `color`. */
  function toLevel(m) {
    const lv = {
      name: cleanName(m.name) || "Fase personalizada",
      hint: "Fase personalizada (teste)",
      start: cc(m.start), key: cc(m.key), door: { x: (m.door.c + 1) * CELL, y: (m.door.r + 1) * CELL },
      walls: rectsOf(m, WALL), spikes: rectsOf(m, SPIKE),
      gates: m.gates.map((g, i) => { const o = ownerOf(m, g.id); return Object.assign(gateRect(g), { color: o >= 0 ? SW_COL[o % SW_COL.length] : "#8a86b8" }); }),
      switches: [],
      portals: m.portals.filter((p) => p.a && p.b).map((p) => ({ a: cc(p.a), b: cc(p.b) })),
      lasers: m.lasers.map((L) => { const e = laserExtent(m, L).rect; return { x: e.x, y: e.y, w: e.w, h: e.h, on: L.on, off: L.off, warn: LASER_WARN, offset: L.init === "on" ? L.off : 0 }; }).filter((l) => l.w > 0 && l.h > 0),
      drones: m.drones.map((d) => ({ route: droneLoopPts(d).map((p) => { const q = cc(p); return [q.x, q.y]; }), speed: DRONE_SPEED, r: DRONE_R, phase: 0 })),
    };
    m.switches.forEach((s) => { const p = cc(s); s.gates.forEach((gid) => { const gi = m.gates.findIndex((g) => g.id === gid); if (gi >= 0) lv.switches.push({ x: p.x, y: p.y, gate: gi, color: lv.gates[gi].color }); }); });
    return lv;
  }

  /* ---------------- assinatura da revisão (comprovação de conclusão) ----------------
   * Hash FNV-1a do que afeta o JOGO (grade, início/chave/saída, mecanismos e perigos). O nome não entra:
   * renomear não invalida a comprovação; mexer em qualquer coisa jogável, sim. */
  function packElems(m) {
    const gi = (id) => m.gates.findIndex((g) => g.id === id);
    return {
      p: m.portals.map((p) => [p.a ? p.a.c : -1, p.a ? p.a.r : -1, p.b ? p.b.c : -1, p.b ? p.b.r : -1]),
      w: m.switches.map((s) => [s.c, s.r, s.gates.map(gi).filter((i) => i >= 0).sort((a, b) => a - b)]),
      g: m.gates.map((g) => [g.c, g.r]),
      l: m.lasers.map((L) => [L.c, L.r, L.dir === "h" ? 0 : 1, L.len, L.on, L.off, L.init === "on" ? 1 : 0]),
      x: m.drones.map((d) => [d.mode === "pingpong" ? 1 : 0, d.route.map((p) => [p.c, p.r])]),
    };
  }
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
  function gameSig(m) {
    return fnv(JSON.stringify({ r: toRows(m), s: m.start && [m.start.c, m.start.r], k: m.key && [m.key.c, m.key.r], d: m.door && [m.door.c, m.door.r], e: packElems(m) }));
  }
  const proofOk = (m) => !!(m.proof && m.proof.sig === gameSig(m));
  const validLimitVal = (v) => v === 0 || (Number.isInteger(v) && v >= 5 && v <= 300);
  const makeProof = (m, limit, time) => ({ sig: gameSig(m), limit, time });

  /* ---------------- validação ---------------- */
  /**
   * Devolve {ok, complete, errors, warnings, problems(=errors), path}.
   *  - errors: impedem testar/compartilhar. warnings: exigem revisão, mas não bloqueiam.
   *  - path: resultado da verificação de percurso (só roda sem erros estruturais).
   * Achar caminho NÃO garante concluir dentro do tempo escolhido; lasers e drones não entram como paredes.
   */
  function validate(m) {
    const errors = [], warnings = [];
    const err = (msg, cells) => errors.push({ msg, cells: cells || [] });
    const warn = (msg, cells) => warnings.push({ msg, cells: cells || [] });
    const E = (comp) => ({ ok: false, complete: comp, errors, warnings, problems: errors, path: null });
    if (!m.start) err("Falta o ponto inicial do personagem.");
    if (!m.key) err("Falta a chave.");
    if (!m.door) err("Falta a porta de saída.");
    const complete = !!(m.start && m.key && m.door);
    const dc = doorCells(m.door);
    const solidCell = (i) => m.cells[i] !== FLOOR;
    if (m.door) { const bad = dc.filter(solidCell); if (bad.length) err("A saída (2x2 quadrados) está sobre parede ou espinhos.", bad); }
    if (m.start && solidCell(idx(m.start.c, m.start.r))) err("O ponto inicial está sobre parede ou espinhos.", [idx(m.start.c, m.start.r)]);
    if (m.key && solidCell(idx(m.key.c, m.key.r))) err("A chave está sobre parede ou espinhos.", [idx(m.key.c, m.key.r)]);
    if (m.start && m.key && sameCell(m.start, m.key)) err("O início e a chave estão no mesmo quadrado.", [idx(m.start.c, m.start.r)]);
    if (m.start && m.door && dc.includes(idx(m.start.c, m.start.r))) err("O ponto inicial está dentro da saída.", [idx(m.start.c, m.start.r)]);
    if (m.key && m.door && dc.includes(idx(m.key.c, m.key.r))) err("A chave está dentro da saída.", [idx(m.key.c, m.key.r)]);

    const walls = rectsOf(m, WALL), spikes = rectsOf(m, SPIKE);
    const sp = m.start && cc(m.start), kp = m.key && cc(m.key);
    const dr = m.door && { x: m.door.c * CELL, y: m.door.r * CELL, w: 2 * CELL, h: 2 * CELL };
    const gRects = m.gates.map(gateRect);
    const lasers = m.lasers.map((L) => ({ L, e: laserExtent(m, L) }));

    /* --- limites e referências --- */
    if (m.portals.length > LIM.portals) err(`No máximo ${LIM.portals} pares de portais.`);
    if (m.switches.length > LIM.switches) err(`No máximo ${LIM.switches} interruptores.`);
    if (m.gates.length > LIM.gates) err(`No máximo ${LIM.gates} portas controladas.`);
    if (m.lasers.length > LIM.lasers) err(`No máximo ${LIM.lasers} lasers.`);
    if (m.drones.length > LIM.drones) err(`No máximo ${LIM.drones} drones.`);

    /* --- portais --- */
    const ends = [];
    m.portals.forEach((p, i) => {
      const name = `${PORTAL_LET[i]} ${PORTAL_SYM[i]}`;
      if (!p.a || !p.b) { err(`Par de portais ${name} incompleto: falta a outra ponta (coloque a segunda ou exclua a primeira).`, [p.a || p.b].filter(Boolean).map((q) => idx(q.c, q.r))); }
      for (const end of ["a", "b"]) if (p[end]) ends.push({ i, end, name, p: p[end], x: cc(p[end]).x, y: cc(p[end]).y });
    });
    ends.forEach((e) => {
      const cell = [idx(e.p.c, e.p.r)];
      if (solidCell(cell[0])) err(`Portal ${e.name} está sobre parede ou espinhos.`, cell);
      else if ([...walls, ...spikes, ...gRects].some((w) => circleRect(e.x, e.y, 14, w))) err(`Portal ${e.name} sem espaço livre para o personagem: afaste-o de paredes, espinhos e portas controladas (deixe ao menos 1 quadrado livre ao redor).`, cell);
      if (sp && Math.hypot(e.x - sp.x, e.y - sp.y) < 40) err(`Portal ${e.name} muito perto do início (deixe 2 quadrados).`, cell);
      if (kp && Math.hypot(e.x - kp.x, e.y - kp.y) < 30) err(`Portal ${e.name} muito perto da chave.`, cell);
      if (dr && dRect(e.x, e.y, dr) < 30) err(`Portal ${e.name} muito perto da saída.`, cell);
      lasers.forEach(({ e: le }, li) => { if (le.real && dRect(e.x, e.y, le.rect) < 30) err(`Portal ${e.name} muito perto do laser ${li + 1}.`, cell); });
    });
    for (let a = 0; a < ends.length; a++) for (let b = a + 1; b < ends.length; b++) {
      if (Math.hypot(ends[a].x - ends[b].x, ends[a].y - ends[b].y) < 60) err(`Portais ${ends[a].name} e ${ends[b].name} estão perto demais (deixe 3 quadrados).`, [idx(ends[a].p.c, ends[a].p.r), idx(ends[b].p.c, ends[b].p.r)]);
    }

    /* --- portas controladas --- */
    m.gates.forEach((g, i) => {
      const cells = gateCells(g);
      if (g.c < 0 || g.r < 0 || g.c > COLS - 2 || g.r > ROWS - 2) { err(`Porta ${i + 1} fora da área jogável.`); return; }
      if (cells.some(solidCell)) err(`Porta controlada ${i + 1} está sobre parede ou espinhos.`, cells);
      if ((m.start && cells.includes(idx(m.start.c, m.start.r))) || (m.key && cells.includes(idx(m.key.c, m.key.r))) || (m.door && cells.some((c) => dc.includes(c)))) err(`Porta controlada ${i + 1} cobre o início, a chave ou a saída.`, cells);
      for (let j = i + 1; j < m.gates.length; j++) if (cells.some((c) => gateCells(m.gates[j]).includes(c))) err(`Portas controladas ${i + 1} e ${j + 1} se sobrepõem.`, cells);
      lasers.forEach(({ e: le }, li) => { if (le.cells.some((c) => cells.includes(c))) err(`O laser ${li + 1} atravessa a porta controlada ${i + 1}.`, cells); });
      const owners = m.switches.filter((s) => s.gates.includes(g.id)).length;
      if (owners > 1) err(`A porta controlada ${i + 1} pertence a mais de um interruptor (só um por porta).`, cells);
      else if (owners === 0) warn(`Porta controlada ${i + 1} sem interruptor: ficará fechada para sempre.`, cells);
    });

    /* --- interruptores --- */
    m.switches.forEach((s, i) => {
      const c = idx(s.c, s.r), p = cc(s);
      if (solidCell(c)) err(`Interruptor ${i + 1} está sobre parede ou espinhos.`, [c]);
      if ((m.start && sameCell(s, m.start)) || (m.key && sameCell(s, m.key)) || (m.door && dc.includes(c))) err(`Interruptor ${i + 1} está sobre o início, a chave ou a saída.`, [c]);
      if (m.gates.some((g) => gateCells(g).includes(c))) err(`Interruptor ${i + 1} está dentro de uma porta controlada.`, [c]);
      if (lasers.some(({ e: le }) => le.real && dRect(p.x, p.y, le.rect) < 15)) err(`Interruptor ${i + 1} está sobre um laser.`, [c]);
      if (ends.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < 30)) err(`Interruptor ${i + 1} está colado em um portal.`, [c]);
      s.gates.forEach((gid) => { if (!gateById(m, gid)) err(`O interruptor ${i + 1} aponta para uma porta que não existe.`, [c]); });
      if (!s.gates.length) warn(`Interruptor ${i + 1} não está ligado a nenhuma porta.`, [c]);
    });
    for (let a = 0; a < m.switches.length; a++) for (let b = a + 1; b < m.switches.length; b++) if (sameCell(m.switches[a], m.switches[b])) err(`Interruptores ${a + 1} e ${b + 1} no mesmo quadrado.`, [idx(m.switches[a].c, m.switches[a].r)]);

    /* --- lasers --- */
    lasers.forEach(({ L, e }, i) => {
      const cells = [idx(L.c, L.r)], n = i + 1;
      if (!(L.dir === "h" || L.dir === "v") || !Number.isInteger(L.len) || L.len < 1 || L.len > LIM.lenMax) err(`Laser ${n}: comprimento deve ser de 1 a ${LIM.lenMax} quadrados.`, cells);
      if (!(L.on >= LIM.onMin && L.on <= LIM.onMax && Number.isInteger(L.on * 2))) err(`Laser ${n}: tempo ligado deve ser de ${LIM.onMin} a ${LIM.onMax} s (passos de 0,5).`, cells);
      if (!(L.off >= LIM.offMin && L.off <= LIM.offMax && Number.isInteger(L.off * 2))) err(`Laser ${n}: tempo desligado deve ser de ${LIM.offMin} a ${LIM.offMax} s (passos de 0,5).`, cells);
      if (L.init !== "on" && L.init !== "off") err(`Laser ${n}: estado inicial inválido.`, cells);
      if (e.real === 0) { err(`Laser ${n} sem extensão: o quadrado de origem é parede ou fica na borda.`, cells); return; }
      if (e.real < L.len) warn(`Laser ${n}: o feixe para na parede e mede ${e.real} quadrado(s), não ${L.len}.`, e.cells);
      if (sp && dRect(sp.x, sp.y, e.rect) < R + 14) err(`Laser ${n} perto demais do início (o feixe pode atingir o personagem ao começar).`, e.cells);
      if (kp && dRect(kp.x, kp.y, e.rect) < R + 12) err(`Laser ${n} está sobre a chave.`, e.cells);
      if (dr) { const ox = Math.max(dr.x - (e.rect.x + e.rect.w), e.rect.x - (dr.x + dr.w), 0), oy = Math.max(dr.y - (e.rect.y + e.rect.h), e.rect.y - (dr.y + dr.h), 0); if (Math.hypot(ox, oy) < 14) err(`Laser ${n} está sobre a saída.`, e.cells); }
    });

    /* --- drones --- */
    m.drones.forEach((d, i) => {
      const n = i + 1, pts = d.route, cells = pts.map((p) => idx(p.c, p.r));
      if (pts.length < 2) { err(`Drone ${n}: a rota precisa de pelo menos 2 pontos.`, cells); return; }
      if (pts.length > LIM.route) { err(`Drone ${n}: no máximo ${LIM.route} pontos.`, cells); return; }
      if (d.mode !== "loop" && d.mode !== "pingpong") err(`Drone ${n}: tipo de rota inválido.`, cells);
      const segs = [];
      for (let k = 0; k + 1 < pts.length; k++) segs.push([pts[k], pts[k + 1]]);
      if (d.mode === "loop" && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]); // fechamento do circuito
      let minStart = Infinity, minKey = Infinity, minDoor = Infinity, minPortal = Infinity, bad = null;
      for (const [a, b] of segs) {
        const A = cc(a), B = cc(b), len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len < 1) { err(`Drone ${n}: dois pontos seguidos no mesmo quadrado.`, cells); bad = true; break; }
        const steps = Math.ceil(len / 4);
        for (let s = 0; s <= steps; s++) {
          const x = A.x + ((B.x - A.x) * s) / steps, y = A.y + ((B.y - A.y) * s) / steps;
          if (!bad && (walls.some((w) => circleRect(x, y, DRONE_R + 6, w)) || gRects.some((g) => circleRect(x, y, DRONE_R + 6, g)) || x < 0 || y < 0 || x > 800 || y > 500)) bad = [a, b];
          if (sp) minStart = Math.min(minStart, Math.hypot(x - sp.x, y - sp.y));
          if (kp) minKey = Math.min(minKey, Math.hypot(x - kp.x, y - kp.y));
          if (dr) minDoor = Math.min(minDoor, dRect(x, y, dr));
          for (const e of ends) minPortal = Math.min(minPortal, Math.hypot(x - e.x, y - e.y));
        }
      }
      if (bad && bad !== true) err(`Drone ${n}: um trecho da rota ${d.mode === "loop" && pts.length > 2 ? "(incluindo o fechamento do circuito) " : ""}cruza ou encosta em parede ou porta controlada. Mantenha a rota longe (corredor de pelo menos 2 quadrados).`, [idx(bad[0].c, bad[0].r), idx(bad[1].c, bad[1].r)]);
      if (minStart < 60) err(`Drone ${n}: a rota passa perto demais do início (injusto).`, cells);
      if (minPortal < 45) err(`Drone ${n}: a rota passa perto demais de um portal.`, cells);
      if (minKey < 30) warn(`Drone ${n}: a rota passa muito perto da chave.`, cells);
      if (minDoor < 30) warn(`Drone ${n}: a rota passa muito perto da saída.`, cells);
    });

    if (errors.length || !complete) return E(complete);

    /* --- espaço para começar --- */
    const solid = (x, y) => { for (const w of walls) if (circleRect(x, y, R, w)) return true; for (const s of spikes) if (circleRect(x, y, R, s)) return true; return false; };
    if (solid(sp.x, sp.y)) { err("Sem espaço para o personagem começar: deixe um quadrado livre ao redor do ponto inicial (o personagem é um pouco maior que um quadrado).", [idx(m.start.c, m.start.r)]); return E(complete); }

    /* --- verificação de PERCURSO (fecho): portais teletransportam; interruptores alcançados abrem suas portas; lasers e drones ignorados --- */
    const GW = COLS * 2, GH = ROWS * 2, base = new Uint8Array(GW * GH);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (solid(x * 10 + 5, y * 10 + 5)) base[y * GW + x] = 1;
    const gateBlock = m.gates.map((g) => { const rc = gateRect(g), out = []; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (circleRect(x * 10 + 5, y * 10 + 5, R, rc)) out.push(y * GW + x); return out; });
    const kx = kp.x, ky = kp.y;
    const touchKey = (x, y) => (x - kx) ** 2 + (y - ky) ** 2 < (R + 12) ** 2;
    const touchDoor = (x, y) => circleRect(x, y, R, dr);
    const seedsNear = (px, py, blocked) => { const out = []; for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) { if (blocked[y * GW + x]) continue; const cx = x * 10 + 5, cy = y * 10 + 5; if ((cx - px) ** 2 + (cy - py) ** 2 <= 14 * 14 + 100) out.push(y * GW + x); } return out; };
    const portalDest = []; m.portals.forEach((p) => { if (p.a && p.b) { portalDest.push({ from: cc(p.a), to: cc(p.b) }, { from: cc(p.b), to: cc(p.a) }); } });
    const opened = new Set();
    const flood = () => {
      const blocked = new Uint8Array(base);
      m.gates.forEach((g, gi) => { if (!opened.has(g.id)) for (const i of gateBlock[gi]) blocked[i] = 1; });
      const seen = new Uint8Array(GW * GH), q = [];
      const push = (i) => { if (!seen[i] && !blocked[i]) { seen[i] = 1; q.push(i); } };
      seedsNear(sp.x, sp.y, blocked).forEach(push);
      for (let h = 0; h < q.length; h++) {
        const c = q[h], cx = c % GW, cy = (c / GW) | 0, px = cx * 10 + 5, py = cy * 10 + 5;
        for (const t of portalDest) if (Math.hypot(px - t.from.x, py - t.from.y) < 18) seedsNear(t.to.x, t.to.y, blocked).forEach(push);
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
          if (ox && oy && (blocked[cy * GW + nx] || blocked[ny * GW + cx])) continue;
          push(ny * GW + nx);
        }
      }
      return seen;
    };
    let seen = flood(), guard = 0;
    const touched = (seen, s) => { const p = cc(s); for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (seen[y * GW + x] && (x * 10 + 5 - p.x) ** 2 + (y * 10 + 5 - p.y) ** 2 < (R + 10) ** 2) return true; return false; };
    const swReached = m.switches.map(() => false);
    for (let again = true; again && guard++ < 12;) {
      again = false;
      m.switches.forEach((s, i) => { if (!swReached[i] && touched(seen, s)) { swReached[i] = true; s.gates.forEach((gid) => opened.add(gid)); again = true; } });
      if (again) seen = flood();
    }
    const reaches = (goal) => { for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) if (seen[y * GW + x] && goal(x * 10 + 5, y * 10 + 5)) return true; return false; };
    const note = (m.portals.length || m.switches.length) ? " (considerando portais e interruptores)" : "";
    const keyOk = reaches(touchKey);
    if (!keyOk) err("Não há caminho do início até a chave" + note + ": paredes, espinhos ou portas fechadas bloqueiam (corredores precisam de pelo menos 2 quadrados de largura).", [idx(m.start.c, m.start.r), idx(m.key.c, m.key.r)]);
    else if (!reaches(touchDoor)) err("Não há caminho da chave até a saída" + note + ": paredes, espinhos ou portas fechadas bloqueiam (corredores precisam de pelo menos 2 quadrados de largura).", [idx(m.key.c, m.key.r), ...dc]);
    m.switches.forEach((s, i) => { if (!swReached[i] && keyOk) warn(`Interruptor ${i + 1} não pode ser alcançado a partir do início (nem depois de abrir as outras portas).`, [idx(s.c, s.r)]); });
    return { ok: errors.length === 0, complete, errors, warnings, problems: errors, path: { key: keyOk, door: errors.length === 0 } };
  }

  /* ---------------- código de compartilhamento ----------------
   * DSPF2:<base64url do JSON>:<soma>   (DSPF1 — fases antigas, só grade — continua sendo lido)
   * É só uma confirmação local do editor: sem verificação online e sem proteção contra adulteração. */
  const b64enc = (s) => { const bytes = new TextEncoder().encode(s); let bin = ""; bytes.forEach((b) => (bin += String.fromCharCode(b))); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const b64dec = (s) => { const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/")); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return new TextDecoder("utf-8", { fatal: true }).decode(bytes); };
  const sum4 = (s) => { let a = 0; for (let i = 0; i < s.length; i++) a = (a * 31 + s.charCodeAt(i)) % 65521; return a.toString(16).padStart(4, "0"); };

  const proofReason = (m) => (!m.proof ? "Falta concluir esta fase no teste (a conclusão pelo criador é exigida para compartilhar)." : "A conclusão registrada é de uma revisão anterior: o mapa mudou. Conclua o teste de novo.");
  /** Exporta SOMENTE mapas válidos E concluídos pelo criador nesta revisão. */
  function encode(m) {
    const v = validate(m);
    if (!v.ok) return { ok: false, error: "Só fases válidas podem ser exportadas. " + (v.errors[0] ? v.errors[0].msg : "") };
    if (!proofOk(m)) return { ok: false, error: proofReason(m), needProof: true };
    const pe = packElems(m);
    const o = { v: FORMAT, n: cleanName(m.name) || "Fase", r: toRows(m), s: [m.start.c, m.start.r], k: [m.key.c, m.key.r], d: [m.door.c, m.door.r], p: pe.p, w: pe.w, g: pe.g, l: pe.l, x: pe.x, t: { l: m.proof.limit, s: m.proof.time } };
    const b = b64enc(JSON.stringify(o));
    if (b.length > CODE_MAX) return { ok: false, error: "O código ficou grande demais para compartilhar." };
    return { ok: true, code: `DSPF${FORMAT}:${b}:${sum4(b)}` };
  }

  const pt2 = (p, cm, rm) => Array.isArray(p) && p.length === 2 && inGrid(p[0], p[1], cm, rm);
  /** Lê só os elementos novos (p,w,g,l,x) de um objeto de dados. Valida tipos, limites, referências e rotas. */
  function unpackElems(o, m) {
    const bad = (t) => ({ ok: false, error: t });
    if (!Array.isArray(o.p) || o.p.length > LIM.portals) return bad("Portais inválidos (máximo " + LIM.portals + " pares).");
    for (const p of o.p) {
      if (!Array.isArray(p) || p.length !== 4) return bad("Portal inválido.");
      const a = p[0] === -1 && p[1] === -1 ? null : inGrid(p[0], p[1]) ? { c: p[0], r: p[1] } : undefined, b = p[2] === -1 && p[3] === -1 ? null : inGrid(p[2], p[3]) ? { c: p[2], r: p[3] } : undefined;
      if (a === undefined || b === undefined) return bad("Posição de portal inválida.");
      m.portals.push({ a, b });
    }
    if (!Array.isArray(o.g) || o.g.length > LIM.gates) return bad("Portas controladas inválidas (máximo " + LIM.gates + ").");
    for (const g of o.g) { if (!pt2(g, COLS - 1, ROWS - 1)) return bad("Posição de porta controlada inválida."); m.gates.push({ id: m.gates.length + 1, c: g[0], r: g[1] }); }
    if (!Array.isArray(o.w) || o.w.length > LIM.switches) return bad("Interruptores inválidos (máximo " + LIM.switches + ").");
    const owned = new Set();
    for (const s of o.w) {
      if (!Array.isArray(s) || s.length !== 3 || !inGrid(s[0], s[1]) || !Array.isArray(s[2]) || s[2].length > LIM.gates) return bad("Interruptor inválido.");
      const gl = [];
      for (const gi of s[2]) {
        if (!Number.isInteger(gi) || gi < 0 || gi >= m.gates.length) return bad("Interruptor aponta para uma porta que não existe.");
        if (owned.has(gi)) return bad("Uma porta controlada está ligada a mais de um interruptor.");
        owned.add(gi); gl.push(gi + 1);
      }
      m.switches.push({ c: s[0], r: s[1], gates: gl });
    }
    if (!Array.isArray(o.l) || o.l.length > LIM.lasers) return bad("Lasers inválidos (máximo " + LIM.lasers + ").");
    for (const L of o.l) {
      if (!Array.isArray(L) || L.length !== 7 || !inGrid(L[0], L[1]) || (L[2] !== 0 && L[2] !== 1) || !Number.isInteger(L[3]) || L[3] < 1 || L[3] > LIM.lenMax || typeof L[4] !== "number" || typeof L[5] !== "number" || (L[6] !== 0 && L[6] !== 1)) return bad("Laser inválido.");
      if (!(L[4] >= LIM.onMin && L[4] <= LIM.onMax && Number.isInteger(L[4] * 2)) || !(L[5] >= LIM.offMin && L[5] <= LIM.offMax && Number.isInteger(L[5] * 2))) return bad("Tempos do laser fora dos limites.");
      m.lasers.push({ c: L[0], r: L[1], dir: L[2] === 0 ? "h" : "v", len: L[3], on: L[4], off: L[5], init: L[6] === 1 ? "on" : "off" });
    }
    if (!Array.isArray(o.x) || o.x.length > LIM.drones) return bad("Drones inválidos (máximo " + LIM.drones + ").");
    for (const d of o.x) {
      if (!Array.isArray(d) || d.length !== 2 || (d[0] !== 0 && d[0] !== 1) || !Array.isArray(d[1]) || d[1].length < 2 || d[1].length > LIM.route) return bad("Rota de drone inválida (2 a " + LIM.route + " pontos).");
      const route = [];
      for (const p of d[1]) { if (!pt2(p)) return bad("Ponto de rota fora do mapa."); route.push({ c: p[0], r: p[1] }); }
      m.drones.push({ mode: d[0] === 1 ? "pingpong" : "loop", route });
    }
    return { ok: true };
  }

  /** Lê um mapa v1 (só grade) de um objeto de dados. */
  function mapFromData(o) {
    const keys = Object.keys(o).sort().join(",");
    if (keys !== "d,k,n,r,s,v") return { ok: false, error: "Campos inesperados ou ausentes na fase." };
    if (o.v !== 1) return { ok: false, error: `Versão incompatível (formato ${o.v}).` };
    return gridFromData(o);
  }
  function gridFromData(o) {
    if (typeof o.n !== "string" || !o.n.trim() || o.n.length > 200) return { ok: false, error: "Nome da fase inválido." };
    if (!Array.isArray(o.r) || o.r.length !== ROWS) return { ok: false, error: `Dimensões inválidas: esperado ${ROWS} linhas de ${COLS} quadrados.` };
    const m = newMap();
    m.name = cleanName(o.n);
    for (let r = 0; r < ROWS; r++) {
      const row = o.r[r];
      if (typeof row !== "string" || row.length !== COLS) return { ok: false, error: `Dimensões inválidas: a linha ${r + 1} deve ter ${COLS} quadrados.` };
      for (let c = 0; c < COLS; c++) { const t = CH.indexOf(row[c]); if (t < 0) return { ok: false, error: `Elemento desconhecido "${row[c]}" na linha ${r + 1}.` }; m.cells[idx(c, r)] = t; }
    }
    if (!pt2(o.s, COLS, ROWS) || !pt2(o.k, COLS, ROWS) || !pt2(o.d, COLS - 1, ROWS - 1)) return { ok: false, error: "Posição de início, chave ou saída inválida." };
    m.start = { c: o.s[0], r: o.s[1] }; m.key = { c: o.k[0], r: o.k[1] }; m.door = { c: o.d[0], r: o.d[1] };
    return { ok: true, map: m };
  }

  function decode(text) {
    const t = String(text || "").trim();
    if (!t) return { ok: false, error: "Cole um código de fase." };
    if (t.length > CODE_MAX) return { ok: false, error: `Código grande demais (máximo ${CODE_MAX} caracteres).` };
    const mm = /^DSPF(\d{1,3}):([A-Za-z0-9_-]+):([0-9a-f]{4})$/.exec(t);
    if (!mm) return { ok: false, error: "Código inválido: não parece um código de fase deste jogo (esperado DSPF2:… ou DSPF1:…)." };
    const ver = Number(mm[1]);
    if (ver !== 1 && ver !== 2) return { ok: false, error: `Versão incompatível: o código é do formato ${ver} e este jogo lê os formatos 1 e 2.` };
    if (sum4(mm[2]) !== mm[3]) return { ok: false, error: "Código corrompido (a verificação falhou). Copie o código inteiro de novo." };
    let o;
    try { o = JSON.parse(b64dec(mm[2])); } catch (e) { return { ok: false, error: "Código ilegível (dados corrompidos)." }; }
    if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, error: "Estrutura inválida." };
    let r, claimed = null;
    if (ver === 1) {
      if (o.v !== 1) return { ok: false, error: "Versão interna não confere com o código." };
      r = mapFromData(o);
    } else {
      if (Object.keys(o).sort().join(",") !== "d,g,k,l,n,p,r,s,t,v,w,x" || o.v !== 2) return { ok: false, error: "Campos inesperados ou ausentes na fase." };
      if (!o.t || typeof o.t !== "object" || Object.keys(o.t).sort().join(",") !== "l,s" || !validLimitVal(o.t.l) || typeof o.t.s !== "number" || !(o.t.s > 0 && o.t.s < 86400)) return { ok: false, error: "Tempo validado inválido." };
      claimed = { limit: o.t.l, time: o.t.s };
      r = gridFromData(o);
      if (r.ok) { const u = unpackElems(o, r.map); if (!u.ok) return u; }
    }
    if (!r.ok) return r;
    const m = r.map, dc = doorCells(m.door);
    if (m.cells[idx(m.start.c, m.start.r)] !== FLOOR || m.cells[idx(m.key.c, m.key.r)] !== FLOOR || dc.some((i) => m.cells[i] !== FLOOR)) return { ok: false, error: "Elementos sobrepostos: início, chave ou saída estão sobre parede/espinhos." };
    if (sameCell(m.start, m.key) || dc.includes(idx(m.start.c, m.start.r)) || dc.includes(idx(m.key.c, m.key.r))) return { ok: false, error: "Elementos sobrepostos: início, chave e saída devem ocupar lugares diferentes." };
    return { ok: true, map: m, claimed, format: ver };
  }

  /* ---------------- armazenamento local (versionado; falhas são reportadas, nunca mascaradas) ----------------
   * Armazenamento v2: {v:2, maps:[registro]}; registro fmt 2 = fmt 1 + {p,w,g,l,x,proof}. Armazenamento/registros v1
   * (só grade) continuam sendo lidos e são regravados no formato novo quando você salva. */
  const newId = () => "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function toRecord(m, validated) {
    const pe = packElems(m);
    return { id: m.id, name: cleanName(m.name), fmt: FORMAT, rows: toRows(m), s: m.start && [m.start.c, m.start.r], k: m.key && [m.key.c, m.key.r], d: m.door && [m.door.c, m.door.r], p: pe.p, w: pe.w, g: pe.g, l: pe.l, x: pe.x, proof: m.proof ? { sig: m.proof.sig, limit: m.proof.limit, time: m.proof.time } : null, validated: !!validated, ts: Date.now() };
  }
  function fromRecord(rec) {
    if (!rec || (rec.fmt !== 1 && rec.fmt !== FORMAT) || typeof rec.id !== "string" || !Array.isArray(rec.rows) || rec.rows.length !== ROWS) return null;
    const m = newMap(); m.id = rec.id; m.name = cleanName(rec.name);
    for (let r = 0; r < ROWS; r++) { const row = rec.rows[r]; if (typeof row !== "string" || row.length !== COLS) return null; for (let c = 0; c < COLS; c++) { const t = CH.indexOf(row[c]); if (t < 0) return null; m.cells[idx(c, r)] = t; } }
    const pt = (p, cm, rm) => (Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) && p[0] >= 0 && p[0] < cm && p[1] >= 0 && p[1] < rm ? { c: p[0], r: p[1] } : null);
    m.start = pt(rec.s, COLS, ROWS); m.key = pt(rec.k, COLS, ROWS); m.door = pt(rec.d, COLS - 1, ROWS - 1);
    if (rec.fmt === FORMAT) {
      const u = unpackElems(rec, m);
      if (!u.ok) return null;
      const pr = rec.proof;
      if (pr !== null && pr !== undefined) {
        if (!pr || typeof pr !== "object" || typeof pr.sig !== "string" || !/^[0-9a-f]{8}$/.test(pr.sig) || !validLimitVal(pr.limit) || typeof pr.time !== "number" || !(pr.time > 0 && pr.time < 86400)) return null;
        m.proof = { sig: pr.sig, limit: pr.limit, time: pr.time };
      }
    }
    return { map: m, validated: !!rec.validated, ts: rec.ts | 0 };
  }
  /** Valida um objeto de armazenamento inteiro (usado pelo backup). Devolve a lista de itens ou null se QUALQUER registro for inválido. */
  function parseStore(d) {
    if (!d || typeof d !== "object" || (d.v !== 1 && d.v !== FORMAT) || !Array.isArray(d.maps) || d.maps.length > MAX_MAPS) return null;
    const items = d.maps.map(fromRecord);
    if (items.some((x) => !x)) return null;
    if (new Set(items.map((it) => it.map.id)).size !== items.length) return null;
    return items;
  }
  const storeObject = (items) => ({ v: FORMAT, maps: items.map((it) => toRecord(it.map, validate(it.map).ok)) });
  function loadAll() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ok: true, items: [] };
      const d = JSON.parse(raw);
      if (!d || (d.v !== 1 && d.v !== FORMAT) || !Array.isArray(d.maps)) return { ok: true, items: [], note: "Dados salvos em formato desconhecido foram ignorados (não apagados)." };
      return { ok: true, items: d.maps.map(fromRecord).filter(Boolean) };
    } catch (e) { return { ok: false, items: [], error: "Não foi possível ler as fases salvas (armazenamento indisponível ou dados corrompidos)." }; }
  }
  /** Grava a lista inteira. Só devolve ok depois de reler e conferir o que gravou. */
  function writeAll(items) {
    try {
      const json = JSON.stringify({ v: FORMAT, maps: items.map((it) => toRecord(it.map, it.validated)) });
      localStorage.setItem(KEY, json);
      if (localStorage.getItem(KEY) !== json) return { ok: false, error: "O navegador não confirmou a gravação." };
      return { ok: true };
    } catch (e) { return { ok: false, error: "Armazenamento indisponível ou cheio. Nada foi salvo." }; }
  }
  /** Salva (cria ou atualiza) um mapa. */
  function saveMap(m) {
    const l = loadAll();
    if (!l.ok) return { ok: false, error: l.error };
    const items = l.items, v = validate(m);
    if (!m.id) m.id = newId();
    const i = items.findIndex((it) => it.map.id === m.id);
    if (i < 0 && items.length >= MAX_MAPS) return { ok: false, error: `Limite de ${MAX_MAPS} fases salvas. Exclua alguma para salvar outra.` };
    const entry = { map: cloneMap(m), validated: v.ok };
    if (i >= 0) items[i] = entry; else items.push(entry);
    const w = writeAll(items);
    return w.ok ? { ok: true, validated: v.ok, id: m.id } : { ok: false, error: w.error };
  }
  /** Registra a conclusão pelo criador num mapa já salvo (teste feito a partir de "Minhas fases"). */
  function setProof(id, limit, time) {
    const l = loadAll(); if (!l.ok) return { ok: false, error: l.error };
    const it = l.items.find((x) => x.map.id === id); if (!it) return { ok: false, error: "Fase não encontrada." };
    it.map.proof = makeProof(it.map, limit, time);
    const w = writeAll(l.items);
    return w.ok ? { ok: true } : { ok: false, error: w.error };
  }
  function deleteMap(id) {
    const l = loadAll(); if (!l.ok) return { ok: false, error: l.error };
    const w = writeAll(l.items.filter((it) => it.map.id !== id));
    return w.ok ? { ok: true } : { ok: false, error: w.error };
  }
  function duplicateMap(id) {
    const l = loadAll(); if (!l.ok) return { ok: false, error: l.error };
    const src = l.items.find((it) => it.map.id === id); if (!src) return { ok: false, error: "Fase não encontrada." };
    if (l.items.length >= MAX_MAPS) return { ok: false, error: `Limite de ${MAX_MAPS} fases salvas.` };
    const c = cloneMap(src.map); c.id = newId(); c.name = cleanName((src.map.name || "Fase") + " (cópia)"); // ids internos (portas) são locais ao mapa
    l.items.push({ map: c, validated: src.validated });
    const w = writeAll(l.items);
    return w.ok ? { ok: true, id: c.id } : { ok: false, error: w.error };
  }

  root.MapKit = {
    COLS, ROWS, CELL, N, MAX_NAME, MAX_MAPS, CODE_MAX, KEY, FORMAT, FLOOR, WALL, SPIKE, LIM, DRONE_SPEED, DRONE_R, LASER_WARN, PORTAL_LET, PORTAL_SYM, PORTAL_COL, SW_COL,
    newMap, cloneMap, idx, objectAt, elementAt, doorCells, gateCells, gateRect, laserExtent, droneLoopPts, ownerOf, gateById, nextGateId, cc,
    toRows, rectsOf, toLevel, validate, gameSig, proofOk, makeProof, encode, decode, mapFromData, parseStore, storeObject, loadAll, writeAll, saveMap, setProof, deleteMap, duplicateMap, cleanName, newId,
  };
  if (typeof module !== "undefined") module.exports = root.MapKit;
})(typeof window !== "undefined" ? window : globalThis);
