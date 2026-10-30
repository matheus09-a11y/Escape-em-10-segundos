/* Núcleo do verificador de fases (usado pelo Node e pelos Web Workers).
 * Busca em largura no tempo (passo de 0,1 s; 8 direções + parado + impulso em
 * 8 direções), usando as MESMAS regras do jogo (Engine.advance).
 *
 * Para cada fase confere:
 *  1. itens, moeda e portais fora de paredes e longe de perigos (portais: >= 40);
 *  2. início sem perigo, sem laser perto do início;
 *  3. existe vitória em <= 7 s (folga para o toque); fases 1-11 SEM usar impulso;
 *  4. a moeda é alcançável (<= 8,5 s), sem impulso nas fases 1-11;
 *  5. interruptor e portal são realmente necessários;
 *  6. fases 13-15 exigem o impulso (sem ele são impossíveis);
 *  7. pisos: gelo/esteira sem sobreposição, início fora deles, esteiras mais lentas que o jogador;
 *     fases 1-11 e 16-20 possíveis SEM impulso (13-15 exigem impulso);
 *  8. (folga) todas as buscas usam perigos 5 u maiores e lasers com ±0,12 s de tolerância;
 *  9. tempo-alvo existe e é possível: >= melhor tempo com impulso + 0,5 s e < 10 s. */
(function (root) {
  const IN_NODE = typeof module !== "undefined" && module.exports;
  const E = IN_NODE ? require("../engine.js") : root.Engine;
  const LEVELS = IN_NODE ? require("../levels.js") : root.LEVELS;
  LEVELS.forEach(E.normalize);
  const MISSIONS = IN_NODE ? require("../missions.js") : root.MISSIONS; // missões: cópias independentes (clonadas de LEVELS_RAW)
  MISSIONS.forEach((m) => E.normalize(m.level));

  const DT = E.DASH_DUR; // 0,1 s: um impulso cabe exatamente num passo
  const CELL = 12;
  const STEP_LEN = 9; // micro-passo do verificador (o jogo usa 3)
  const SAFE = { pad: 5, dt: 0.12, ang: 0.1 }; // folga humana: perigos 5 u maiores, lasers ±0,12 s e sentinelas com cone 6° maior (nunca ser visto)
  const MAX_ANY = 7.0;
  const MAX_COIN = 8.5;
  const PORTAL_CLEAR = 40;
  const dirs = [[0, 0]];
  const dirs8 = [];
  for (let a = 0; a < 8; a++) { const d = [Math.cos((a * Math.PI) / 4), Math.sin((a * Math.PI) / 4)]; dirs.push(d); dirs8.push(d); }

  const distRect = (p, r) => {
    const nx = Math.max(r.x, Math.min(p.x, r.x + r.w)), ny = Math.max(r.y, Math.min(p.y, r.y + r.h));
    return Math.hypot(p.x - nx, p.y - ny);
  };
  const distSeg = (p, m) => {
    const dx = m.x2 - m.x1, dy = m.y2 - m.y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - m.x1) * dx + (p.y - m.y1) * dy) / l2)) : 0;
    return Math.hypot(p.x - (m.x1 + t * dx), p.y - (m.y1 + t * dy));
  };

  /** Menor distância de um ponto à rota (laço fechado) de um drone. */
  function routeDist(p, d) {
    let m = Infinity;
    for (let i = 0; i < d._pts.length; i++) {
      const a = d._pts[i], b = d._pts[(i + 1) % d._pts.length];
      m = Math.min(m, distSeg(p, { x1: a.x, y1: a.y, x2: b.x, y2: b.y }));
    }
    return m;
  }

  function sanity(lv) {
    const errs = [];
    const solids = lv.walls.concat(lv.gates);
    const pts = [["início", lv.start], ["chave", lv.key], ["porta", lv.door]];
    lv.switches.forEach((s, i) => pts.push(["interruptor " + (i + 1), s]));
    lv.portals.forEach((p, i) => { pts.push(["portal " + (i + 1) + "A", p.a]); pts.push(["portal " + (i + 1) + "B", p.b]); });
    for (const [n, p] of pts) if (solids.some((w) => E.circleRect(p.x, p.y, E.PLAYER_R, w))) errs.push(n + " encostando em parede/passagem");
    const clear = (tag, p, minDist) => {
      if (solids.some((w) => distRect(p, w) < minDist)) errs.push(tag + " perto demais de parede/passagem");
      if (lv.spikes.some((s) => distRect(p, s) < minDist)) errs.push(tag + " perto demais de espinhos");
      if (lv.lasers.some((l) => distRect(p, l) < minDist)) errs.push(tag + " perto demais de laser");
      if (lv.movers.some((m) => distSeg(p, m) < m.r + E.PLAYER_R + minDist - 15)) errs.push(tag + " perto demais do trilho de serra");
      if (lv.drones.some((d) => routeDist(p, d) < d.r + E.PLAYER_R + minDist)) errs.push(tag + " perto demais da rota de drone");
    };
    lv.portals.forEach((pr, i) => { clear("portal " + (i + 1) + "A", pr.a, PORTAL_CLEAR); clear("portal " + (i + 1) + "B", pr.b, PORTAL_CLEAR); });
    lv.fragments.forEach((f, k) => {
      clear("fragmento " + (k + 1), f, 30);
      for (const [n, p] of pts) if (Math.hypot(p.x - f.x, p.y - f.y) < 40) errs.push("fragmento " + (k + 1) + " perto demais de " + n);
    });
    if (lv.fragments.length && lv.fragments.length !== 3) errs.push("coleta completa precisa de 3 fragmentos");
    if (!lv.coin) errs.push("sem moeda");
    else {
      clear("moeda", lv.coin, 30);
      for (const [n, p] of pts) if (Math.hypot(p.x - lv.coin.x, p.y - lv.coin.y) < 40) errs.push("moeda perto demais de " + n);
    }
    if (E.hazardAt(lv, lv.start, 0)) errs.push("início em perigo");
    if (lv.lasers.some((l) => distRect(lv.start, l) < 80)) errs.push("laser muito perto do início");
    lv.switches.forEach((s, i) => { if (!lv.gates[s.gate]) errs.push("interruptor " + (i + 1) + " sem passagem"); });
    // drones: rota longe de paredes, do início, da chave e da porta (nada "surge" sobre eles)
    lv.drones.forEach((d, k) => {
      const tag = "drone " + (k + 1);
      if (d._pts.length < 2 || d.speed <= 0) errs.push(tag + " sem rota válida");
      for (let i = 0; i < d._pts.length; i++) {
        const a = d._pts[i], b = d._pts[(i + 1) % d._pts.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5));
        for (let j = 0; j <= n; j++) {
          const p = { x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n };
          if (p.x < 0 || p.x > E.WORLD_W || p.y < 0 || p.y > E.WORLD_H) { errs.push(tag + " fora da sala"); i = 99; break; }
          if (solids.some((w) => distRect(p, w) < d.r + 6)) { errs.push(tag + " rota atravessa/encosta em parede ou passagem"); i = 99; break; }
        }
      }
      if (routeDist(lv.start, d) < 80) errs.push(tag + " rota perto demais do início");
      if (routeDist(lv.key, d) < 40) errs.push(tag + " rota perto demais da chave");
      if (routeDist(lv.door, d) < 40) errs.push(tag + " rota perto demais da porta");
    });
    // sentinelas e perseguidores
    const rt0 = E.newRuntime(lv);
    lv.sentinels.forEach((s, k) => {
      const tag = "sentinela " + (k + 1);
      for (const [n, p] of [["início", lv.start], ["chave", lv.key], ["porta", lv.door]]) if (Math.hypot(p.x - s.x, p.y - s.y) < 50) errs.push(tag + " perto demais de " + n);
      for (let t = 0; t <= 1.5; t += 0.1) if (E.sentinelSees(lv, s, lv.start, t, rt0, 0, 0.1)) { errs.push(tag + " vê o início nos primeiros 1,5 s"); break; }
      lv.portals.forEach((pr, i) => { for (const [e, p] of [["A", pr.a], ["B", pr.b]]) for (let t = 0; t <= 10; t += 0.25) if (E.sentinelSees(lv, s, p, t, rt0, 10, 0.1)) { errs.push(tag + " enxerga o portal " + (i + 1) + e); break; } });
    });
    const navbuf = new Int16Array(4000);
    lv.chasers.forEach((c, k) => {
      const tag = "perseguidor " + (k + 1);
      if (solids.some((w) => E.circleRect(c.x, c.y, c.r + 2, w))) errs.push(tag + " dentro de parede");
      if (Math.hypot(lv.start.x - c.x, lv.start.y - c.y) < c.detect + 40) errs.push(tag + " perto demais do início (ativaria logo)");
      for (const [n, p] of [["chave", lv.key], ["porta", lv.door]]) if (Math.hypot(p.x - c.x, p.y - c.y) < 40) errs.push(tag + " em cima da " + n);
      lv.portals.forEach((pr, i) => { // saída (B) precisa ser segura: longe do perseguidor ou em outra área
        const d = Math.hypot(pr.b.x - c.x, pr.b.y - c.y);
        if (d < c.detect + 60 && E.navPath(E.navGrid(lv, 0), c.x, c.y, pr.b.x, pr.b.y, navbuf) > 0) errs.push(tag + " perto demais da saída do portal " + (i + 1));
      });
    });
    // pisos especiais
    const inRect = (p, r) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
    const ov = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const i of lv.ice) for (const b of lv.belts) if (ov(i, b)) errs.push("gelo sobreposto a esteira");
    for (let a = 0; a < lv.belts.length; a++) for (let b = a + 1; b < lv.belts.length; b++) if (ov(lv.belts[a], lv.belts[b])) errs.push("esteiras sobrepostas");
    for (const b of lv.belts) {
      if (Math.abs(b.dx) + Math.abs(b.dy) !== 1) errs.push("esteira com direção inválida");
      if (b.speed >= 0.6 * E.SPEED) errs.push("esteira rápida demais para andar contra o fluxo");
    }
    const special = lv.ice.concat(lv.belts);
    if (special.some((r) => inRect(lv.start, r))) errs.push("início sobre piso especial");
    lv.portals.forEach((pr, i) => { for (const p of [pr.a, pr.b]) if (lv.ice.some((r) => inRect(p, r))) errs.push("portal " + (i + 1) + " sobre gelo"); });
    if (!lv.target) errs.push("sem tempo-alvo");
    return errs;
  }

  /** o: {dash, trackCoin, ablate:"switch"|"portal"}. Retorna {any, coin} (s) ou null nos campos sem solução. */
  function search(level, o) {
    const lv = Object.assign({}, level);
    if (o.ablate === "portal") lv.portals = [];
    if (o.ablate === "switch") lv.switches = [];
    const cloneRt = (rt) => ({ open: rt.open.slice(), sw: rt.sw.slice(), lock: rt.lock ? { ...rt.lock } : null, al: rt.al, ch: rt.ch }); // inimigos não se movem na busca (noEnemies); perseguidores são conferidos no replay
    const useVel = lv.ice.length > 0; // sem gelo, a velocidade é só o comando e não entra no estado
    const cell = useVel ? 20 : CELL; // com gelo o estado é maior (velocidade): grade mais grossa
    let frontier = [{ x: lv.start.x, y: lv.start.y, key: false, coin: false, dash: false, rt: E.newRuntime(lv), vel: { x: 0, y: 0 }, frag: 0, moved: false, par: null }];
    const out = { any: null, coin: null };
    const steps = Math.round(E.TIME_LIMIT / DT);
    for (let k = 1; k <= steps; k++) {
      const seen = new Set();
      const next = [];
      const t0 = (k - 1) * DT;
      for (const n of frontier) {
        const nd = [];
        for (const d of dirs) nd.push([d[0], d[1], false]);
        if (o.dash && !n.dash) for (const d of dirs8) nd.push([d[0], d[1], true]);
        for (const [dx, dy, isDash] of nd) {
          // No jogo o cronômetro só começa no 1º movimento: esperar parado no início não gasta tempo nem muda a fase dos lasers/serras
          if (dx === 0 && dy === 0 && !n.moved) continue;
          const st = { pos: { x: n.x, y: n.y }, hasKey: n.key, coin: n.coin, rt: cloneRt(n.rt), vel: { x: n.vel.x, y: n.vel.y }, frag: n.frag };
          let r;
          if (isDash) r = E.advance(lv, st, dx, dy, E.DASH_DIST, t0, DT, { stepLen: STEP_LEN, stopOnTeleport: true, safe: SAFE, noEnemies: true });
          else r = E.stepPlayer(lv, st, dx, dy, DT, t0, { stepLen: STEP_LEN, safe: SAFE, noEnemies: true });
          if (r.hazard) continue;
          if (o.nonstop && !isDash && !(r.teleports && r.teleports.length) && Math.hypot(st.pos.x - n.x, st.pos.y - n.y) < 3) continue; // sem parar: passo praticamente parado (ou preso na parede) é proibido
          if (r.won) {
            const t = Math.round(k * DT * 100) / 100;
            if (out.any === null) { out.any = t; if (o.wantPath) { const acts = [[dx, dy, isDash]]; for (let q = n; q && q.par; q = q.par) acts.push(q.act); out.path = acts.reverse(); /* ações por passo de 0,1 s: [dx, dy, impulso] */ } }
            if (st.coin && out.coin === null) out.coin = t;
            if (!o.trackCoin || out.coin !== null) return out;
            continue;
          }
          const velCode = useVel ? (Math.round(st.vel.x / 200) + 1) * 3 + (Math.round(st.vel.y / 200) + 1) : 0;
          const lockCode = st.rt.lock ? 1 + st.rt.lock.pair * 2 + (st.rt.lock.end === "b" ? 1 : 0) : 0;
          const mask = st.rt.open.reduce((a, v, i) => a | (v ? 1 << i : 0), 0);
          const id = (((((((Math.round(st.pos.x / cell) * 48 + Math.round(st.pos.y / cell)) * 2 + (st.hasKey ? 1 : 0)) * 2 + (st.coin ? 1 : 0)) * 2 + (n.dash || isDash ? 1 : 0)) * 4 + mask) * 6 + lockCode) * 25 + velCode) * 8 + (st.frag | 0);
          if (seen.has(id)) continue;
          seen.add(id);
          next.push({ x: st.pos.x, y: st.pos.y, key: st.hasKey, coin: st.coin, dash: n.dash || isDash, rt: st.rt, vel: st.vel, frag: st.frag | 0, moved: true, par: o.wantPath ? n : null, act: [dx, dy, isDash] });
        }
      }
      frontier = next;
    }
    return out;
  }

  /** Reproduz um caminho (ações por 0,1 s) com a física REAL do jogo (60 fps) incluindo sentinelas e perseguidores. */
  function replay(level, path) {
    const rt = E.newRuntime(level);
    const st = { pos: { x: level.start.x, y: level.start.y }, vel: { x: 0, y: 0 }, hasKey: false, coin: false, rt };
    let t = 0, last = path[path.length - 1] || [0, 0, false];
    const frame = (dx, dy) => { const r = E.stepPlayer(level, st, dx, dy, 1 / 60, t, {}); t += 1 / 60; return r; };
    for (const [dx, dy] of path) for (let f = 0; f < 6; f++) { const r = frame(dx, dy); if (r.hazard) return { ok: false, why: r.hazard, t }; if (r.won) return { ok: true, t }; }
    for (let f = 0; f < 60; f++) { const r = frame(last[0], last[1]); if (r.hazard) return { ok: false, why: r.hazard, t }; if (r.won) return { ok: true, t }; }
    return { ok: false, why: "sem vitória", t };
  }

  /** Roda tudo para a fase `i` e devolve {i, name, ok, lines, data}. */
  /** Missão: possível em 10 s COM a restrição do objetivo (sem impulso / 3 fragmentos / furtivo / sem parar). */
  function analyzeMission(m) {
    const lv = m.level, tag = `Missão ${m.id} (sala ${m.base}, ${m.goal})`;
    const errs = sanity(lv);
    if (errs.length) return { i: 100 + MISSIONS.indexOf(m), ok: false, line: `${tag}: FALHOU — ${errs.join("; ")}` };
    const probs = [];
    const res = search(lv, { dash: false, trackCoin: false, wantPath: true, nonstop: m.goal === "nonstop" });
    if (res.any === null || res.any > MAX_ANY) probs.push(`melhor tempo ${res.any === null ? "—" : res.any.toFixed(1)} s (máx ${MAX_ANY}) com a restrição`);
    let note = "";
    if (res.path && lv.chasers.length) { const rp = replay(lv, res.path); if (!rp.ok) probs.push("replay falhou (" + rp.why + ")"); else note = ` · replay ${rp.t.toFixed(1)} s`; }
    return { i: 100 + MISSIONS.indexOf(m), ok: !probs.length, line: `${tag}: ${probs.length ? "FALHOU — " + probs.join("; ") + " | " : "ok — "}melhor ${res.any === null ? "—" : res.any.toFixed(1)} s${note}` };
  }

  function analyze(i) {
    if (i >= 100) return analyzeMission(MISSIONS[i - 100]);
    const lv = LEVELS[i];
    let chaseNote = "";
    const tag = `Fase ${i + 1} (${lv.name})`;
    const errs = sanity(lv);
    if (errs.length) return { i, ok: false, line: `${tag}: FALHOU — ${errs.join("; ")}` };
    const nd = search(lv, { dash: false, trackCoin: true });
    const d = i >= 15 ? nd : search(lv, { dash: true, trackCoin: true }); // fases 16-20: alvos calibrados sem impulso
    const probs = [];
    if (lv.chasers.length) { // perseguidores não entram na busca: confere a melhor rota no replay com a física real
      const pr = search(lv, { dash: false, trackCoin: false, wantPath: true });
      const rp = pr.path ? replay(lv, pr.path) : { ok: false, why: "sem caminho" };
      if (!rp.ok) probs.push("replay com perseguidor falhou (" + rp.why + ")");
      else chaseNote = ` · replay c/ perseguidor ${rp.t.toFixed(1)} s`;
    }
    const noDashLevel = i <= 10 || i >= 15; // fases 1-11 e 16-20: possíveis sem impulso
    const needDash = i >= 12 && i <= 14; // fases 13-15 exigem impulso
    const f = (v) => (v === null ? "—" : v.toFixed(1));
    if (noDashLevel) {
      if (nd.any === null || nd.any > MAX_ANY) probs.push(`sem impulso: ${f(nd.any)} s (máx ${MAX_ANY})`);
      if (nd.coin === null || nd.coin > MAX_COIN) probs.push(`moeda sem impulso: ${f(nd.coin)} s (máx ${MAX_COIN})`);
    } else {
      if (d.any === null || d.any > MAX_ANY) probs.push(`com impulso: ${f(d.any)} s (máx ${MAX_ANY})`);
      if (d.coin === null || d.coin > MAX_COIN) probs.push(`moeda com impulso: ${f(d.coin)} s (máx ${MAX_COIN})`);
    }
    if (needDash && nd.any !== null) probs.push("impulso dispensável");
    if (lv.switches.length && search(lv, { dash: true, trackCoin: false, ablate: "switch" }).any !== null) probs.push("interruptor dispensável");
    if (lv.portals.length && search(lv, { dash: true, trackCoin: false, ablate: "portal" }).any !== null) probs.push("portal dispensável");
    const bestAny = d.any === null ? nd.any : d.any;
    if (bestAny !== null && lv.target < bestAny + 0.5) probs.push(`alvo ${lv.target} s apertado (melhor ${bestAny} s)`);
    if (lv.target >= E.TIME_LIMIT) probs.push("alvo >= 10 s");
    const info = `sem impulso ${f(nd.any)} s (moeda ${f(nd.coin)}) · com impulso ${f(d.any)} s (moeda ${f(d.coin)}) · alvo ${lv.target} s${chaseNote}`;
    return { i, ok: !probs.length, line: `${tag}: ${probs.length ? "FALHOU — " + probs.join("; ") + " | " : "ok — "}${info}` };
  }

  root.VerifyCore = { analyze, search, sanity, count: LEVELS.length, missionCount: MISSIONS.length };
  if (IN_NODE) module.exports = root.VerifyCore;
})(typeof window !== "undefined" ? window : globalThis);
