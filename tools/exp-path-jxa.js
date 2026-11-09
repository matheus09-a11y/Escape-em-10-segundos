// Gera uma solução (ações por passo de 0,1 s, sem impulso) de uma fase da expansão, em JSON — usada para REPRODUZIR no jogo real.
//   osascript -l JavaScript tools/exp-path-jxa.js <mapa 1..N> <easy|normal|hard>
ObjC.import("Foundation");
function run(argv) {
  const dir = $.NSProcessInfo.processInfo.environment.objectForKey("PWD").js;
  const read = (f) => $.NSString.stringWithContentsOfFileEncodingError(dir + "/" + f, 4, null).js;
  const g = (0, eval)("this");
  ["levels.js", "missions.js", "engine.js", "tools/verify-core.js", "expansao_solo.js"].forEach((f) => (0, eval)(read(f)));
  const mi = parseInt(argv[0], 10) - 1, d = argv[1];
  const lv = g.Engine.normalize(g.EXP_SOLO.chapters[0].maps[mi].build(d));
  const r = g.VerifyCore.search(lv, { dash: false, trackCoin: false, wantPath: true, limit: g.EXP_SOLO.recommended });
  return JSON.stringify({ mi, d, any: r.any, path: (r.path || []).map((a) => [Math.round(a[0] * 100) / 100, Math.round(a[1] * 100) / 100, a[2]]) });
}
