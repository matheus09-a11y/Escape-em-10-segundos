/* Verificador de fases no Node:  node tools/verify.js  (sai com 1 se alguma falhar).
 * No navegador (em paralelo): sirva a pasta e abra tools/verify.html. */
const core = require("./verify-core.js");
let bad = 0;
for (let i = 0; i < core.count; i++) {
  const r = core.analyze(i);
  console.log(r.line);
  if (!r.ok) bad++;
}
process.exit(bad ? 1 : 0);
