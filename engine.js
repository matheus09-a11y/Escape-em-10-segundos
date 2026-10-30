/* =====================================================================
 * engine.js — regras puras: movimento, colisões, serras, lasers,
 * interruptores e portais. Não toca em DOM nem em canvas (por isso o
 * verificador de fases usa este mesmo arquivo).
 *
 * Impulso (dash): DASH_DIST unidades em DASH_DUR segundos, uma vez por
 * tentativa. Ele usa o mesmo avanço verificado (advance) do movimento normal,
 * em micro-passos, então nunca atravessa paredes, passagens fechadas nem
 * perigos entre quadros — encostar num perigo durante o impulso é derrota.
 *
 * PISOS ESPECIAIS (regras explícitas):
 *  - Gelo (level.ice): o jogador tem velocidade própria (st.vel). Sobre o gelo ela só se
 *    aproxima da velocidade desejada a ICE_ACCEL u/s² (acelera, freia e vira devagar).
 *    Fora do gelo a velocidade acompanha o comando na hora (como antes) — então a
 *    derrapagem só existe enquanto o centro do personagem está no gelo.
 *    Bater numa parede zera a componente da velocidade naquele eixo.
 *  - Esteira (level.belts): soma um empurrão fixo (dir * speed) ao movimento enquanto o
 *    centro está nela. Sem inércia: ao sair, o empurrão acaba. speed < SPEED, então dá
 *    para andar contra o fluxo (velocidade resultante menor).
 *  - Impulso: ignora gelo e esteira durante os 0,1 s (distância fixa de DASH_DIST). Ao terminar,
 *    a velocidade vira dir*SPEED (nunca mais que a velocidade de caminhada), então o gelo
 *    continua o deslize sem multiplicar a velocidade do impulso.
 *  - Portais: só mudam a posição. A velocidade zera na chegada (no gelo, você chega parado;
 *    na esteira, a esteira volta a empurrar). Saídas de portal não devem estar sobre pisos
 *    especiais nas fases (o verificador confere), mas entrar num portal deslizando é permitido.
 *
 * Estado que muda durante uma tentativa fica em um objeto "runtime"
 * (newRuntime): quais passagens estão abertas, quais interruptores foram
 * pisados e qual portal está travado. Reiniciar = criar um runtime novo.
 * Obstáculos móveis (serras, lasers) dependem só do tempo `t` da tentativa,
 * então pausar/reiniciar o tempo congela/restaura tudo automaticamente.
 * ===================================================================== */
(function (root) {
  const WORLD_W = 800;
  const WORLD_H = 500;
  const PLAYER_R = 11; // raio do personagem
  const SPEED = 260; // unidades/seg — igual em qualquer aparelho
  const TIME_LIMIT = 10; // segundos por tentativa
  const KEY_R = 12;
  const DOOR_HALF = 20;
  const SPIKE_INSET = 3; // tolerância: espinhos "machucam" um pouco menos que o desenho
  const LASER_INSET = 2;
  const MOVER_SLACK = 3;
  const STEP = 3; // tamanho máximo de cada micro-passo de movimento
  const SWITCH_R = 10; // alcance do interruptor (somado ao raio do jogador)
  const PORTAL_R = 18; // área de ativação do portal (centro do jogador)
  const PORTAL_EXIT = PORTAL_R + PLAYER_R; // distância para "sair" da área de destino
  const DASH_DIST = 150; // distância do impulso
  const DASH_DUR = 0.1; // duração do impulso (s) -> velocidade DASH_SPEED
  const DASH_SPEED = DASH_DIST / DASH_DUR;
  const COIN_R = 10;
  const ICE_ACCEL = 560; // gelo: quanto a velocidade pode mudar por segundo (u/s²)
  const BELT_SPEED = 110; // esteira: empurrão padrão (u/s)
  const ALERT_TIME = 0.8; // sentinela: segundos vendo o jogador até causar derrota
  const ALERT_DECAY = 1.6; // sentinela: segundos para o alerta cheio esvaziar por completo ao sair da visão (o dobro do tempo de encher)
  const CHASE_WARN = 0.5; // perseguidor: segundos de sinalização antes de começar a perseguir
  const NAV = 10; // perseguidor: tamanho da célula da grade de navegação
  const NAV_W = 80, NAV_H = 50, NAV_N = NAV_W * NAV_H;
  const TAU = Math.PI * 2;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function circleRect(cx, cy, r, rc) {
    const nx = clamp(cx, rc.x, rc.x + rc.w);
    const ny = clamp(cy, rc.y, rc.y + rc.h);
    const dx = cx - nx;
    const dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  /** Preenche campos opcionais para que as fases antigas continuem simples. */
  function normalize(level) {
    level.walls = level.walls || [];
    level.spikes = level.spikes || [];
    level.movers = level.movers || [];
    level.gates = level.gates || [];
    level.switches = level.switches || [];
    level.portals = level.portals || [];
    level.lasers = level.lasers || [];
    level.coin = level.coin || null;
    level.fragments = level.fragments || []; // missões "coleta completa": fragmentos [{x,y}] que também liberam a porta
    level.drones = (level.drones || []).map(prepareDrone);
    level.sentinels = (level.sentinels || []).map(prepareSentinel);
    level.chasers = (level.chasers || []).map((c) => Object.assign({ speed: 150, r: 12, detect: 170 }, c));
    level.ice = level.ice || [];
    level.belts = (level.belts || []).map((b) => Object.assign({ speed: BELT_SPEED }, b));
    // velocidade máxima possível, para escolher quantos sub-passos o movimento usa
    level._vmax = SPEED + Math.max(0, ...level.belts.map((b) => b.speed));
    level.dashDir = level.dashDir || { dx: 1, dy: 0 }; // direção do impulso antes do 1º movimento
    return level;
  }

  /**
   * DRONE DE PATRULHA: percorre `route` (lista de pontos [x,y]) em laço fechado — do último ponto
   * volta ao primeiro — a `speed` u/s, sem perseguir nem atirar. `r` = raio da COLISÃO (o desenho é
   * um pouco maior, então o contato é justo). A posição é função só do tempo da tentativa (como
   * serras e lasers): começa a andar no 1º movimento, congela na pausa/resultado e reinicia a cada
   * tentativa. `phase` (0..1) desloca o ponto de partida ao longo do laço.
   */
  function prepareDrone(d) {
    const pts = d.route.map((p) => ({ x: p[0], y: p[1] }));
    const cum = [0];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      cum.push(cum[i] + Math.hypot(b.x - a.x, b.y - a.y));
    }
    return Object.assign({ speed: 100, r: 12, phase: 0 }, d, { _pts: pts, _cum: cum, _perim: cum[cum.length - 1] });
  }
  /** Posição e direção (dx,dy unitários) do drone no instante t. Preenche `out` se fornecido (evita alocar por quadro). */
  function dronePos(d, t, out) {
    const o = out || {};
    const per = d._perim;
    let s = (((t * d.speed + d.phase * per) % per) + per) % per;
    let i = 0;
    while (i < d._pts.length - 1 && s >= d._cum[i + 1]) i++;
    const a = d._pts[i], b = d._pts[(i + 1) % d._pts.length];
    const len = d._cum[i + 1] - d._cum[i] || 1, k = (s - d._cum[i]) / len;
    o.x = a.x + (b.x - a.x) * k; o.y = a.y + (b.y - a.y) * k;
    o.dx = (b.x - a.x) / len; o.dy = (b.y - a.y) / len;
    return o;
  }
  const _dp = { x: 0, y: 0, dx: 0, dy: 0 };

  /* ------------------------------------------------------------------
   * SENTINELA: fica parada e gira o cone de visão num padrão previsível (vai e volta entre os ângulos
   * a0..a1, em graus, com `period` s por ida e volta; se a0..a1 cobrir 360°, gira sem parar).
   * Só detecta se o CENTRO do jogador estiver dentro do cone (alcance `range`, abertura `fov`) e SEM
   * parede ou passagem fechada entre eles. Vendo-o, o alerta enche em ALERT_TIME; fora da visão cai devagar.
   * Alerta cheio = derrota. Não atira.
   * PERSEGUIDOR: parado até o jogador entrar no raio `detect` com linha de visão livre; sinaliza por
   * CHASE_WARN s e persegue até o fim da tentativa a `speed` (< velocidade do jogador). Navega por uma
   * grade que considera paredes e passagens fechadas (que mudam quando um interruptor abre), com
   * colisão própria: nunca atravessa nem corta quinas. Ignora portais e pisos especiais. Sem caminho
   * (ex.: jogador em outra área), fica parado e recalcula a cada 0,2 s ou quando uma passagem abre.
   * ------------------------------------------------------------------ */
  function prepareSentinel(s) {
    const d = Math.PI / 180;
    return Object.assign({ range: 220, fov: 60, period: 6, phase: 0, a0: 90, a1: 90, r: 14 }, s, {
      _a0: (s.a0 === undefined ? 90 : s.a0) * d, _a1: (s.a1 === undefined ? 90 : s.a1) * d, _half: ((s.fov === undefined ? 60 : s.fov) * d) / 2,
    });
  }
  /** Ângulo (rad) para onde a sentinela olha no instante t. */
  function sentinelAngle(s, t) {
    const span = s._a1 - s._a0;
    if (Math.abs(span) >= TAU - 1e-6) return s._a0 + TAU * (t / s.period + s.phase);
    const u = (((t / s.period + s.phase) % 1) + 1) % 1, d = u < 0.5 ? u * 2 : 2 - u * 2;
    return s._a0 + span * d;
  }
  /** Distância em que o raio (x,y,ang) bate num retângulo, ou Infinity. */
  function rayRect(x, y, dx, dy, r) {
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 2; k++) {
      const o = k ? y : x, d = k ? dy : dx, lo = k ? r.y : r.x, hi = lo + (k ? r.h : r.w);
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return Infinity; }
      else { let a = (lo - o) / d, b = (hi - o) / d; if (a > b) { const tmp = a; a = b; b = tmp; } t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return Infinity; }
    }
    return t0;
  }
  /** Primeira distância (até maxd) em que o raio bate numa parede ou passagem fechada. Usada na visão e no desenho do cone. */
  function castRay(level, rt, x, y, ang, maxd) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let best = maxd;
    for (const w of level.walls) { const d = rayRect(x, y, dx, dy, w); if (d < best) best = d; }
    for (let i = 0; i < level.gates.length; i++) { if (rt && rt.open[i]) continue; const d = rayRect(x, y, dx, dy, level.gates[i]); if (d < best) best = d; }
    return best;
  }
  /** Há parede/passagem fechada entre (x1,y1) e (x2,y2)? */
  function sightBlocked(level, x1, y1, x2, y2, rt) {
    const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
    if (d < 1e-6) return false;
    return castRay(level, rt, x1, y1, Math.atan2(dy, dx), d) < d - 1e-6;
  }
  function sentinelSees(level, s, pos, t, rt, padR, padA) {
    const dx = pos.x - s.x, dy = pos.y - s.y, d = Math.hypot(dx, dy);
    if (d > s.range + (padR || 0)) return false;
    if (d > s.r) {
      let da = Math.atan2(dy, dx) - sentinelAngle(s, t);
      da = Math.abs((((da + Math.PI) % TAU) + TAU) % TAU - Math.PI);
      if (da > s._half + (padA || 0)) return false;
    }
    return !sightBlocked(level, s.x, s.y, pos.x, pos.y, rt);
  }

  const gateMask = (rt) => { let m = 0; for (let i = 0; i < rt.open.length; i++) if (rt.open[i]) m |= 1 << i; return m; };
  /** Grade de navegação (1 = bloqueada) para o estado de passagens `mask`; guardada em cache por fase. */
  function navGrid(level, mask) {
    level._nav = level._nav || {};
    let g = level._nav[mask];
    if (g) return g;
    g = new Uint8Array(NAV_N);
    const rw = 13; // raio do corpo do perseguidor + folga
    const solids = level.walls.slice();
    level.gates.forEach((gt, i) => { if (!(mask & (1 << i))) solids.push(gt); });
    for (let cy = 0; cy < NAV_H; cy++) for (let cx = 0; cx < NAV_W; cx++) {
      const x = cx * NAV + NAV / 2, y = cy * NAV + NAV / 2;
      for (const w of solids) if (circleRect(x, y, rw, w)) { g[cy * NAV_W + cx] = 1; break; }
    }
    level._nav[mask] = g;
    return g;
  }
  const _par = new Int16Array(NAV_N), _closed = new Uint8Array(NAV_N), _g = new Float32Array(NAV_N);
  const _hp = new Int16Array(NAV_N * 8), _hf = new Float32Array(NAV_N * 8);
  /** Caminho mais curto (A*, 8 direções com custo diagonal √2, sem cortar quinas) entre células; escreve em `out` e devolve o tamanho (0 = sem caminho). */
  function navPath(grid, sx, sy, gx, gy, out) {
    const cl = (v, m) => Math.max(0, Math.min(m - 1, v));
    const s = cl((sy / NAV) | 0, NAV_H) * NAV_W + cl((sx / NAV) | 0, NAV_W);
    let goal = cl((gy / NAV) | 0, NAV_H) * NAV_W + cl((gx / NAV) | 0, NAV_W);
    if (grid[goal]) { // jogador colado numa parede: usa uma célula livre vizinha
      let alt = -1;
      for (let oy = -1; oy <= 1 && alt < 0; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = (goal % NAV_W) + ox, y = ((goal / NAV_W) | 0) + oy;
        if (x >= 0 && x < NAV_W && y >= 0 && y < NAV_H && !grid[y * NAV_W + x]) { alt = y * NAV_W + x; break; }
      }
      if (alt < 0) return 0;
      goal = alt;
    }
    const gxc = goal % NAV_W, gyc = (goal / NAV_W) | 0;
    const hfn = (c) => { const dx = Math.abs((c % NAV_W) - gxc), dy = Math.abs(((c / NAV_W) | 0) - gyc); return Math.max(dx, dy) + 0.41421 * Math.min(dx, dy); }; // octile
    _closed.fill(0); _g.fill(Infinity);
    let hn = 0;
    const push = (c, f) => { let k = hn++; _hp[k] = c; _hf[k] = f; while (k > 0) { const p = (k - 1) >> 1; if (_hf[p] <= _hf[k]) break; const tc = _hp[p], tf = _hf[p]; _hp[p] = _hp[k]; _hf[p] = _hf[k]; _hp[k] = tc; _hf[k] = tf; k = p; } };
    const pop = () => { const top = _hp[0]; hn--; if (hn > 0) { _hp[0] = _hp[hn]; _hf[0] = _hf[hn]; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hn && _hf[l] < _hf[m]) m = l; if (r < hn && _hf[r] < _hf[m]) m = r; if (m === k) break; const tc = _hp[m], tf = _hf[m]; _hp[m] = _hp[k]; _hf[m] = _hf[k]; _hp[k] = tc; _hf[k] = tf; k = m; } } return top; };
    _g[s] = 0; _par[s] = -1; push(s, hfn(s));
    let found = false;
    while (hn > 0) {
      const c = pop();
      if (_closed[c]) continue;
      _closed[c] = 1;
      if (c === goal) { found = true; break; }
      const cx = c % NAV_W, cy = (c / NAV_W) | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const nx = cx + ox, ny = cy + oy;
        if (nx < 0 || nx >= NAV_W || ny < 0 || ny >= NAV_H) continue;
        const n = ny * NAV_W + nx;
        if (_closed[n] || grid[n]) continue;
        if (ox && oy && (grid[cy * NAV_W + nx] || grid[ny * NAV_W + cx])) continue; // sem cortar quina
        const ng = _g[c] + (ox && oy ? 1.41421 : 1);
        if (ng < _g[n]) { _g[n] = ng; _par[n] = c; push(n, ng + hfn(n)); }
      }
    }
    if (!found) return 0;
    let len = 0;
    for (let c = goal; c !== -1; c = _par[c]) len++;
    let k = len;
    for (let c = goal; c !== -1; c = _par[c]) out[--k] = c;
    return len;
  }
  /** Move o círculo (cx,cy,r) por (dx,dy) com colisão eixo a eixo (nunca entra em parede/passagem fechada). */
  function moveCircle(level, rt, o, dx, dy, r) {
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 2)), sx = dx / n, sy = dy / n;
    for (let i = 0; i < n; i++) {
      if (!hitsWallR(level, o.x + sx, o.y, r, rt)) o.x += sx;
      if (!hitsWallR(level, o.x, o.y + sy, r, rt)) o.y += sy;
    }
  }
  function hitsWallR(level, x, y, r, rt) {
    for (const w of level.walls) if (circleRect(x, y, r, w)) return true;
    for (let i = 0; i < level.gates.length; i++) { if (rt && rt.open[i]) continue; if (circleRect(x, y, r, level.gates[i])) return true; }
    return false;
  }
  function stepChaser(level, st, i, h) {
    const c = st.rt.ch[i], cfg = level.chasers[i], p = st.pos, rt = st.rt;
    if (c.state === 0) {
      if (Math.hypot(p.x - c.x, p.y - c.y) <= cfg.detect && !sightBlocked(level, c.x, c.y, p.x, p.y, rt)) { c.state = 1; c.timer = 0; }
      return;
    }
    if (c.state === 1) { c.timer += h; if (c.timer >= CHASE_WARN) { c.state = 2; c.repath = 0; c.mask = -1; } return; }
    const mask = gateMask(rt);
    c.repath -= h;
    if (c.repath <= 0 || mask !== c.mask) { // recalcula: a cada 0,2 s e sempre que uma passagem abre
      c.repath = 0.2; c.mask = mask;
      c.pl = navPath(navGrid(level, mask), c.x, c.y, p.x, p.y, c.path);
      c.pi = c.pl > 1 ? 1 : 0;
    }
    if (!c.pl) return; // sem caminho válido: parado até recalcular
    let remaining = cfg.speed * h;
    for (let guard = 0; guard < 4 && remaining > 1e-6; guard++) {
      let tx, ty;
      if (c.pi < c.pl) { const cell = c.path[c.pi]; tx = (cell % NAV_W) * NAV + NAV / 2; ty = ((cell / NAV_W) | 0) * NAV + NAV / 2; }
      else { tx = p.x; ty = p.y; } // chegou à célula do jogador: aproxima direto
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      if (d < 1e-6) { c.pi++; continue; }
      const mv = Math.min(d, remaining);
      moveCircle(level, rt, c, (dx / d) * mv, (dy / d) * mv, cfg.r + 1);
      remaining -= mv;
      if (mv >= d && c.pi < c.pl) c.pi++; else break;
    }
  }
  /** Atualiza sentinelas (alerta) e perseguidores por `h` segundos. Retorna "sentinel" se o alerta encheu. */
  function updateEnemies(level, st, t, h) {
    let hz = null;
    for (let i = 0; i < level.sentinels.length; i++) {
      const s = level.sentinels[i], rt = st.rt;
      if (sentinelSees(level, s, st.pos, t, rt, 0, 0)) rt.al[i] = Math.min(1, rt.al[i] + h / ALERT_TIME);
      else rt.al[i] = Math.max(0, rt.al[i] - h / ALERT_DECAY);
      if (rt.al[i] >= 1) hz = "sentinel";
    }
    for (let i = 0; i < level.chasers.length; i++) stepChaser(level, st, i, h);
    return hz;
  }

  /** Estado inicial de uma tentativa. */
  function newRuntime(level) {
    return {
      open: level.gates.map(() => false), // passagens abertas
      sw: level.switches.map(() => false), // interruptores ativados
      lock: null, // {pair, end} — portal de destino onde o jogador acabou de chegar
      al: level.sentinels.map(() => 0), // alerta de cada sentinela (0..1; 1 = derrota)
      ch: level.chasers.map((c) => ({ x: c.x, y: c.y, state: 0, timer: 0, pi: 0, pl: 0, repath: 0, mask: -1, path: new Int16Array(NAV_N) })), // perseguidores: 0 parado, 1 sinalizando, 2 perseguindo
    };
  }

  function hitsWall(level, x, y, rt) {
    for (const w of level.walls) if (circleRect(x, y, PLAYER_R, w)) return true;
    for (let i = 0; i < level.gates.length; i++) {
      if (rt && rt.open[i]) continue;
      if (circleRect(x, y, PLAYER_R, level.gates[i])) return true;
    }
    return false;
  }

  /** Posição de uma serra no instante t (segundos desde o 1º movimento). */
  function moverPos(m, t) {
    const dx = m.x2 - m.x1;
    const dy = m.y2 - m.y1;
    const len = Math.hypot(dx, dy);
    if (len === 0 || !m.speed) return { x: m.x1, y: m.y1 };
    const period = (2 * len) / m.speed;
    const p = (((t / period + (m.phase || 0)) % 1) + 1) % 1;
    const d = p < 0.5 ? p * 2 : 2 - p * 2;
    return { x: m.x1 + dx * d, y: m.y1 + dy * d };
  }

  /**
   * Estado do laser no instante t: 0 = desligado, 1 = aviso (vai ligar em
   * instantes), 2 = ligado. Ciclo: `off` s apagado (os últimos `warn` s são
   * o aviso) seguido de `on` s ligado. `offset` desloca o ciclo.
   */
  function laserState(l, t) {
    const cycle = l.on + l.off;
    const p = (((t + (l.offset || 0)) % cycle) + cycle) % cycle;
    if (p >= l.off) return 2;
    if (p >= l.off - (l.warn === undefined ? 0.5 : l.warn)) return 1;
    return 0;
  }

  /**
   * Move o jogador `dist` unidades na direção (dx,dy) (não precisa estar
   * normalizada). Faz micro-passos e resolve cada eixo separadamente, então
   * deslizar em paredes funciona e a velocidade não depende do FPS.
   */
  function movePlayer(level, pos, dx, dy, dist, rt, stepLen) {
    const mag = Math.hypot(dx, dy);
    if (mag === 0 || dist <= 0) return { x: pos.x, y: pos.y };
    const ux = dx / mag; // diagonal normalizada -> mesma velocidade
    const uy = dy / mag;
    let x = pos.x;
    let y = pos.y;
    const steps = Math.max(1, Math.ceil(dist / (stepLen || STEP)));
    const s = dist / steps;
    for (let i = 0; i < steps; i++) {
      const nx = clamp(x + ux * s, PLAYER_R, WORLD_W - PLAYER_R);
      if (!hitsWall(level, nx, y, rt)) x = nx;
      const ny = clamp(y + uy * s, PLAYER_R, WORLD_H - PLAYER_R);
      if (!hitsWall(level, x, ny, rt)) y = ny;
    }
    return { x, y };
  }

  /**
   * Devolve "spike", "mover", "drone", "chaser", "sentinel", "laser" ou null se o jogador estiver em perigo.
   * `safe` (opcional, só o verificador usa): {pad, dt} — alarga os perigos em `pad` unidades e
   * considera o laser ligado de `dt` s antes até `dt` s depois, para só aprovar percursos com folga humana.
   */
  function hazardAt(level, pos, t, safe, rt) {
    const pad = (safe && safe.pad) || 0, tol = (safe && safe.dt) || 0;
    for (const s of level.spikes) {
      const k = SPIKE_INSET - pad;
      const inner = { x: s.x + k, y: s.y + k, w: s.w - 2 * k, h: s.h - 2 * k };
      if (circleRect(pos.x, pos.y, PLAYER_R, inner)) return "spike";
    }
    for (const m of level.movers) {
      if (!m.r) continue;
      const p = moverPos(m, t);
      const rr = PLAYER_R + m.r - MOVER_SLACK + pad;
      if ((pos.x - p.x) ** 2 + (pos.y - p.y) ** 2 < rr * rr) return "mover";
    }
    if (rt) for (let i = 0; i < level.chasers.length; i++) { // contato com o perseguidor (posição atual)
      const c = rt.ch[i], rr = PLAYER_R + level.chasers[i].r + pad;
      if ((pos.x - c.x) ** 2 + (pos.y - c.y) ** 2 < rr * rr) return "chaser";
    }
    if (safe && level.stealth) for (let i = 0; i < level.chasers.length; i++) { // verificador (furtividade): estar onde acordaria o perseguidor já reprova
      const c = level.chasers[i];
      if (Math.hypot(pos.x - c.x, pos.y - c.y) <= c.detect + pad && !sightBlocked(level, c.x, c.y, pos.x, pos.y, rt)) return "woke";
    }
    if (safe && safe.ang !== undefined) for (const s of level.sentinels) if (sentinelSees(level, s, pos, t, rt, pad * 2, safe.ang)) return "sentinel"; // verificador: nenhuma exposição
    for (const d of level.drones) {
      const p = dronePos(d, t, _dp);
      const rr = PLAYER_R + d.r + pad; // colisão: raio do drone (menor que o desenho) + raio do jogador
      if ((pos.x - p.x) ** 2 + (pos.y - p.y) ** 2 < rr * rr) return "drone";
    }
    for (const l of level.lasers) {
      const on = laserState(l, t) === 2 || (tol > 0 && (laserState(l, t - tol) === 2 || laserState(l, t + tol) === 2));
      if (!on) continue;
      const k = LASER_INSET - pad;
      const inner = { x: l.x + k, y: l.y + k, w: l.w - 2 * k, h: l.h - 2 * k };
      if (circleRect(pos.x, pos.y, PLAYER_R, inner)) return "laser";
    }
    return null;
  }

  function touchesKey(level, pos, pad) {
    const r = PLAYER_R + KEY_R - (pad || 0);
    return (pos.x - level.key.x) ** 2 + (pos.y - level.key.y) ** 2 < r * r;
  }

  function touchesDoor(level, pos, pad) {
    const d = level.door, h = DOOR_HALF - (pad || 0);
    return circleRect(pos.x, pos.y, PLAYER_R, { x: d.x - h, y: d.y - h, w: h * 2, h: h * 2 });
  }

  /** Ativa interruptores pisados (permanecem ativos). Retorna índices novos. */
  function activateSwitches(level, pos, rt, pad) {
    const fresh = [];
    level.switches.forEach((s, i) => {
      if (rt.sw[i]) return;
      const r = PLAYER_R + SWITCH_R - (pad || 0);
      if ((pos.x - s.x) ** 2 + (pos.y - s.y) ** 2 < r * r) {
        rt.sw[i] = true;
        rt.open[s.gate] = true;
        fresh.push(i);
      }
    });
    return fresh;
  }

  /**
   * Portais: ao entrar na área de uma ponta, vai para a outra e fica
   * "travado" nela até o jogador sair da área de destino — sem loops.
   * Retorna {pos, pair, from, to} se teletransportou, senão null.
   */
  function applyPortals(level, pos, rt) {
    if (rt.lock) {
      const p = level.portals[rt.lock.pair][rt.lock.end];
      if (Math.hypot(pos.x - p.x, pos.y - p.y) > PORTAL_EXIT) rt.lock = null;
    }
    for (let i = 0; i < level.portals.length; i++) {
      for (const end of ["a", "b"]) {
        if (rt.lock && rt.lock.pair === i && rt.lock.end === end) continue;
        const p = level.portals[i][end];
        if (Math.hypot(pos.x - p.x, pos.y - p.y) < PORTAL_R) {
          const other = end === "a" ? "b" : "a";
          const dest = level.portals[i][other];
          rt.lock = { pair: i, end: other };
          return { pos: { x: dest.x, y: dest.y }, pair: i, from: { x: p.x, y: p.y }, to: { x: dest.x, y: dest.y } };
        }
      }
    }
    return null;
  }

  /** Piso sob o centro do jogador: {kind:"ice"} | {kind:"belt", vx, vy} | null. */
  function floorAt(level, x, y) {
    for (const r of level.ice) if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return { kind: "ice" };
    for (const b of level.belts) {
      if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { kind: "belt", vx: b.dx * b.speed, vy: b.dy * b.speed };
    }
    return null;
  }

  /** Desloca (dx,dy) em micro-passos (eixo a eixo). Retorna {x, y, bx, by}: bx/by = bateu em parede/borda naquele eixo. */
  function moveBy(level, pos, dx, dy, rt, stepLen) {
    const dist = Math.hypot(dx, dy);
    let x = pos.x, y = pos.y, bx = false, by = false;
    if (dist === 0) return { x, y, bx, by };
    const steps = Math.max(1, Math.ceil(dist / (stepLen || STEP)));
    const sx = dx / steps, sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      if (sx !== 0) {
        const nx = clamp(x + sx, PLAYER_R, WORLD_W - PLAYER_R);
        if (nx !== x + sx || hitsWall(level, nx, y, rt)) bx = true; else x = nx;
      }
      if (sy !== 0) {
        const ny = clamp(y + sy, PLAYER_R, WORLD_H - PLAYER_R);
        if (ny !== y + sy || hitsWall(level, x, ny, rt)) by = true; else y = ny;
      }
    }
    return { x, y, bx, by };
  }

  /** Atualiza st.vel para o instante h (s) conforme o piso e o comando (ux,uy). Retorna o piso. */
  function updateVelocity(level, st, ux, uy, h) {
    const surf = floorAt(level, st.pos.x, st.pos.y);
    const mag = Math.hypot(ux, uy);
    const tx = mag ? (ux / mag) * SPEED : 0;
    const ty = mag ? (uy / mag) * SPEED : 0;
    if (surf && surf.kind === "ice") {
      const ddx = tx - st.vel.x, ddy = ty - st.vel.y, len = Math.hypot(ddx, ddy), maxd = ICE_ACCEL * h;
      if (len <= maxd) { st.vel.x = tx; st.vel.y = ty; }
      else { st.vel.x += (ddx / len) * maxd; st.vel.y += (ddy / len) * maxd; }
    } else { st.vel.x = tx; st.vel.y = ty; }
    return surf;
  }

  function touchesCoin(level, pos, pad) {
    if (!level.coin) return false;
    const r = PLAYER_R + COIN_R - (pad || 0);
    return (pos.x - level.coin.x) ** 2 + (pos.y - level.coin.y) ** 2 < r * r;
  }

  /** Interações a cada micro-passo: interruptores, chave, moeda, portais, perigos e porta. true = terminou (perigo/porta). */
  function interact(level, st, res, t, opts, h) {
    const pp = (opts && opts.safe && opts.safe.pad) || 0; // só o verificador: coletas exigem folga
    for (const k of activateSwitches(level, st.pos, st.rt, pp)) res.switches.push(k);
    if (!st.hasKey && touchesKey(level, st.pos, pp)) { st.hasKey = true; res.gotKey = true; }
    if (!st.coin && touchesCoin(level, st.pos, pp)) { st.coin = true; res.gotCoin = true; }
    for (let i = 0; i < level.fragments.length; i++) { // fragmentos (máscara de bits em st.frag)
      if (st.frag & (1 << i)) continue;
      const f = level.fragments[i], r = PLAYER_R + COIN_R - pp;
      if ((st.pos.x - f.x) ** 2 + (st.pos.y - f.y) ** 2 < r * r) { st.frag = (st.frag | (1 << i)); res.gotFrag.push(i); }
    }
    const tp = applyPortals(level, st.pos, st.rt);
    if (tp) { st.pos = tp.pos; st.vel = { x: 0, y: 0 }; res.teleports.push(tp); }
    if (!(opts && opts.noEnemies) && h) { const eh = updateEnemies(level, st, t, h); if (eh) { res.hazard = eh; return true; } }
    const hz = hazardAt(level, st.pos, t, opts && opts.safe, st.rt);
    if (hz) { res.hazard = hz; return true; }
    if (level.stealth && st.rt.ch.some((c) => c.state > 0)) { res.hazard = "woke"; return true; } // furtividade: acordar um perseguidor é derrota
    if (st.hasKey && fragmentsDone(level, st) && touchesDoor(level, st.pos, pp)) { res.won = true; return true; }
    return false;
  }
  const fragmentsDone = (level, st) => level.fragments.length === 0 || (st.frag | 0) === (1 << level.fragments.length) - 1;
  const newResult = () => ({ hazard: null, won: false, teleports: [], switches: [], gotKey: false, gotCoin: false, gotFrag: [] });

  /**
   * Movimento normal por `dt` segundos com o comando (ux,uy) — a mesma função serve o jogo e o
   * verificador. Divide em sub-passos (para pisos e perigos serem checados ao longo do trajeto),
   * atualiza a velocidade (gelo) e soma a esteira. `st` = {pos, vel, hasKey, coin, rt}.
   * Retorna {hazard, won, teleports, switches, gotKey, gotCoin}.
   * opts.stepLen: tamanho do micro-passo (padrão STEP).
   */
  function stepPlayer(level, st, ux, uy, dt, t0, opts) {
    const res = newResult();
    const stepLen = (opts && opts.stepLen) || STEP;
    const n = Math.max(1, Math.ceil((level._vmax * dt) / stepLen));
    const h = dt / n;
    for (let i = 1; i <= n; i++) {
      const vx0 = st.vel.x, vy0 = st.vel.y;
      const surf = updateVelocity(level, st, ux, uy, h);
      let vx = st.vel.x, vy = st.vel.y;
      // No gelo a velocidade muda continuamente: usar a média do passo (trapézio) deixa a distância deslizada
      // independente do tamanho do passo/taxa de quadros. Fora dele a velocidade acompanha o comando na hora.
      if (surf && surf.kind === "ice") { vx = (vx0 + vx) / 2; vy = (vy0 + vy) / 2; }
      if (surf && surf.kind === "belt") { vx += surf.vx; vy += surf.vy; }
      if (vx !== 0 || vy !== 0) {
        const m = moveBy(level, st.pos, vx * h, vy * h, st.rt, stepLen);
        st.pos = { x: m.x, y: m.y };
        if (m.bx) st.vel.x = 0;
        if (m.by) st.vel.y = 0;
      }
      if (interact(level, st, res, t0 + h * i, opts, h)) return res;
    }
    return res;
  }

  /**
   * IMPULSO: avança `dist` unidades na direção (dx,dy) em micro-passos, ignorando gelo e esteira,
   * checando paredes e perigos a CADA micro-passo (instante interpolado entre t0 e t0+dur).
   * Ao terminar sem portal/derrota, a velocidade vira dir*SPEED. opts.stopOnTeleport encerra no portal.
   */
  function advance(level, st, dx, dy, dist, t0, dur, opts) {
    const res = newResult();
    const mag = Math.hypot(dx, dy);
    if (mag === 0 || dist <= 0) return res;
    const stepLen = (opts && opts.stepLen) || STEP;
    const steps = Math.max(1, Math.ceil(dist / stepLen));
    const s = dist / steps;
    for (let i = 1; i <= steps; i++) {
      st.pos = movePlayer(level, st.pos, dx, dy, s, st.rt, stepLen);
      if (interact(level, st, res, t0 + (dur * i) / steps, opts, dur / steps)) return res;
      if (res.teleports.length && opts && opts.stopOnTeleport) return res;
    }
    st.vel = { x: (dx / mag) * SPEED, y: (dy / mag) * SPEED };
    return res;
  }

  const Engine = {
    DASH_DIST, DASH_DUR, DASH_SPEED, COIN_R, ICE_ACCEL, BELT_SPEED, touchesCoin, advance, stepPlayer, floorAt, moveBy,
    WORLD_W, WORLD_H, PLAYER_R, SPEED, TIME_LIMIT, KEY_R, DOOR_HALF, SWITCH_R, PORTAL_R, PORTAL_EXIT,
    circleRect, normalize, newRuntime, fragmentsDone, moverPos, dronePos, sentinelAngle, sentinelSees, sightBlocked, castRay, navGrid, navPath, ALERT_TIME, ALERT_DECAY, CHASE_WARN, NAV, laserState, movePlayer, hazardAt,
    touchesKey, touchesDoor, hitsWall, activateSwitches, applyPortals,
  };
  root.Engine = Engine;
  if (typeof module !== "undefined") module.exports = Engine;
})(typeof window !== "undefined" ? window : globalThis);
