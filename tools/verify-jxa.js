// Runner do verificador SEM Node, usando o JavaScript do macOS (JavaScriptCore via osascript):
//   osascript -l JavaScript tools/verify-jxa.js <indice-da-fase 1..20>
// (rode uma fase por processo, em paralelo, para ser mais rápido). Equivale a `node tools/verify.js`.
ObjC.import("Foundation");
function run(argv) {
  const dir = $.NSProcessInfo.processInfo.environment.objectForKey("PWD").js;
  const read = (f) => $.NSString.stringWithContentsOfFileEncodingError(dir + "/" + f, 4, null).js;
  const g = (0, eval)("this");
  [ "levels.js", "engine.js", "tools/verify-core.js" ].forEach((f) => (0, eval)(read(f)));
  const i = parseInt(argv[0], 10) - 1;
  const r = g.VerifyCore.analyze(i);
  return (r.ok ? "OK   " : "FAIL ") + r.line;
}
