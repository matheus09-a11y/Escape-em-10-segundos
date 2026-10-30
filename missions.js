/* =====================================================================
 * missions.js — MODO MISSÕES: 12 desafios feitos à mão, cada um sobre uma sala da campanha.
 *
 * Cada missão é uma CÓPIA INDEPENDENTE da sala-base (clonada de LEVELS_RAW, a cópia
 * pristina de levels.js): editar uma missão nunca altera a campanha, e vice-versa.
 *
 * Campos de uma missão:
 *   id      identificador estável (usado no save; nunca renomeie)
 *   name    nome mostrado nos cartões
 *   desc    descrição curta
 *   base    número da sala da campanha usada de base (1..30). A missão exige tê-la concluído.
 *   goal    objetivo especial (um só): "noDash" | "collect" | "stealth" | "nonstop"
 *   patch   (opcional) campos que SUBSTITUEM os da cópia: posições de chave/porta/inimigos,
 *           `fragments: [{x,y} x3]` (objetivo collect), etc.
 *
 * PARA CRIAR UMA MISSÃO: acrescente um objeto em MISSIONS e rode tools/verify.html — ele confere
 * que é possível em 10 s (com a restrição do objetivo) e que as posições estão livres.
 * ===================================================================== */
(function (root) {
  /** Objetivos: rótulo, ícone, regra explicada antes de começar e instrução curta durante a tentativa. */
  const GOALS = {
    noDash: { label: "Sem impulso", icon: "🚫", rule: "O impulso fica DESATIVADO nesta missão (o botão ⚡ e a tecla Espaço não funcionam).", short: "Sem impulso: conclua só andando." },
    collect: { label: "Coleta completa", icon: "◆", rule: "Colete os 3 fragmentos ◆ E a chave antes de sair. A porta só libera a vitória com tudo coletado.", short: "Pegue os 3 fragmentos ◆ e a chave." },
    stealth: { label: "Furtividade", icon: "👁", rule: "Não seja detectado. Sentinela: perde quando o alerta enche (dá para recuar antes). Perseguidor: perde assim que ele ACORDA, ou seja, ao entrar no raio dele com visão livre.", short: "Furtivo: não acorde o perseguidor nem encha o alerta." },
    nonstop: { label: "Sem parar", icon: "⏱", rule: "Depois do primeiro movimento, não fique parado por mais de 1 segundo seguido. Segurar o controle contra uma parede conta como parado; teletransporte e pausas não causam derrota.", short: "Sem parar: nunca mais de 1 s parado." },
  };

  const MISSIONS = [
    // ---- SEM IMPULSO
    { id: "sd-laser", name: "Laser a pé", desc: "A sala do laser, sem o impulso.", base: 8, goal: "noDash" },
    { id: "sd-desvio", name: "Desvio a pé", desc: "O desvio da moeda sem o atalho do impulso.", base: 12, goal: "noDash" },
    { id: "sd-fuga", name: "A fuga a pé", desc: "A grande fuga no gelo, sem impulso.", base: 20, goal: "noDash" },
    // ---- COLETA COMPLETA
    { id: "cc-espinhos", name: "Cristais nos espinhos", desc: "Três fragmentos entre os espinhos, depois a chave.", base: 3, goal: "collect",
      patch: { fragments: [{ x: 320, y: 420 }, { x: 520, y: 430 }, { x: 520, y: 100 }] } },
    { id: "cc-laser", name: "Cristais e lasers", desc: "Fragmentos de cada lado dos lasers.", base: 9, goal: "collect",
      patch: { fragments: [{ x: 150, y: 150 }, { x: 480, y: 130 }, { x: 540, y: 300 }] } },
    { id: "cc-drone", name: "Cristais na patrulha", desc: "Fragmentos nos dois lados da rota do drone.", base: 21, goal: "collect",
      patch: { fragments: [{ x: 150, y: 400 }, { x: 330, y: 300 }, { x: 560, y: 120 }] } },
    // ---- FURTIVIDADE
    { id: "ft-circuito", name: "Passos de lã", desc: "Pegue a chave sem acordar o perseguidor.", base: 28, goal: "stealth" },
    { id: "ft-portal", name: "Portal silencioso", desc: "Use o portal sem despertar o perseguidor.", base: 29, goal: "stealth",
      patch: { chasers: [{ x: 250, y: 100, speed: 150, detect: 150 }] } },
    { id: "ft-total", name: "Invisível", desc: "Sentinela e perseguidor: não deixe nenhum agir.", base: 30, goal: "stealth" },
    // ---- SEM PARAR
    { id: "sp-labirinto", name: "Labirinto sem pausa", desc: "O labirinto curto sem nunca parar.", base: 2, goal: "nonstop" },
    { id: "sp-portais", name: "Portais sem pausa", desc: "Os portais em movimento contínuo.", base: 7, goal: "nonstop" },
    { id: "sp-desvio", name: "Desvio sem pausa", desc: "O desvio da moeda em movimento contínuo.", base: 12, goal: "nonstop" },
  ];

  /** Cria a cópia independente da sala-base com as alterações da missão. */
  function buildLevel(m) {
    const lv = JSON.parse(JSON.stringify(root.LEVELS_RAW[m.base - 1]));
    Object.assign(lv, JSON.parse(JSON.stringify(m.patch || {})));
    delete lv.intro; // instruções de mecânica pertencem à campanha
    lv.name = m.name;
    lv.hint = GOALS[m.goal].short;
    lv.mission = { id: m.id, goal: m.goal };
    if (m.goal === "noDash") lv.noDash = true;
    if (m.goal === "stealth") lv.stealth = true;
    if (m.goal === "nonstop") lv.nonstop = true;
    return lv;
  }
  const built = MISSIONS.map((m) => Object.assign({}, m, { level: buildLevel(m) }));

  root.MISSION_GOALS = GOALS;
  root.MISSIONS = built;
  if (typeof module !== "undefined") module.exports = built;
})(typeof window !== "undefined" ? window : globalThis);
