# Modo online (3 jogadores) — como colocar no ar

O servidor (`server.py`) usa só o Python 3.8+ (nada a instalar). Ele serve o jogo **e** as salas no mesmo endereço.

## Testar já, no seu computador
    python3 server.py            # abre em http://localhost:8080
Para os amigos entrarem de fora, exponha a porta com um túnel (ex.: `cloudflared tunnel --url http://localhost:8080`
ou `ngrok http 8080`) e mande o endereço https que ele mostrar.

## Deixar online de graça (Render)
1. Suba esta pasta para um repositório no GitHub.
2. Em render.com: New > Web Service > escolha o repositório. O `render.yaml` já configura tudo
   (Python, `python3 server.py`, health check `/health`).
3. Quando terminar, abra o endereço `https://….onrender.com`: o jogo está lá. Menu > "Online · 3 jogadores".
Obs.: no plano gratuito o servidor "dorme" sem uso; a primeira conexão pode levar cerca de 1 minuto.
Qualquer host que rode `python3 server.py` e respeite a variável `PORT` serve (Railway, Fly, VPS…).

## Como se joga
Um jogador cria a sala e manda o código/convite; os outros entram. Cada um escolhe um papel diferente
(🔥 Brasa: espinhos · 💧 Onda: lasers · 🌿 Folha: serras). O anfitrião escolhe a fase e começa.
Todos precisam chegar à porta; a chave vale para o time; qualquer derrota reinicia para os 3.

## Testes (sem rede externa)
    python3 test_coop.py      # regras e solução de cada fase (robôs)
    python3 test_server.py    # servidor real + 3 clientes WebSocket

## Segurança e limites
Nada é gravado em disco; salas somem quando todos saem. Limites: 400 conexões, 120 salas, mensagens de até 4 KB,
60 mensagens/s por conexão. `ALLOWED_ORIGINS=https://meusite.com` restringe quem pode abrir WebSocket.
Não há contas nem moderação: quem tem o código entra na sala (3 vagas).

## Regras da partida (atualização de configuração e sincronização)

- **Tempo por tentativa**: o anfitrião escolhe no lobby (10, 15, 20, 25, 30, 45, 60 s ou qualquer inteiro de 5 a 300). Padrão 25 s.
  Todos veem o valor; só o anfitrião muda, só no lobby; mudar o tempo (ou a fase / o tamanho da sala) desfaz o "pronto" de todos.
  Reiniciar mantém o limite escolhido. O tempo não muda a velocidade de nada. Cada fase tem um tempo mínimo (`PAR` em `coop_levels.py`)
  e o lobby avisa quando o tempo escolhido é impossível ou apertado.
- **Início sincronizado**: todos ficam "prontos" -> o anfitrião começa -> o servidor manda a fase -> cada navegador responde `loaded` ->
  só quando TODOS responderam começa a contagem de 3 s (nenhum tempo corre antes; 20 s sem resposta voltam ao lobby).
- **Quem decide tudo é o servidor** (`coop_sim.py` + `server.py`): início, tempo, morte e vitória. O navegador só envia direção e desenha.
- **Tempo compartilhado**: cada quadro do servidor traz `st` (relógio do servidor) e `en` (prazo de término); o navegador calcula o
  restante por `en - relógio estimado do servidor`, sem contador próprio. Tempo esgotado = uma única derrota do grupo e um único reinício.
- **Tentativas**: cada tentativa tem número (`a`); eventos e quadros atrasados de uma tentativa anterior são descartados; `restart` leva `a`.
- **Morte**: qualquer perigo que atinja qualquer jogador (ou o tempo esgotar) encerra a tentativa para TODOS; o servidor reinicia tudo
  (jogadores, placas, interruptores, portas, chave, serras, lasers e cronômetro) depois de ~2 s.
- **Vitória**: com a chave pega, TODOS os participantes vivos dentro da área de saída (72x72 u) ao mesmo tempo. Ninguém some ao chegar.
- **Mecanismos**: placa de pressão (segura a porta aberta só enquanto alguém está em cima; vários jogadores na mesma placa não alternam
  nada) e interruptor (liga até o fim da tentativa). Uma porta nunca fecha em cima de alguém: fica aberta enquanto a passagem estiver ocupada.
- **Participantes fixos**: ninguém entra durante a partida (mensagem clara); quem cair encerra a tentativa e o grupo volta ao lobby com o motivo.
  Trocar de aba não pausa ninguém: os comandos de movimento são limpos ao perder o foco e o servidor ignora direção parada.
  Se o anfitrião sair, outro jogador vira anfitrião (migração) e a partida em andamento é encerrada com aviso.
- **Marcações**: `mark` (k 0..2: Aqui! / Preciso de ajuda! / Vá para a saída!, x, y); no máximo 1 a cada 1,2 s por jogador; sem texto livre.

## Rede: resposta dos controles (previsão + reconciliação)

- O navegador envia o movimento em **comandos numerados** (`mv`: `{s: primeiro número, d: [códigos 0..8]}`; 1 comando = 1/60 s; 8 direções).
  Idle não envia nada; mudança de direção sai na hora; o resto sai em lotes de ~30 ms. O servidor aplica 1 comando por quadro
  (fila de no máximo 8: não dá para andar mais rápido mandando comandos demais), descarta números repetidos/antigos e devolve em cada
  quadro o último número aplicado (`ak`). `in` (direção por estado) continua aceito para robôs e navegadores antigos.
- O boneco **local** é previsto no navegador com a mesma regra do servidor (colisões com paredes e com as portas como o servidor as mostrou).
  A cada quadro do servidor, o navegador refaz os comandos ainda não aplicados em cima da posição autorizada e compara com o que previu:
  erro pequeno some aos poucos na tela, erro grande (> 40 u) é corrigido na hora. A previsão **nunca** abre porta, decide morte, vitória ou tempo.
- Os **outros** jogadores são interpolados (buffer de ~90 ms, extrapolação limitada a 100 ms) usando o relógio do servidor.
- Eventos levam contador (`i`) e tentativa (`a`): repetidos e antigos são descartados. Evento de placa/porta/chave gera quadro imediato.
- Não há impulso (dash) no modo cooperativo, então não há o que reconciliar nele.
- **Diagnóstico** (desligado por padrão): tecla **F3** durante a partida, ou Menu → "Diagnóstico de rede". Mostra só valores medidos
  no navegador: FPS e pior quadro, RTT (ping real) e mediana, quadros/s recebidos e KB/s, lotes e comandos/s enviados, correções do boneco
  local (quantas, média, máxima), comandos a caminho, tamanho do buffer de interpolação e eventos descartados.
- `tools/latproxy.py` é um proxy que acrescenta latência/variação em cada sentido para medir (usado em `test_latencia.py` e nas medições).

## Fases novas

- **Dupla** (6 fases, exatamente 2 jogadores) e **Trio** (6 fases, exatamente 3 jogadores), além das 5 clássicas. Papéis fixos por ordem de
  vaga (1º 🔥, 2º 💧, 3º 🌿). A sala recusa iniciar com a quantidade errada e explica o requisito. Depois de vencer, segue para a próxima
  fase do mesmo conjunto. `python3 test_fases.py` confere estrutura, alcance, vitória de robôs e 25 execuções perturbadas por fase.

## Modalidade, mapas por quantidade e Expedição

- **Modalidade** (Dupla = 2 jogadores, Trio = 3): o anfitrião escolhe no lobby; ela define a capacidade da sala e a lista de mapas.
  Só muda fora de uma tentativa; ao mudar, o "pronto" de todos é desfeito e o mapa escolhido é desmarcado se for da outra modalidade.
  Com 3 participantes (inclusive quem caiu) a sala recusa virar Dupla e explica; nunca expulsa ninguém. Uma queda não transforma Trio em
  Dupla: o grupo volta ao lobby e espera. Começar exige exatamente a quantidade da modalidade, todos conectados e prontos.
- **Filtro obrigatório no servidor** (`coop_levels.compatible`, usado em `level`, `start`, `advance`, `size`, expedição e checkpoint): cada
  mapa tem `players` exato (2 ou 3); o servidor rejeita mapa de outra quantidade mesmo que o navegador peça (por índice, `id` numérico ou `mid`).
  A lista `maps` do estado da sala é a única fonte da lista que todos veem. Não existe modalidade de 1 jogador.
- **Classificação** (por funcionamento real, `test_mapas.py` / `test_fases.py`): Trio = clássicas 1-5 (a 4, "Em dupla", exige 3: duas placas
  seguradas ao mesmo tempo + 1 que passa) + 6 novas; Dupla = 6 novas + variantes `classic-1-duo`, `classic-2-duo`, `classic-3-duo` (mesmo desenho,
  2 largadas, papéis fixos, id próprio 18-20). Ids antigos 1..17 preservados; `mid` é o id textual estável.
- **Expedição**: 6 fases da modalidade em ordem crescente (Dupla: duo-1, duo-2, duo-4, duo-3, duo-6, duo-5; Trio: trio-1, trio-3, trio-2, trio-6, trio-4,
  trio-5), com o tempo escolhido; derrota reinicia só a fase atual; vitória mostra o resultado e **cada jogador confirma "Pronto para continuar"**
  (`cont` com o número da tela `rid`: repetido/antigo/de outra tela é ignorado); a próxima fase só começa com todos confirmados, carregados e a
  contagem de 3 s. Estatísticas: tempo ativo (só tempo de jogo), derrotas por fase e totais. Mudar o tempo ou a modalidade recomeça a expedição
  (resultados de configurações diferentes nunca se misturam). No fim: repetir ou voltar ao lobby (só o anfitrião).
- **Checkpoint** (`ckpt`, enviado só ao anfitrião e só ao concluir cada fase, nunca por quadro): `{v, seq:{id,ver}, mod, limit, next, stats}`.
  É guardado **somente no navegador do anfitrião** (localStorage) — o servidor gratuito não tem disco permanente. Ao continuar, o servidor valida
  tudo (versão, sequência, modalidade, tempo, fases e totais) e recusa o que for antigo/incompatível. A fase pendente recomeça do começo (sem posições).
  O progresso também fica na memória da sala enquanto ela existir (queda de alguém não perde a expedição). Novos participantes podem entrar: o
  checkpoint pertence à expedição e não comprova que cada pessoa jogou as fases anteriores.
