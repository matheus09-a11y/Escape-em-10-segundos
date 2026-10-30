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
