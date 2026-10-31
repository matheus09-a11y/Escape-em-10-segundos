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
