/* Worker auxiliar: devolve uma sequência de ações vencedora (por passo de 0,1 s) para a fase pedida (i < 100)
 * ou missão (i >= 100). Usada para REPRODUZIR a solução no jogo real e conferir que verificador e jogo concordam.
 * Mensagem: {i, dash: bool}. */
importScripts("../levels.js?" + Date.now(), "../missions.js?" + Date.now(), "../engine.js?" + Date.now(), "verify-core.js?" + Date.now());
onmessage = (e) => {
  const m = e.data.i >= 100 ? MISSIONS[e.data.i - 100] : null;
  const lv = m ? m.level : LEVELS[e.data.i];
  postMessage({ i: e.data.i, res: VerifyCore.search(lv, { dash: !!e.data.dash, trackCoin: false, wantPath: true, nonstop: !!m && m.goal === "nonstop" }) });
};
