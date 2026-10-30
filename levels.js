/* =====================================================================
 * levels.js — DADOS DAS FASES  (é aqui que você cria novas fases)
 * ---------------------------------------------------------------------
 * O mundo é sempre 800 x 500 unidades, independente do tamanho da tela.
 * Redimensionar a janela só muda a escala do desenho, nunca a lógica.
 *
 * PARA CRIAR UMA FASE NOVA: copie um objeto abaixo, cole no fim da lista
 * LEVELS e edite. Campos:
 *
 *   name    Nome mostrado no topo.
 *   hint    Dica curta mostrada antes do primeiro movimento.
 *   start   {x, y}  Centro do personagem ao começar.
 *   key     {x, y}  Centro da chave.
 *   door    {x, y}  Centro da porta (caixa de 40x40).
 *   walls   [{x, y, w, h}]  Retângulos sólidos (canto superior esquerdo).
 *   spikes  [{x, y, w, h}]  Retângulos de espinhos fixos (matam ao tocar).
 *   movers  [{x1,y1, x2,y2, speed, r, phase}]
 *           Serras que vão e voltam entre (x1,y1) e (x2,y2).
 *           speed = unidades/seg, r = raio, phase = 0..1 (defasagem do ciclo).
 *           As serras só começam a andar no primeiro movimento do jogador.
 *   gates   [{x, y, w, h}]  Passagens bloqueadas (como paredes) até que o
 *           interruptor correspondente seja pisado. O índice na lista é o id.
 *   switches [{x, y, gate}]  Interruptor que abre gates[gate]. Fica ativo até
 *           o fim da tentativa. (Cor do par = índice do gate.)
 *   portals [{a:{x,y}, b:{x,y}}]  Par de portais; entrar em um leva ao outro.
 *           Só reativam depois que o jogador sai da área de destino. Mantenha
 *           as pontas >= 40 de paredes, espinhos, lasers e trilhos de serras
 *           (o verificador confere).
 *   lasers  [{x, y, w, h, on, off, warn, offset}]  Feixe retangular que liga
 *           por `on` s e apaga por `off` s (os últimos `warn` s apagados são o
 *           aviso piscando). `offset` desloca o ciclo; no instante 0 o feixe
 *           precisa estar apagado perto do início. Use feixes finos (h ou w = 12).
 *   drones  [{route:[[x,y],...], speed, r, phase}]  Drone de patrulha: percorre os pontos em laço
 *           fechado (do último volta ao primeiro) a `speed` u/s. Não persegue nem atira; encostar =
 *           derrota. `r` = raio da colisão (padrão 12; o desenho é maior). Começa no 1º movimento.
 *           A rota deve ficar longe de paredes (>= r+6), do início (>= 80), da chave/porta (>= 40) e
 *           das saídas de portal (>= 60) — o verificador confere.
 *   sentinels [{x, y, a0, a1, fov, range, period, phase}]  Sentinela parada com cone de visão que vai e volta
 *           entre os ângulos a0..a1 (graus; 0 = direita, 90 = para baixo) em `period` s; a0..a1 de 360° = gira sem parar.
 *           Vê só o que está no cone (abertura `fov`, alcance `range`) SEM parede/passagem fechada no meio; vendo o jogador
 *           o alerta enche em 0,8 s (derrota); fora da visão cai devagar. Não atira. O verificador exige uma
 *           solução em que o jogador NUNCA é visto (com folga), então a cobertura é obrigatória e justa.
 *   chasers [{x, y, speed, r, detect}]  Perseguidor parado até o jogador entrar no raio `detect` com linha de visão livre;
 *           sinaliza 0,5 s e persegue (speed < 260) contornando paredes/passagens fechadas. Ignora portais e pisos.
 *           Mantenha-o longe do início (>= detect+40) e longe da SAÍDA (ponta `b`) dos portais (>= detect+60 ou em outra área).
 *   ice     [{x, y, w, h}]  Gelo: derrapagem moderada enquanto o CENTRO do personagem está nele.
 *           Deixe áreas normais para frear e nunca sobreponha gelo e esteira. Limite bem
 *           visível (o jogo desenha borda e hachura).
 *   belts   [{x, y, w, h, dx, dy, speed}]  Esteira: empurra na direção (dx,dy) (um eixo: ±1/0)
 *           a `speed` u/s (padrão 110; sempre < 260 para dar para andar contra o fluxo).
 *           Início e saídas de portais devem ficar fora de pisos especiais.
 *   coin    {x, y}  Moeda OPCIONAL (medalha extra). Só conta se você vencer a fase na
 *           mesma tentativa em que a pegou. Deixe-a em um desvio possível e longe de perigos.
 *   target  Tempo-alvo (s) da medalha de tempo (conclua em <= target). Use ~1,3x o melhor
 *           tempo que o verificador mostra (mais folga se houver lasers); nunca igual para todas.
 *   dashDir {dx, dy}  Direção do impulso antes do primeiro movimento (padrão: direita).
 *   intro   {title, text}  Opcional: instrução mostrada ao abrir a fase.
 *
 * DICA: depois de editar, rode `node tools/verify.js` — ele procura um
 * caminho que vença a fase e avisa se não houver (ou se for apertado demais).
 * ===================================================================== */
(function (root) {
  const LEVELS = [
    {
      name: "Primeiros passos",
      hint: "Pegue a chave e entre na porta",
      start: { x: 70, y: 250 },
      key: { x: 400, y: 90 },
      door: { x: 730, y: 400 },
      coin: { x: 600, y: 70 },
      target: 4.0,
      walls: [],
      spikes: [],
      movers: [],
    },
    {
      name: "Labirinto curto",
      hint: "Contorne as paredes",
      start: { x: 60, y: 60 },
      key: { x: 485, y: 100 },
      door: { x: 735, y: 80 },
      coin: { x: 490, y: 400 },
      target: 6.0,
      walls: [
        { x: 190, y: 0, w: 28, h: 300 },
        { x: 380, y: 200, w: 28, h: 300 },
        { x: 570, y: 0, w: 28, h: 300 },
      ],
      spikes: [],
      movers: [],
    },
    {
      name: "Espinhos",
      hint: "Não toque nos espinhos",
      start: { x: 60, y: 250 },
      key: { x: 430, y: 60 },
      door: { x: 740, y: 250 },
      coin: { x: 330, y: 330 },
      target: 3.5,
      walls: [],
      spikes: [
        { x: 200, y: 0, w: 60, h: 190 },
        { x: 200, y: 310, w: 60, h: 190 },
        { x: 390, y: 140, w: 80, h: 220 },
        { x: 590, y: 0, w: 60, h: 210 },
        { x: 590, y: 330, w: 60, h: 170 },
      ],
      movers: [],
    },
    {
      name: "Serras em movimento",
      hint: "Espere a hora certa de passar",
      start: { x: 60, y: 430 },
      key: { x: 385, y: 60 },
      door: { x: 740, y: 430 },
      coin: { x: 400, y: 330 },
      target: 4.5,
      walls: [],
      spikes: [],
      movers: [
        { x1: 235, y1: 30, x2: 235, y2: 470, speed: 190, r: 22, phase: 0 },
        { x1: 560, y1: 470, x2: 560, y2: 30, speed: 230, r: 22, phase: 0.2 },
      ],
    },
    {
      name: "Tudo junto",
      hint: "Paredes, espinhos e serras",
      start: { x: 50, y: 450 },
      key: { x: 520, y: 430 },
      door: { x: 745, y: 50 },
      coin: { x: 300, y: 90 },
      target: 6.0,
      walls: [
        { x: 170, y: 0, w: 26, h: 330 },
        { x: 380, y: 180, w: 26, h: 320 },
        { x: 600, y: 200, w: 26, h: 300 },
      ],
      spikes: [
        { x: 170, y: 430, w: 26, h: 70 },
        { x: 650, y: 120, w: 50, h: 90 },
      ],
      movers: [
        { x1: 480, y1: 40, x2: 480, y2: 330, speed: 170, r: 20, phase: 0 },
        { x1: 660, y1: 330, x2: 760, y2: 330, speed: 120, r: 18, phase: 0.5 },
      ],
    },

    /* ---------------- PARTE 2: interruptores, portais e lasers ---------------- */
    {
      name: "Interruptor",
      hint: "Pise no botão para abrir a passagem",
      intro: {
        title: "Novo: interruptor",
        text: "Pise no botão laranja para abrir a passagem laranja.\nEle fica ativado até o fim da tentativa.",
      },
      start: { x: 60, y: 250 },
      key: { x: 650, y: 90 },
      door: { x: 740, y: 420 },
      coin: { x: 620, y: 300 },
      target: 5.0,
      walls: [
        { x: 500, y: 0, w: 26, h: 210 },
        { x: 500, y: 290, w: 26, h: 210 },
      ],
      gates: [{ x: 500, y: 210, w: 26, h: 80 }],
      switches: [{ x: 250, y: 430, gate: 0 }],
    },
    {
      name: "Portais",
      hint: "Entre no portal para sair no outro",
      intro: {
        title: "Novo: portais",
        text: "Entre em um portal para sair no outro da mesma cor.\nSó reativam depois que você sair da área de chegada.",
      },
      start: { x: 60, y: 60 },
      key: { x: 690, y: 420 },
      door: { x: 740, y: 70 },
      coin: { x: 510, y: 300 },
      target: 6.0,
      walls: [
        { x: 130, y: 0, w: 26, h: 300 },
        { x: 380, y: 0, w: 28, h: 500 },
        { x: 580, y: 160, w: 26, h: 340 },
      ],
      portals: [{ a: { x: 270, y: 420 }, b: { x: 480, y: 100 } }],
    },
    {
      name: "Laser",
      hint: "Cruze quando o laser estiver apagado",
      intro: {
        title: "Novo: laser",
        text: "O laser pisca em aviso antes de ligar.\nCruze enquanto ele estiver apagado — o ritmo é sempre o mesmo.",
      },
      start: { x: 60, y: 250 },
      key: { x: 390, y: 420 },
      door: { x: 740, y: 80 },
      coin: { x: 450, y: 200 },
      target: 4.5,
      lasers: [
        { x: 240, y: 0, w: 12, h: 500, on: 1.0, off: 1.6, warn: 0.5, offset: 0 },
        { x: 540, y: 0, w: 12, h: 500, on: 1.0, off: 1.6, warn: 0.5, offset: 0.8 },
      ],
    },
    {
      name: "Botão e laser",
      hint: "Cruze o laser, abra a passagem e siga",
      start: { x: 60, y: 430 },
      key: { x: 480, y: 430 },
      door: { x: 740, y: 80 },
      coin: { x: 450, y: 160 },
      target: 6.5,
      walls: [
        { x: 300, y: 0, w: 26, h: 200 },
        { x: 300, y: 300, w: 26, h: 200 },
      ],
      gates: [{ x: 300, y: 200, w: 26, h: 100 }],
      switches: [{ x: 190, y: 70, gate: 0 }],
      lasers: [
        { x: 0, y: 290, w: 300, h: 12, on: 1.0, off: 1.6, warn: 0.5, offset: 0 },
        { x: 620, y: 0, w: 12, h: 500, on: 1.0, off: 1.6, warn: 0.5, offset: 1.0 },
      ],
    },
    {
      name: "Fuga final",
      hint: "Botão, laser, portal e serra",
      start: { x: 50, y: 250 },
      key: { x: 400, y: 440 },
      door: { x: 745, y: 60 },
      coin: { x: 150, y: 390 },
      target: 6.5,
      walls: [
        { x: 270, y: 0, w: 26, h: 380 },
        { x: 270, y: 460, w: 26, h: 40 },
        { x: 520, y: 0, w: 26, h: 500 },
      ],
      gates: [{ x: 270, y: 380, w: 26, h: 80 }],
      switches: [{ x: 140, y: 110, gate: 0 }],
      lasers: [{ x: 296, y: 280, w: 224, h: 12, on: 1.0, off: 1.6, warn: 0.5, offset: 0 }],
      portals: [{ a: { x: 420, y: 110 }, b: { x: 650, y: 410 } }],
      spikes: [{ x: 610, y: 150, w: 80, h: 70 }],
      movers: [{ x1: 570, y1: 300, x2: 780, y2: 300, speed: 140, r: 18, phase: 0 }],
    },

    /* ---------------- PARTE 3: impulso (Espaço / botão ⚡), uma vez por tentativa ---------------- */
    {
      name: "Impulso",
      hint: "Use o impulso (Espaço ou ⚡) nas retas longas",
      intro: {
        title: "Novo: impulso",
        text: "Espaço (ou o botão ⚡) dá um impulso rápido na direção em que você anda — uma vez por tentativa.\nParado, ele segue a seta mostrada no personagem. Não atravessa paredes nem perigos.",
      },
      start: { x: 60, y: 430 },
      key: { x: 400, y: 70 },
      door: { x: 740, y: 430 },
      coin: { x: 400, y: 330 },
      target: 5.5,
      walls: [
        { x: 240, y: 120, w: 26, h: 380 },
        { x: 520, y: 0, w: 26, h: 380 },
      ],
    },
    {
      name: "Desvio da moeda",
      hint: "A moeda fica num desvio — o impulso ajuda",
      start: { x: 60, y: 440 },
      key: { x: 420, y: 440 },
      door: { x: 740, y: 440 },
      coin: { x: 700, y: 80 },
      target: 5.0,
      walls: [
        { x: 300, y: 140, w: 26, h: 360 },
        { x: 540, y: 0, w: 26, h: 360 },
      ],
    },
    {
      name: "Impulso e laser",
      hint: "Os lasers ligam juntos: só o impulso cruza os dois",
      start: { x: 60, y: 430 },
      key: { x: 210, y: 80 },
      door: { x: 740, y: 250 },
      coin: { x: 580, y: 420 },
      target: 5.0,
      lasers: [
        { x: 300, y: 0, w: 60, h: 500, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
        { x: 376, y: 0, w: 60, h: 500, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
      ],
    },
    {
      name: "Botão, portal e impulso",
      hint: "Abra a passagem, cruze os lasers e use o portal",
      start: { x: 50, y: 430 },
      key: { x: 340, y: 440 },
      door: { x: 745, y: 60 },
      coin: { x: 330, y: 200 },
      target: 6.0,
      walls: [
        { x: 270, y: 0, w: 26, h: 380 },
        { x: 270, y: 470, w: 26, h: 30 },
        { x: 600, y: 0, w: 26, h: 226 },
        { x: 600, y: 200, w: 200, h: 26 },
      ],
      gates: [{ x: 270, y: 380, w: 26, h: 90 }],
      switches: [{ x: 130, y: 90, gate: 0 }],
      lasers: [
        { x: 400, y: 0, w: 60, h: 500, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
        { x: 476, y: 0, w: 60, h: 500, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
      ],
      portals: [{ a: { x: 660, y: 430 }, b: { x: 700, y: 110 } }],
    },
    {
      name: "A grande fuga",
      hint: "Tudo o que você aprendeu, em dez segundos",
      start: { x: 50, y: 250 },
      key: { x: 440, y: 430 },
      door: { x: 745, y: 450 },
      coin: { x: 470, y: 260 },
      target: 7.0,
      walls: [
        { x: 200, y: 0, w: 26, h: 200 },
        { x: 200, y: 300, w: 26, h: 200 },
        { x: 520, y: 0, w: 26, h: 500 },
      ],
      gates: [{ x: 200, y: 200, w: 26, h: 100 }],
      switches: [{ x: 120, y: 80, gate: 0 }],
      spikes: [{ x: 0, y: 340, w: 150, h: 160 }],
      movers: [{ x1: 340, y1: 30, x2: 340, y2: 470, speed: 220, r: 22, phase: 0 }],
      portals: [{ a: { x: 440, y: 110 }, b: { x: 600, y: 110 } }],
      lasers: [
        { x: 546, y: 240, w: 254, h: 60, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
        { x: 546, y: 316, w: 254, h: 60, on: 1.0, off: 0.5, warn: 0.3, offset: 0 },
      ],
    },

    /* ---------------- PARTE 4: gelo e esteiras (setor Câmara de escape) ---------------- */
    {
      name: "Gelo",
      hint: "No gelo você freia devagar — solte cedo",
      intro: {
        title: "Novo: gelo",
        text: "No gelo você acelera, freia e vira devagar. Solte o direcional um pouco antes de onde quer parar.\nParedes e as áreas normais ajudam a frear. O impulso ignora o gelo.",
      },
      start: { x: 60, y: 250 },
      key: { x: 330, y: 100 },
      door: { x: 740, y: 250 },
      coin: { x: 300, y: 420 },
      target: 5.0,
      ice: [{ x: 180, y: 40, w: 300, h: 420 }],
      walls: [
        { x: 480, y: 0, w: 26, h: 190 },
        { x: 480, y: 310, w: 26, h: 190 },
        { x: 330, y: 250, w: 26, h: 120 },
      ],
    },
    {
      name: "Esteiras",
      hint: "Siga as setas — contra o fluxo é mais lento",
      intro: {
        title: "Novo: esteiras",
        text: "As setas mostram para onde a esteira empurra. A favor do fluxo você é mais rápido; contra, mais lento — mas dá para andar.\nO impulso não é afetado pela esteira.",
      },
      start: { x: 60, y: 250 },
      key: { x: 445, y: 250 },
      door: { x: 720, y: 200 },
      coin: { x: 300, y: 100 },
      target: 4.5,
      belts: [
        { x: 150, y: 190, w: 250, h: 120, dx: 1, dy: 0 }, // a favor: leva ao centro
        { x: 400, y: 366, w: 220, h: 114, dx: -1, dy: 0 }, // contra: corredor sob a parede
      ],
      walls: [{ x: 480, y: 0, w: 26, h: 366 }],
    },
    {
      name: "Gelo e botão",
      hint: "Pare perto dos espinhos e abra a passagem",
      start: { x: 60, y: 250 },
      key: { x: 650, y: 430 },
      door: { x: 740, y: 80 },
      coin: { x: 220, y: 350 },
      target: 7.0,
      ice: [{ x: 100, y: 60, w: 370, h: 340 }],
      walls: [
        { x: 520, y: 0, w: 26, h: 200 },
        { x: 520, y: 300, w: 26, h: 200 },
      ],
      gates: [{ x: 520, y: 200, w: 26, h: 100 }],
      switches: [{ x: 430, y: 120, gate: 0 }],
      spikes: [
        { x: 470, y: 60, w: 30, h: 130 },
        { x: 470, y: 310, w: 30, h: 90 },
      ],
    },
    {
      name: "Esteira, portal e laser",
      hint: "A esteira leva ao portal — cruze o laser no tempo",
      start: { x: 50, y: 430 },
      key: { x: 510, y: 430 },
      door: { x: 765, y: 60 },
      coin: { x: 300, y: 200 },
      target: 4.5,
      belts: [
        { x: 100, y: 380, w: 380, h: 100, dx: 1, dy: 0 },
        { x: 580, y: 380, w: 100, h: 100, dx: 1, dy: 0 },
      ],
      lasers: [{ x: 553, y: 0, w: 14, h: 500, on: 1.0, off: 0.9, warn: 0.4, offset: 0 }],
      walls: [
        { x: 620, y: 0, w: 26, h: 226 },
        { x: 620, y: 200, w: 180, h: 26 },
      ],
      portals: [{ a: { x: 688, y: 430 }, b: { x: 710, y: 110 } }],
    },
    {
      name: "A fuga",
      hint: "Gelo, esteira, botão, laser, portal e serra",
      start: { x: 50, y: 250 },
      key: { x: 420, y: 430 },
      door: { x: 745, y: 60 },
      coin: { x: 150, y: 110 },
      target: 8.0,
      ice: [{ x: 90, y: 300, w: 160, h: 170 }],
      walls: [
        { x: 300, y: 0, w: 26, h: 200 },
        { x: 300, y: 300, w: 26, h: 200 },
        { x: 570, y: 0, w: 26, h: 500 },
      ],
      gates: [{ x: 300, y: 200, w: 26, h: 100 }],
      switches: [{ x: 140, y: 420, gate: 0 }],
      belts: [{ x: 440, y: 130, w: 80, h: 350, dx: 0, dy: -1 }],
      lasers: [{ x: 326, y: 300, w: 244, h: 14, on: 1.0, off: 0.9, warn: 0.4, offset: 0 }],
      portals: [{ a: { x: 480, y: 70 }, b: { x: 680, y: 330 } }],
      movers: [{ x1: 610, y1: 180, x2: 790, y2: 180, speed: 150, r: 18, phase: 0 }],
    },

    /* ---------------- PARTE 5: drones de patrulha (setor extra, depois da sala 20) ---------------- */
    {
      name: "Drone de patrulha",
      hint: "Espere o drone passar e atravesse",
      intro: {
        title: "Novo: drone de patrulha",
        text: "O drone repete a rota pontilhada, sem perseguir você. Encostar nele é derrota.\nEspere a hora certa para atravessar a rota. O impulso também não atravessa o drone.",
      },
      start: { x: 60, y: 250 },
      key: { x: 240, y: 110 },
      door: { x: 740, y: 250 },
      coin: { x: 600, y: 430 },
      target: 4.0,
      drones: [{ route: [[420, 40], [420, 460]], speed: 130 }],
    },
    {
      name: "Hora certa",
      hint: "A abertura é estreita: passe quando o drone sair",
      start: { x: 60, y: 430 },
      key: { x: 350, y: 430 },
      door: { x: 745, y: 50 },
      coin: { x: 200, y: 110 },
      target: 5.0,
      walls: [
        { x: 0, y: 226, w: 660, h: 26 },
        { x: 730, y: 226, w: 70, h: 26 },
      ],
      drones: [{ route: [[695, 110], [695, 440]], speed: 110 }],
    },
    {
      name: "Drone e botão",
      hint: "O botão está dentro da rota do drone",
      start: { x: 60, y: 300 },
      key: { x: 520, y: 430 },
      door: { x: 740, y: 80 },
      coin: { x: 600, y: 250 },
      target: 5.5,
      walls: [
        { x: 330, y: 0, w: 26, h: 200 },
        { x: 330, y: 300, w: 26, h: 200 },
      ],
      gates: [{ x: 330, y: 200, w: 26, h: 100 }],
      switches: [{ x: 180, y: 160, gate: 0 }],
      drones: [{ route: [[100, 100], [260, 100], [260, 220], [100, 220]], speed: 120 }],
    },
    {
      name: "Drone e portal",
      hint: "Saia do portal e cruze a patrulha",
      start: { x: 60, y: 60 },
      key: { x: 700, y: 430 },
      door: { x: 745, y: 60 },
      coin: { x: 520, y: 330 },
      target: 6.5,
      walls: [
        { x: 130, y: 0, w: 26, h: 300 },
        { x: 400, y: 0, w: 28, h: 500 },
      ],
      portals: [{ a: { x: 270, y: 420 }, b: { x: 500, y: 110 } }],
      drones: [{ route: [[620, 140], [620, 440]], speed: 120 }],
    },
    {
      name: "Patrulha dupla",
      hint: "Dois drones, um botão e a porta",
      start: { x: 50, y: 250 },
      key: { x: 480, y: 150 },
      door: { x: 740, y: 440 },
      coin: { x: 600, y: 200 },
      target: 5.5,
      walls: [
        { x: 330, y: 0, w: 26, h: 200 },
        { x: 330, y: 300, w: 26, h: 200 },
      ],
      gates: [{ x: 330, y: 200, w: 26, h: 100 }],
      switches: [{ x: 150, y: 100, gate: 0 }],
      drones: [
        { route: [[250, 50], [250, 450]], speed: 120 },
        { route: [[440, 340], [740, 340]], speed: 110 },
      ],
    },

    /* ---------------- PARTE 6: setor Vigilância — sentinelas e perseguidores ---------------- */
    {
      name: "Sentinela",
      hint: "Fique fora do cone — a parede serve de cobertura",
      intro: {
        title: "Novo: sentinela",
        text: "A sentinela gira o cone de visão. Se você ficar dentro dele, o alerta enche em 0,8 s e você perde; fora dele, o alerta baixa.\nParedes e passagens fechadas bloqueiam a visão: use a sombra da parede. Ela não atira.",
      },
      start: { x: 60, y: 430 },
      key: { x: 400, y: 330 },
      door: { x: 740, y: 430 },
      coin: { x: 700, y: 120 },
      target: 4.5,
      walls: [{ x: 340, y: 230, w: 120, h: 30 }],
      sentinels: [{ x: 400, y: 30, a0: 55, a1: 125, fov: 50, range: 330, period: 6 }],
    },
    {
      name: "Sentinela e botão",
      hint: "O botão está na sombra; a passagem, não",
      start: { x: 60, y: 440 },
      key: { x: 520, y: 430 },
      door: { x: 740, y: 80 },
      coin: { x: 600, y: 250 },
      target: 6.5,
      walls: [
        { x: 330, y: 0, w: 26, h: 200 },
        { x: 330, y: 300, w: 26, h: 200 },
        { x: 125, y: 170, w: 80, h: 24 },
      ],
      gates: [{ x: 330, y: 200, w: 26, h: 100 }],
      switches: [{ x: 165, y: 320, gate: 0 }],
      sentinels: [{ x: 165, y: 40, a0: 60, a1: 120, fov: 50, range: 330, period: 6 }],
    },
    {
      name: "Perseguidor",
      hint: "Ele só acorda quando vê você — contorne o pilar",
      intro: {
        title: "Novo: perseguidor",
        text: "O perseguidor fica parado até você entrar no círculo pontilhado com linha de visão livre. Ele avisa por 0,5 s e depois persegue, mais devagar que você. Tocar nele é derrota.\nEle contorna paredes, mas NÃO usa portais nem sofre efeito de gelo ou esteira.",
      },
      start: { x: 60, y: 250 },
      key: { x: 700, y: 100 },
      door: { x: 60, y: 440 },
      coin: { x: 200, y: 100 },
      target: 7.5,
      walls: [{ x: 330, y: 170, w: 140, h: 160 }],
      chasers: [{ x: 560, y: 400, speed: 150, detect: 170 }],
    },
    {
      name: "Perseguidor e portal",
      hint: "O portal leva você para onde ele não alcança",
      start: { x: 60, y: 250 },
      key: { x: 700, y: 430 },
      door: { x: 745, y: 60 },
      coin: { x: 560, y: 380 },
      target: 5.5,
      walls: [{ x: 400, y: 0, w: 28, h: 500 }],
      portals: [{ a: { x: 300, y: 420 }, b: { x: 520, y: 110 } }],
      chasers: [{ x: 250, y: 300, speed: 150, detect: 150 }],
    },
    {
      name: "Vigilância total",
      hint: "Sombra para a sentinela, distância para o perseguidor",
      start: { x: 60, y: 430 },
      key: { x: 400, y: 330 },
      door: { x: 745, y: 60 },
      coin: { x: 150, y: 350 },
      target: 5.5,
      walls: [{ x: 340, y: 230, w: 120, h: 30 }],
      sentinels: [{ x: 400, y: 30, a0: 55, a1: 125, fov: 50, range: 330, period: 6 }],
      chasers: [{ x: 650, y: 330, speed: 150, detect: 150 }],
    },
  ];

  /* Setores da campanha: 5 salas cada. `theme` muda cenário, paredes e grade (formas diferentes
   * além das cores: tijolos / pontos / diagonais / chapas), sem alterar as fases. */
  const SECTORS = [
    { name: "Instalação", first: 0, last: 4,
      theme: { bg: "#0a0818", grid: "rgba(90,80,220,.12)", wallFill: "#1a1f55", wallStroke: "#6c7bff", wallGlow: "#5b6cff", pattern: "bricks", accent: "#6c7bff" } },
    { name: "Núcleo de segurança", first: 5, last: 9,
      theme: { bg: "#06141a", grid: "rgba(40,210,200,.10)", wallFill: "#0d2d33", wallStroke: "#2fd6c4", wallGlow: "#18b8a8", pattern: "dots", accent: "#2fd6c4" } },
    { name: "Laboratório", first: 10, last: 14,
      theme: { bg: "#120a1d", grid: "rgba(190,100,255,.12)", wallFill: "#2b1850", wallStroke: "#b07bff", wallGlow: "#9a5cff", pattern: "diag", accent: "#b07bff" } },
    { name: "Câmara de escape", first: 15, last: 19,
      theme: { bg: "#0d1118", grid: "rgba(200,220,255,.08)", wallFill: "#2a3248", wallStroke: "#d3e2ff", wallGlow: "#9fb6e8", pattern: "plates", accent: "#d3e2ff" } },
    { name: "Patrulha (extra)", first: 20, last: 24, extra: true,
      theme: { bg: "#150a14", grid: "rgba(255,110,190,.09)", wallFill: "#3a1738", wallStroke: "#ff7ac6", wallGlow: "#e0509c", pattern: "hex", accent: "#ff7ac6" } },
    { name: "Vigilância (extra)", first: 25, last: 29, extra: true,
      theme: { bg: "#0b130b", grid: "rgba(150,230,90,.09)", wallFill: "#1f3014", wallStroke: "#a6e35a", wallGlow: "#7fc03a", pattern: "scan", accent: "#a6e35a" } },
  ];

  root.SECTORS = SECTORS;
  root.LEVELS = LEVELS;
  // Cópia "pristina" (antes de qualquer normalização): as missões clonam daqui, então nunca alteram as salas da campanha.
  root.LEVELS_RAW = JSON.parse(JSON.stringify(LEVELS));
  if (typeof module !== "undefined") module.exports = LEVELS;
})(typeof window !== "undefined" ? window : globalThis);
