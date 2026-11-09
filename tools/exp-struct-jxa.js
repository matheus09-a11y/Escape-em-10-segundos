// Verificação ESTRUTURAL da Expansão Solo (não prova que as fases são solucionáveis — isso é o verificador de busca):
// ids únicos e estáveis, 3 variantes por fase, campos obrigatórios, referências interruptor→passagem, portais em pares, objetos dentro da sala,
// variantes realmente diferentes (não são cópias), tempo recomendado = 25 s, nenhuma fase repetida da campanha (mesmo nome).
//   osascript -l JavaScript tools/exp-struct-jxa.js
ObjC.import("Foundation");
function run() {
  const dir = $.NSProcessInfo.processInfo.environment.objectForKey("PWD").js;
  const read = (f) => $.NSString.stringWithContentsOfFileEncodingError(dir + "/" + f, 4, null).js;
  const g = (0, eval)("this");
  ["levels.js", "missions.js", "engine.js", "expansao_solo.js"].forEach((f) => (0, eval)(read(f)));
  const E = g.Engine, X = g.EXP_SOLO, errs = [], ids = new Set(), names = new Set(g.LEVELS.map((l) => l.name)), out = [];
  const inRoom = (p, m) => p && p.x >= m && p.x <= 800 - m && p.y >= m && p.y <= 500 - m;
  let n = 0;
  for (const ch of X.chapters) {
    if (ch.maps.length !== 10) errs.push(ch.id + ": capítulo deve ter 10 fases (tem " + ch.maps.length + ")");
    for (const m of ch.maps) {
      n++;
      if (ids.has(m.id)) errs.push("id repetido " + m.id); ids.add(m.id);
      if (!/^solo-c\d-m\d\d$/.test(m.id)) errs.push("id fora do padrão " + m.id);
      for (const k of ["name", "goal", "solution", "teaches"]) if (!m[k] || typeof m[k] !== "string") errs.push(m.id + ": falta " + k);
      if (names.has(m.name)) errs.push(m.id + ": nome igual ao de uma fase da campanha"); names.add(m.name);
      const sigs = new Set();
      for (const d of X.diffs) {
        const lv = E.normalize(m.build(d)), t = m.id + " " + d;
        sigs.add(JSON.stringify(m.build(d)));
        for (const [k, p] of [["start", lv.start], ["key", lv.key], ["door", lv.door], ["coin", lv.coin]]) if (!inRoom(p, 12)) errs.push(t + ": " + k + " fora da sala");
        lv.switches.forEach((s, i) => { if (!lv.gates[s.gate]) errs.push(t + ": interruptor " + i + " aponta para passagem inexistente"); if (!inRoom(s, 12)) errs.push(t + ": interruptor fora da sala"); });
        lv.gates.forEach((gt, i) => { if (!lv.switches.some((s) => s.gate === i)) errs.push(t + ": passagem " + i + " sem interruptor (ficaria trancada para sempre)"); });
        lv.portals.forEach((p, i) => { if (!inRoom(p.a, 12) || !inRoom(p.b, 12)) errs.push(t + ": portal " + i + " fora da sala"); });
        for (const r of lv.walls.concat(lv.gates, lv.spikes)) if (r.x < 0 || r.y < 0 || r.x + r.w > 800 || r.y + r.h > 500 || r.w <= 0 || r.h <= 0) errs.push(t + ": retângulo inválido");
        lv.lasers.forEach((l, i) => { if (!(l.on > 0 && l.off >= 1.0 && l.warn === 0.5)) errs.push(t + ": laser " + i + " com ciclo/aviso inválido"); });
        lv.movers.forEach((mv, i) => { if (!(mv.speed > 0 && mv.r >= 10)) errs.push(t + ": serra " + i + " inválida"); });
        if (lv.target !== X.recommended) errs.push(t + ": tempo recomendado deve ser " + X.recommended);
        if (lv.sentinels.length || lv.chasers.length || lv.ice.length || lv.belts.length) errs.push(t + ": usa mecanismo fora do escopo do capítulo");
      }
      if (sigs.size !== 3) errs.push(m.id + ": as 3 variantes não são diferentes entre si");
    }
  }
  return (errs.length ? "FALHAS (" + errs.length + "):\n" + errs.join("\n") : "ESTRUTURA OK — " + n + " fases x 3 variantes, ids únicos, referências válidas");
}
