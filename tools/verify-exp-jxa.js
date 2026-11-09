// Runner SEM Node (JavaScriptCore via osascript): osascript -l JavaScript tools/verify-exp-jxa.js <mapa 1..N> <easy|normal|hard> [quick]
ObjC.import("Foundation");
function run(argv) {
  const dir = $.NSProcessInfo.processInfo.environment.objectForKey("PWD").js;
  const read = (f) => $.NSString.stringWithContentsOfFileEncodingError(dir + "/" + f, 4, null).js;
  const g = (0, eval)("this");
  ["levels.js", "missions.js", "engine.js", "tools/verify-core.js", "expansao_solo.js", "tools/verify-exp.js"].forEach((f) => (0, eval)(read(f)));
  const r = g.VerifyExp.analyze(parseInt(argv[0], 10) - 1, argv[1], argv[2] === "quick");
  return (r.ok ? "OK   " : "FAIL ") + r.line;
}
