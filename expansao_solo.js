/* =====================================================================
 * expansao_solo.js — EXPANSÃO SOLO (modo extra, só para uma pessoa; funciona sem servidor).
 *
 * Meta da expansão: 50 fases Solo, em 5 capítulos de 10. Cada fase tem 3 variantes ESCRITAS à mão (Fácil, Normal, Difícil).
 * Esta versão traz o Capítulo 1 completo (10 fases). Capítulos 2-5: pendentes (ver EXPANSAO.md).
 *
 * Formato de uma fase:  { id (estável, nunca renomear), name, goal (objetivo), solution (solução esperada, para manutenção),
 *                         teaches (o que ensina), status ("verificada" só depois do verificador), build(d) -> sala }
 * `build(d)` recebe "easy" | "normal" | "hard" e devolve uma sala no mesmo formato de levels.js (em unidades do mundo 800x500).
 * Para escrever os mapas em CÉLULAS de 20 unidades (grade 40x25) use os auxiliares abaixo.
 *
 *  FÁCIL  : passagens mais largas, menos perigos e/ou janelas de laser/drone mais folgadas.
 *  NORMAL : referência. Possível em 25 s (tempo recomendado); o verificador exige folga.
 *  DIFÍCIL: mais uma etapa/perigo e janelas mais curtas — nunca precisão de milissegundos; velocidade e colisão do personagem não mudam.
 * O tempo por sala continua sendo a escolha do jogador (mesmo painel da campanha); nada aqui o altera.
 * ===================================================================== */
(function (root) {
  const U = 20;
  const w = (x, y, a, b) => ({ x: x * U, y: y * U, w: a * U, h: b * U });                 // retângulo em células
  const P = (x, y) => ({ x: Math.round(x * U), y: Math.round(y * U) });                    // ponto em células (use .5 para o centro)
  const sw = (x, y, gate) => Object.assign(P(x, y), { gate });
  const vl = (cx, y, h, on, off, offset) => ({ x: Math.round(cx * U - 6), y: y * U, w: 12, h: h * U, on, off, warn: 0.5, offset });   // laser vertical centrado na coluna cx
  const hl = (x, cy, len, on, off, offset) => ({ x: x * U, y: Math.round(cy * U - 6), w: len * U, h: 12, on, off, warn: 0.5, offset });  // laser horizontal
  const saw = (x1, y1, x2, y2, speed, phase, r) => ({ x1: Math.round(x1 * U), y1: Math.round(y1 * U), x2: Math.round(x2 * U), y2: Math.round(y2 * U), speed, r: r || 16, phase: phase || 0 });
  const drone = (route, speed, phase) => ({ route: route.map((p) => [Math.round(p[0] * U), Math.round(p[1] * U)]), speed, r: 12, phase: phase || 0 });
  const pick = (d, e, n, h) => (d === "easy" ? e : d === "hard" ? h : n);
  const lvl = (name, hint, o) => Object.assign({ name, hint, target: 25 }, o);          // target = tempo recomendado (25 s); a medalha de tempo da campanha só vale em 10 s

  const MAPS = [
    /* 1 — Chave trancada: um interruptor longe abre a única passagem para a chave */
    { id: "solo-c1-m01", name: "Chave trancada", goal: "Abrir a passagem e chegar à porta", teaches: "interruptor → passagem, percurso em zigue-zague",
      solution: "Siga o corredor de cima até o interruptor (canto direito), desça pela abertura, volte pelo corredor do meio até a passagem (esquerda), pegue a chave embaixo e vá à porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        return lvl("Chave trancada", "O interruptor fica longe da passagem", {
          start: P(2.5, 3.5), switches: [sw(e ? 24.5 : 36.5, 3.5, 0)],
          key: P(30.5, 19.5), door: P(37.5, 22.5), coin: P(2.5, 22.5),
          walls: [w(0, 7, e ? 25 : 30, 1), w(e ? 12 : 10, 14, e ? 28 : 30, 1)],
          gates: [w(0, 14, e ? 12 : 10, 1)],
          spikes: h ? [w(14, 8, 2, 3), w(25, 11, 2, 3)] : [],
          lasers: h ? [vl(18.5, 15, 10, 1.0, 1.8, 0.6)] : [],
        });
      } },
    /* 2 — Duas portas, uma ordem */
    { id: "solo-c1-m02", name: "Duas portas, uma ordem", goal: "Abrir as duas passagens na ordem certa", teaches: "sequência de interruptores e passagens",
      solution: "Interruptor A (cima, sala 1) → passagem A → contornar o muro da sala 2 por cima → interruptor B (embaixo, direita da sala 2) → passagem B → chave (canto de cima, sala 3) → porta (embaixo, sala 3).",
      build(d) {
        const e = d === "easy", h = d === "hard";
        return lvl("Duas portas, uma ordem", "A segunda passagem só abre depois da primeira", {
          start: P(2.5, 12.5), switches: [sw(9.5, 3.5, 0), sw(23.5, 21.5, 1)],
          key: P(33.5, 4.5), door: P(37.5, 20.5), coin: P(16.5, 20.5),
          walls: [w(13, 0, 1, 8), w(13, 17, 1, 8), w(26, 0, 1, 8), w(26, 17, 1, 8), w(19, e ? 8 : 6, 1, e ? 8 : 12)],
          gates: [w(13, 8, 1, 9), w(26, 8, 1, 9)],
          spikes: h ? [w(30, 9, 2, 7), w(7, 15, 3, 2)] : [],
          lasers: h ? [vl(34.5, 8, 8, 1.0, 1.8, 0.4)] : [],
        });
      } },
    /* 3 — Atalho pelo portal */
    { id: "solo-c1-m03", name: "Atalho pelo portal", goal: "Atravessar o muro de espinhos usando o portal", teaches: "portais com destino seguro",
      solution: "Interruptor no corredor de cima → voltar à passagem à esquerda → corredor de baixo até o portal azul → sair no outro lado do muro → chave (cima) → porta (baixo).",
      build(d) {
        const e = d === "easy", h = d === "hard";
        return lvl("Atalho pelo portal", "Os espinhos fecham o caminho: ache a outra saída", {
          start: P(2.5, 3.5), switches: [sw(15.5, 4.5, 0)],
          key: P(36.5, 3.5), door: P(36.5, 21.5), coin: P(3.5, 20.5),
          walls: [w(e ? 6 : 6, 10, 12, 1), w(22, e ? 15 : 14, e ? 8 : 12, 1)],
          gates: [w(0, 10, 6, 1)],
          spikes: [w(18, 0, 4, 25)],
          portals: [{ a: P(14.5, 21.5), b: P(26.5, 21.5) }],
          movers: h ? [saw(30, 8, 30, 13, 90, 0), saw(33, 16.5, 38, 16.5, 100, 0.5)] : [],
        });
      } },
    /* 4 — Janela do laser */
    { id: "solo-c1-m04", name: "Janela do laser", goal: "Cruzar as três barreiras de laser no ritmo certo", teaches: "esperar a janela segura do laser (aviso piscando)",
      solution: "Desça até a abertura de baixo e cruze o 1º laser quando apagar; pegue a chave embaixo; suba pela abertura de cima (2º laser) e cruze o 3º laser antes da porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const on = pick(d, 0.8, 1.0, 1.2), off = pick(d, 2.4, 1.8, 1.4);
        return lvl("Janela do laser", "O laser pisca em aviso antes de ligar", {
          start: P(2.5, 3.5), key: P(20.5, 20.5), door: P(37.5, 12.5), coin: P(19.5, 4.5),
          walls: [w(13, 0, 1, 18), w(26, 7, 1, 18)],
          lasers: [vl(13.5, 18, 7, on, off, 0), vl(26.5, 0, 7, on, off, 0.9), vl(33, 0, 25, on, off, 1.7)],
          spikes: h ? [w(17, 8, 2, 8), w(21, 12, 2, 8)] : [],
        });
      } },
    /* 5 — Ronda do drone */
    { id: "solo-c1-m05", name: "Ronda do drone", goal: "Entrar na sala vigiada, pegar a chave e sair pela porta", teaches: "esperar o drone se afastar; rota previsível",
      solution: "Passe pela abertura do muro, atravesse a rota do drone quando ele estiver do outro lado, pegue a chave no centro, cruze a rota à direita e entre na porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const sp = pick(d, 70, 100, 125);
        const loop = e ? [[17, 4], [33, 4], [33, 20], [17, 20]] : [[17, 4], [33, 4], [33, 20], [17, 20]];
        return lvl("Ronda do drone", "O drone repete sempre o mesmo caminho", {
          start: P(2.5, 12.5), key: P(25.5, 12.5), door: P(37.5, 12.5), coin: P(25.5, 23.2),
          walls: [w(11, 0, 1, e ? 8 : 10), w(11, e ? 17 : 15, 1, e ? 8 : 10), w(0, 8, 6, 1), w(5, 16, 6, 1)],
          drones: h ? [drone(loop, sp, 0), drone([[21, 8], [29, 8], [29, 17], [21, 17]], sp, 0.5)] : [drone(loop, sp, 0)],
        });
      } },
    /* 6 — Trilho de serras */
    { id: "solo-c1-m06", name: "Trilho de serras", goal: "Atravessar três corredores com serras e abrir a passagem final", teaches: "serras em trilho + interruptor",
      solution: "Corredor de cima: passe pela serra e pegue o interruptor (direita); desça; cruze as duas serras do corredor do meio indo para a esquerda; passagem aberta → corredor de baixo: chave e porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const sp = pick(d, 70, 95, 120);
        return lvl("Trilho de serras", "As serras repetem o vai-e-vem sem parar", {
          start: P(2.5, 3.5), switches: [sw(36.5, 3.5, 0)], key: P(20.5, 20.5), door: P(37.5, 22.5), coin: P(2.5, 12.5),
          walls: [w(0, 8, 36, 1), w(4, 16, 36, 1)],
          gates: [w(0, 16, 4, 1)],
          movers: [saw(18, 2.5, 18, 5.5, sp, 0), saw(12, 10.5, 12, 13.5, sp, 0.3), saw(26, 10.5, 26, 13.5, sp, 0.7)].concat(h ? [saw(32, 18.5, 32, 22.5, sp, 0.2)] : []).slice(0, e ? 2 : 4),
        });
      } },
    /* 7 — Impulso na janela */
    { id: "solo-c1-m07", name: "Impulso na janela", goal: "Cruzar o par de lasers usando o impulso", teaches: "impulso (Espaço/⚡) para vencer uma janela curta",
      solution: "Pegue a chave, vá até a frente do par de lasers e dê o impulso na hora em que o primeiro apagar: o impulso cruza os dois de uma vez.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const on = pick(d, 1.0, 1.4, 1.7), off = pick(d, 1.8, 1.3, 1.1);
        return lvl("Impulso na janela", "Espaço ou ⚡ dá um impulso — uma vez por tentativa", {
          start: P(2.5, 12.5), key: P(8.5, 4.5), door: P(37.5, 12.5), coin: P(30.5, 22.5),
          walls: [w(14, 0, 1, 9), w(14, 16, 1, 9), w(26, 0, 1, 9), w(26, 16, 1, 9)],
          lasers: [vl(19.5, 0, 25, on, off, 0), vl(23, 0, 25, on, off, pick(d, 1.1, 1.0, 0.9))],
          spikes: h ? [w(30, 6, 3, 4), w(30, 15, 3, 4)] : [],
        });
      } },
    /* 8 — Portal e laser */
    { id: "solo-c1-m08", name: "Portal e laser", goal: "Chegar ao outro lado pelo portal e cruzar o laser final", teaches: "portal com saída segura + laser na saída",
      solution: "Interruptor (cima) → passagem → portal da esquerda → sair do lado direito do muro → cruzar o laser quando apagar → chave → porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const on = pick(d, 0.9, 1.0, 1.2), off = pick(d, 2.2, 1.8, 1.5);
        return lvl("Portal e laser", "Depois do portal, o laser espera por você", {
          start: P(2.5, 12.5), switches: [sw(8.5, 3.5, 0)], key: P(35.5, 3.5), door: P(37.5, 21.5), coin: P(10.5, 21.5),
          walls: [w(12, 0, 1, 8), w(12, 17, 1, 8), w(22, 0, 1, 25)],
          gates: [w(12, 8, 1, 9)],
          portals: [{ a: P(17.5, 12.5), b: P(27.5, 12.5) }],
          lasers: [vl(31, 0, 25, on, off, 0.4)].concat(h ? [vl(34.5, 14, 11, on, off, 1.1)] : []),
          spikes: h ? [w(15, 4, 3, 2), w(15, 19, 3, 2)] : [],
        });
      } },
    /* 9 — Ordem das portas, com drone */
    { id: "solo-c1-m09", name: "Ordem sob vigilância", goal: "Abrir as duas passagens enquanto um drone patrulha o corredor", teaches: "sequência + patrulha",
      solution: "Interruptor A (esquerda) → passagem A → atravessar a ronda do drone → interruptor B → passagem B → chave → porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const sp = pick(d, 70, 100, 125);
        return lvl("Ordem sob vigilância", "Um drone vigia o corredor do meio", {
          start: P(2.5, 3.5), switches: [sw(6.5, 21.5, 0), sw(35.5, 21.5, 1)], key: P(36.5, 3.5), door: P(2.5, 12.5), coin: P(20.5, 22.5),
          walls: [w(0, 8, 28, 1), w(12, 16, 28, 1)],
          gates: [w(28, 8, 4, 1), w(8, 16, 4, 1)],
          drones: [drone([[16, 12.5], [34, 12.5]], sp, 0)].concat(h ? [drone([[16, 4], [30, 4]], sp, 0.5)] : []),
        });
      } },
    /* 10 — Percurso completo */
    { id: "solo-c1-m10", name: "Percurso completo", goal: "Combinar interruptor, portal, laser, serra e impulso", teaches: "revisão do capítulo",
      solution: "Interruptor (esquerda) → passagem → portal → laser (com o impulso se a janela for curta) → corredor das serras → chave → porta.",
      build(d) {
        const e = d === "easy", h = d === "hard";
        const on = pick(d, 0.9, 1.1, 1.3), off = pick(d, 2.2, 1.7, 1.4);
        const sp = pick(d, 70, 95, 120);
        return lvl("Percurso completo", "Tudo o que você aprendeu, numa fuga só", {
          start: P(2.5, 12.5), switches: [sw(7.5, 3.5, 0)], key: P(33.5, 3.5), door: P(37.5, 21.5), coin: P(3.5, 21.5),
          walls: [w(11, 0, 1, 8), w(11, 17, 1, 8), w(21, 0, 1, 25), w(29, 8, 11, 1)],
          gates: [w(11, 8, 1, 9)],
          portals: [{ a: P(16.5, 12.5), b: P(25.5, 12.5) }],
          lasers: [vl(30, 9, 16, on, off, 0.5)].concat(h ? [hl(22, 6.5, 7, on, off, 1.2)] : []),
          movers: [saw(24, 3, 24, 6.5, sp, 0.2)].concat(h ? [saw(34, 16.5, 38, 16.5, sp, 0.6)] : []).slice(0, e ? 0 : 3),
        });
      } },
  ];

  const CHAPTERS = [{ id: "solo-c1", n: 1, title: "Capítulo 1 — Planejamento de percurso", intro: "Interruptores, portais e o ritmo dos perigos. Tudo pode ser feito por uma pessoa, em 25 s.", maps: MAPS }];
  const DIFFS = ["easy", "normal", "hard"];
  root.EXP_SOLO = { chapters: CHAPTERS, diffs: DIFFS, goal: 50, recommended: 25, build: (map, d) => map.build(d) };
  if (typeof module !== "undefined") module.exports = root.EXP_SOLO;
})(typeof window !== "undefined" ? window : globalThis);
