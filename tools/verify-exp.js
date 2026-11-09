/* Verificador da EXPANSÃO SOLO. Mesmas regras de física do jogo (Engine.advance), com tempo recomendado de 25 s.
 * Uso (sem Node):  osascript -l JavaScript tools/verify-exp-jxa.js <mapa 1..N> <easy|normal|hard>
 * Confere: estrutura (sanity do verificador da campanha), solução sem impulso dentro da folga, moeda alcançável,
 * interruptores e portais realmente necessários, e (fases marcadas) que o impulso ajuda de verdade.
 * Folga: melhor tempo <= 15 s (Fácil), 17 s (Normal), 21 s (Difícil) — sobra para erros humanos dentro dos 25 s. */
(function (root) {
  const E = root.Engine, VC = root.VerifyCore, EX = root.EXP_SOLO;
  const CAP = { easy: 15, normal: 17, hard: 21 }, LIMIT = EX.recommended, COIN_CAP = 23, ABL = 14; // ABL: tempo máximo da busca de "dispensável" (sem o interruptor/portal)
  const DASH_USEFUL = { "solo-c1-m07": 0.8 };           // fases em que o impulso precisa economizar pelo menos tanto tempo
  const f = (v) => (v === null ? "—" : v.toFixed(1));
  function maps() { return EX.chapters.reduce((a, c) => a.concat(c.maps), []); }
  function analyze(mi, d, quick) {
    const m = maps()[mi], lv = E.normalize(m.build(d)), tag = `${m.id} ${d} (${m.name})`;
    const errs = VC.sanity(lv);
    if (errs.length) return { ok: false, line: `${tag}: FALHOU — ${errs.join("; ")}` };
    const probs = [];
    const nd = VC.search(lv, { dash: false, trackCoin: true, limit: LIMIT });
    if (nd.any === null || nd.any > CAP[d]) probs.push(`sem impulso: ${f(nd.any)} s (máx ${CAP[d]})`);
    if (nd.coin === null || nd.coin > COIN_CAP) probs.push(`moeda: ${f(nd.coin)} s (máx ${COIN_CAP})`);
    let dd = null;
    if (!quick) {
      const need = DASH_USEFUL[m.id];
      if (need) dd = VC.search(lv, { dash: true, trackCoin: false, limit: LIMIT });   // a busca com impulso é cara: só nas fases em que o impulso é o tema
      if (need && (nd.any !== null && dd.any !== null && dd.any > nd.any - need)) probs.push(`impulso pouco útil (${f(dd.any)} vs ${f(nd.any)} s)`);
      if (lv.switches.length && VC.search(lv, { dash: false, trackCoin: false, ablate: "switch", limit: ABL }).any !== null) probs.push("interruptor dispensável");
      if (lv.portals.length && VC.search(lv, { dash: false, trackCoin: false, ablate: "portal", limit: ABL }).any !== null) probs.push("portal dispensável");
    }
    return { ok: !probs.length, line: `${tag}: ${probs.length ? "FALHOU — " + probs.join("; ") + " | " : "ok — "}melhor ${f(nd.any)} s (moeda ${f(nd.coin)})${dd ? " · com impulso " + f(dd.any) + " s" : ""}`, best: nd.any };
  }
  root.VerifyExp = { analyze, count: () => maps().length };
  if (typeof module !== "undefined") module.exports = root.VerifyExp;
})(typeof window !== "undefined" ? window : globalThis);
