#!/usr/bin/env python3
"""Servidor do modo online de "Dez segundos para fugir" (3 jogadores cooperativos).

Só biblioteca padrão do Python 3.8+: nada para instalar.
  - serve os arquivos do jogo (index.html, *.js, *.css) — então um único endereço serve jogo e salas;
  - WebSocket em /ws: salas de 3 jogadores com código de 4 letras;
  - a simulação do jogo roda AQUI (coop_sim.py); os navegadores só mandam a direção e desenham.

Variáveis de ambiente: PORT (padrão 8080), HOST (padrão 0.0.0.0),
ALLOWED_ORIGINS (opcional, lista separada por vírgulas; se definida, só essas origens abrem WebSocket).

Nada é gravado em disco. Salas vivem na memória e somem quando todos saem.
"""
import asyncio
import base64
import hashlib
import json
import math
import os
import re
import secrets
import struct
import sys
import time

from coop_levels import LEVELS, ROLES, ROLE_IDS, SKIN_IDS, public, catalog
from coop_sim import Sim

BASE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8080"))
HOST = os.environ.get("HOST", "0.0.0.0")
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]

MAX_CONNS = 400
MAX_ROOMS = 120
MAX_FRAME = 4096
RATE_PER_SEC = 60.0          # mensagens por segundo por conexão (rajada de 2x)
IDLE_TIMEOUT = 45.0          # sem NADA recebido (o cliente manda ping a cada 10 s)
GRACE_LOBBY = 15.0
GRACE_PLAY = 30.0
INPUT_STALE = 0.8            # entrada de direção sem renovar por tanto tempo vira "parado"
TICK = 1 / 60
WIN_HOLD = 2.0               # tempo mostrando "escaparam" antes de ir sozinho para a próxima fase
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

STATIC_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json",
}
STATIC_BLOCK = {"server.py"}

rooms = {}       # código -> Room
conns = set()


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- WebSocket
class WSClosed(Exception):
    pass


async def ws_read(reader):
    """Lê uma mensagem completa (texto). Responde só a dados; ping/pong/close sobem como tuplas."""
    data = b""
    op0 = None
    while True:
        h = await reader.readexactly(2)
        fin, op = h[0] & 0x80, h[0] & 0x0F
        masked, ln = h[1] & 0x80, h[1] & 0x7F
        if not masked:
            raise WSClosed("frame sem máscara")
        if ln == 126:
            ln = struct.unpack(">H", await reader.readexactly(2))[0]
        elif ln == 127:
            ln = struct.unpack(">Q", await reader.readexactly(8))[0]
        if ln > MAX_FRAME or len(data) + ln > MAX_FRAME:
            raise WSClosed("frame grande demais")
        mask = await reader.readexactly(4)
        payload = bytearray(await reader.readexactly(ln))
        for i in range(ln):
            payload[i] ^= mask[i & 3]
        if op in (8, 9, 10):
            if not fin or ln > 125:
                raise WSClosed("controle inválido")
            return op, bytes(payload)
        if op == 0:
            if op0 is None:
                raise WSClosed("continuação sem início")
        elif op in (1, 2):
            if op0 is not None:
                raise WSClosed("início durante fragmentação")
            op0 = op
        else:
            raise WSClosed("opcode desconhecido")
        data += bytes(payload)
        if fin:
            return op0, data


def ws_frame(op, payload):
    n = len(payload)
    if n < 126:
        head = struct.pack("!BB", 0x80 | op, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x80 | op, 126, n)
    else:
        head = struct.pack("!BBQ", 0x80 | op, 127, n)
    return head + payload


class Conn:
    def __init__(self, reader, writer, ip):
        self.reader, self.writer, self.ip = reader, writer, ip
        self.room = None
        self.slot = None
        self.alive = True
        self.last_rx = time.monotonic()
        self.tokens = RATE_PER_SEC * 2
        self.tok_t = time.monotonic()
        self.last_emo = 0.0
        self.cerr = 0

    def send(self, obj):
        if not self.alive:
            return
        try:
            tr = self.writer.transport
            if tr.is_closing() or tr.get_write_buffer_size() > 200_000:   # cliente lento demais: derruba
                self.close()
                return
            self.writer.write(ws_frame(1, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()))
        except Exception:
            self.close()

    def close(self):
        if self.alive:
            self.alive = False
            try:
                self.writer.write(ws_frame(8, struct.pack("!H", 1000)))
            except Exception:
                pass
            try:
                self.writer.close()
            except Exception:
                pass

    def allow(self):
        now = time.monotonic()
        self.tokens = min(RATE_PER_SEC * 2, self.tokens + (now - self.tok_t) * RATE_PER_SEC)
        self.tok_t = now
        if self.tokens < 1:
            return False
        self.tokens -= 1
        return True


# ---------------------------------------------------------------- Salas
def clean_skin(s):
    return s if isinstance(s, str) and s in SKIN_IDS else "explorer"


def clean_name(s):
    s = re.sub(r"[^\w .!?\-À-ÿ]", "", str(s or ""), flags=re.UNICODE)[:14].strip()
    return s or "Jogador"


class Slot:
    def __init__(self, idx, name, conn):
        self.idx, self.name, self.conn = idx, name, conn
        self.roles = []             # com menos de 3 jogadores, um jogador pode acumular papéis
        self.skin = "explorer"
        self.token = secrets.token_urlsafe(12)
        self.dropped = None          # instante da queda (None = conectado)
        self.inp = (0.0, 0.0)
        self.inp_t = 0.0


class Room:
    def __init__(self, code):
        self.code = code
        self.slots = [None, None, None]
        self.size = 3             # quantos jogadores esta sala terá (1 a 3), escolhido pelo anfitrião
        self.host = 0
        self.level = 0
        self.phase = "lobby"      # lobby | playing
        self.sim = None
        self.task = None
        self.paused = False
        self.won_at = None
        self.created = time.monotonic()
        self.empty_since = None

    # -- utilidades
    def connected(self):
        return [s for s in self.slots if s and s.conn and s.conn.alive]

    def broadcast(self, obj, skip=None):
        for s in self.slots:
            if s and s.conn and s.conn.alive and s is not skip:
                s.conn.send(obj)

    def state(self):
        return {
            "t": "room", "code": self.code, "host": self.host, "size": self.size, "level": self.level, "phase": self.phase, "paused": self.paused,
            "players": [None if s is None else {"name": s.name, "roles": s.roles, "skin": s.skin, "on": bool(s.conn and s.conn.alive)} for s in self.slots],
        }

    def push_state(self):
        self.broadcast(self.state())

    def free_slot(self):
        for i in range(self.size):
            if self.slots[i] is None:
                return i
        return None

    def reassign_host(self):
        if self.slots[self.host] and self.slots[self.host].conn and self.slots[self.host].conn.alive:
            return
        for i, s in enumerate(self.slots):
            if s and s.conn and s.conn.alive:
                self.host = i
                return

    def remove(self, idx):
        s = self.slots[idx]
        self.slots[idx] = None
        if s and s.conn:
            s.conn.room = None
            s.conn.slot = None
        if self.phase == "playing":
            self.stop_game("Alguém saiu da sala.")
        self.reassign_host()

    # -- jogo
    def can_start(self):
        ss = self.slots[:self.size]
        if any(x is None or not (x.conn and x.conn.alive) for x in ss):
            return f"Precisamos de {self.size} jogador{'es' if self.size > 1 else ''} conectado{'s' if self.size > 1 else ''}."
        if any(len(x.roles) != 1 for x in ss):
            return "Cada jogador precisa escolher 1 poder."
        need = LEVELS[self.level]["min"]
        if self.size < need:
            return f"Essa fase precisa de pelo menos {need} jogadores."
        return None

    def start_game(self):
        self.phase = "playing"
        self.paused = False
        self.won_at = None
        lv = LEVELS[self.level]
        self.sim = Sim(lv, [s.roles for s in self.slots[:self.size]])
        for s in self.slots:
            if s:
                s.inp, s.inp_t = (0.0, 0.0), 0.0
        self.broadcast({"t": "level", "level": public(lv), "n": self.level, "total": len(LEVELS), "roles": [s.roles for s in self.slots[:self.size]], "size": self.size})
        self.push_state()
        if self.task:
            self.task.cancel()
        self.task = asyncio.ensure_future(self.run())

    def advance(self):
        """Depois da vitória: segue sozinho para a próxima fase possível (ou encerra)."""
        nxt = next((i for i in range(self.level + 1, len(LEVELS)) if LEVELS[i]["min"] <= self.size), None)
        if nxt is not None:
            self.level = nxt
            self.start_game()
        else:
            self.stop_game("Vocês zeraram o que dava para jogar com " + str(self.size) + " jogador" + ("es" if self.size > 1 else "") + "! 🏆")

    def stop_game(self, why=None):
        self.phase = "lobby"
        self.paused = False
        self.sim = None
        if self.task:
            self.task.cancel()
            self.task = None
        for s in self.slots:
            if s:
                s.inp = (0.0, 0.0)
        self.broadcast({"t": "stopped", "why": why or ""})
        self.push_state()

    async def run(self):
        sim = self.sim
        nxt = time.monotonic()
        n = 0
        try:
            while self.phase == "playing" and self.sim is sim:
                nxt += TICK
                delay = nxt - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
                elif delay < -0.25:
                    nxt = time.monotonic()
                    await asyncio.sleep(0)
                now = time.monotonic()
                # entradas (a direção expira se o cliente parar de renovar)
                for i, s in enumerate(self.slots):
                    if s:
                        x, y = s.inp if now - s.inp_t < INPUT_STALE else (0.0, 0.0)
                        sim.set_input(i, x, y)
                if self.paused:
                    n += 1
                    if n % 30 == 0:
                        self.broadcast(sim.snapshot())
                    continue
                before = sim.phase
                if sim.phase == "won":
                    if self.won_at is None:
                        self.won_at = now
                    elif now - self.won_at >= WIN_HOLD:
                        self.advance()
                        return
                    nxt += 0.09     # parado: 10 quadros por segundo bastam
                else:
                    self.won_at = None
                sim.tick(TICK)
                for ev in sim.events:
                    self.broadcast({"t": "ev", "e": list(ev)})
                sim.events.clear()
                n += 1
                if n % 2 == 0 or sim.phase != before:
                    self.broadcast(sim.snapshot())
        except asyncio.CancelledError:
            pass
        except Exception as e:  # nunca derrubar o servidor por causa de uma sala
            log("erro na sala", self.code, repr(e))
            self.stop_game("Erro interno na sala.")


def new_code():
    for _ in range(50):
        c = "".join(secrets.choice(CODE_CHARS) for _ in range(4))
        if c not in rooms:
            return c
    return None


def drop_room(room):
    if room.task:
        room.task.cancel()
    rooms.pop(room.code, None)
    for s in room.slots:
        if s and s.conn:
            s.conn.room = None
            s.conn.slot = None


# ---------------------------------------------------------------- Mensagens
def err(conn, msg):
    conn.send({"t": "err", "msg": msg})


def attach(conn, room, idx):
    conn.room, conn.slot = room, idx
    s = room.slots[idx]
    s.conn, s.dropped = conn, None


def handle(conn, m):
    t = m.get("t")
    room = conn.room
    if t == "ping":
        conn.send({"t": "pong", "ts": m.get("ts")})
        return
    if t == "create":
        if room:
            return err(conn, "Você já está em uma sala.")
        if len(rooms) >= MAX_ROOMS:
            return err(conn, "O servidor está cheio. Tente de novo em alguns minutos.")
        code = new_code()
        if not code:
            return err(conn, "Não foi possível criar a sala.")
        room = rooms[code] = Room(code)
        room.slots[0] = Slot(0, clean_name(m.get("name")), conn)
        room.slots[0].skin = clean_skin(m.get("skin"))
        attach(conn, room, 0)
        room.host = 0
        conn.send({"t": "joined", "code": code, "you": 0, "token": room.slots[0].token})
        room.push_state()
        log("sala criada", code, "salas:", len(rooms))
        return
    if t == "join":
        if room:
            return err(conn, "Você já está em uma sala.")
        code = str(m.get("code", "")).strip().upper()[:4]
        r = rooms.get(code)
        if not r:
            return err(conn, "Sala não encontrada. Confira o código.")
        if r.phase != "lobby":
            return err(conn, "Essa sala já começou a jogar.")
        i = r.free_slot()
        if i is None:
            return err(conn, f"A sala está cheia ({r.size} jogador{'es' if r.size > 1 else ''}).")
        r.slots[i] = Slot(i, clean_name(m.get("name")), conn)
        r.slots[i].skin = clean_skin(m.get("skin"))
        attach(conn, r, i)
        conn.send({"t": "joined", "code": code, "you": i, "token": r.slots[i].token})
        r.reassign_host()
        r.push_state()
        return
    if t == "rejoin":
        if room:
            return
        r = rooms.get(str(m.get("code", "")).strip().upper()[:4])
        tok = str(m.get("token", ""))
        idx = next((i for i, s in enumerate(r.slots) if s and secrets.compare_digest(s.token, tok)), None) if r else None
        if idx is None:
            return err(conn, "Não foi possível voltar para a sala.")
        old = r.slots[idx].conn
        attach(conn, r, idx)
        if old and old is not conn:
            old.room = None
            old.close()
        conn.send({"t": "joined", "code": r.code, "you": idx, "token": r.slots[idx].token, "back": True})
        if r.phase == "playing" and r.sim:
            conn.send({"t": "level", "level": public(LEVELS[r.level]), "n": r.level, "total": len(LEVELS), "roles": [s.roles for s in r.slots[:r.size]], "size": r.size})
            if all(s and s.conn and s.conn.alive for s in r.slots[:r.size]):
                r.paused = False
                r.sim.resume_count(2.0)
        r.reassign_host()
        r.push_state()
        return
    if not room:
        return err(conn, "Entre em uma sala primeiro.")
    me = room.slots[conn.slot]
    if t == "role":
        if room.phase != "lobby":
            return
        r = m.get("role")
        if r is None:
            me.roles = []
        elif r in ROLES:
            if r in me.roles:
                me.roles = []
            elif any(x and x is not me and r in x.roles for x in room.slots):
                return err(conn, "Esse papel já foi escolhido por outro jogador.")
            else:
                me.roles = [r]          # um poder por jogador: escolher outro troca o anterior
        else:
            return
        room.push_state()
    elif t == "size":
        if conn.slot != room.host or room.phase != "lobby":
            return
        n = m.get("n")
        if not (isinstance(n, int) and not isinstance(n, bool) and 1 <= n <= 3):
            return
        if any(room.slots[i] for i in range(n, 3)):
            return err(conn, "Há jogadores demais na sala para esse tamanho.")
        room.size = n
        for x in room.slots:
            if x:
                x.roles = []
        if LEVELS[room.level]["min"] > n:
            room.level = next(i for i, lv in enumerate(LEVELS) if lv["min"] <= n)
        room.push_state()
    elif t == "cerr":
        if conn.cerr < 3:       # relatório de erro de desenho do navegador de alguém (ajuda a achar bugs)
            conn.cerr += 1
            log("erro no cliente:", str(m.get("m", ""))[:120], "|", str(m.get("ua", ""))[:80])
    elif t == "skin":
        me.skin = clean_skin(m.get("id"))
        room.push_state()
    elif t == "level":
        if conn.slot != room.host or room.phase != "lobby":
            return
        n = m.get("n")
        if isinstance(n, int) and not isinstance(n, bool) and 0 <= n < len(LEVELS):
            if LEVELS[n]["min"] > room.size:
                return err(conn, f"Essa fase precisa de pelo menos {LEVELS[n]['min']} jogadores.")
            room.level = n
            room.push_state()
    elif t == "start":
        if conn.slot != room.host or room.phase != "lobby":
            return
        why = room.can_start()
        if why:
            return err(conn, why)
        room.start_game()
    elif t == "in":
        if room.phase != "playing":
            return
        try:
            x, y = float(m.get("x", 0)), float(m.get("y", 0))
        except (TypeError, ValueError):
            return
        if not (math.isfinite(x) and math.isfinite(y)):
            return
        me.inp, me.inp_t = (max(-1.0, min(1.0, x)), max(-1.0, min(1.0, y))), time.monotonic()
    elif t == "emo":
        k = m.get("k")
        now = time.monotonic()
        if isinstance(k, int) and 0 <= k < 6 and now - conn.last_emo > 0.6:
            conn.last_emo = now
            room.broadcast({"t": "emo", "s": conn.slot, "k": k})
    elif t == "restart":
        if conn.slot == room.host and room.phase == "playing" and room.sim:
            room.sim.reset()
            room.broadcast(room.sim.snapshot())
    elif t == "next":
        if conn.slot == room.host and room.phase == "playing" and room.sim and room.sim.phase == "won":
            room.advance()
    elif t == "lobby":
        if conn.slot == room.host and room.phase == "playing":
            room.stop_game("")
    elif t == "leave":
        leave(conn, explicit=True)


def leave(conn, explicit=False):
    room, idx = conn.room, conn.slot
    if not room:
        return
    conn.room = None
    conn.slot = None
    if idx is None or room.slots[idx] is None:
        return
    if explicit:
        room.slots[idx] = None
        if room.phase == "playing":
            room.stop_game("Alguém saiu da sala.")
        room.reassign_host()
        if not room.connected():
            drop_room(room)
        else:
            room.push_state()
        return
    # queda de conexão: guarda a vaga por um tempo (reaper decide)
    s = room.slots[idx]
    if s.conn is conn:
        s.conn, s.dropped = None, time.monotonic()
        if room.phase == "playing":
            room.paused = True
            room.broadcast({"t": "paused", "who": idx})
        room.reassign_host()
        room.push_state()


async def reaper():
    while True:
        await asyncio.sleep(1.0)
        now = time.monotonic()
        for room in list(rooms.values()):
            for i, s in enumerate(room.slots):
                if s and s.conn is None and s.dropped is not None:
                    if now - s.dropped > (GRACE_PLAY if room.phase == "playing" else GRACE_LOBBY):
                        room.slots[i] = None
                        if room.phase == "playing":
                            room.stop_game("Um jogador não voltou a tempo.")
                        room.reassign_host()
                        room.push_state()
            if not room.connected():
                room.empty_since = room.empty_since or now
                if now - room.empty_since > GRACE_LOBBY:
                    drop_room(room)
                    log("sala removida", room.code, "salas:", len(rooms))
            else:
                room.empty_since = None
        for c in list(conns):
            if now - c.last_rx > IDLE_TIMEOUT:
                c.close()


# ---------------------------------------------------------------- HTTP / WS
async def read_head(reader):
    data = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    if len(data) > 8192:
        raise ValueError("cabeçalho grande")
    lines = data.decode("latin-1").split("\r\n")
    method, path, _ = lines[0].split(" ", 2)
    hdr = {}
    for ln in lines[1:]:
        if ":" in ln:
            k, v = ln.split(":", 1)
            hdr[k.strip().lower()] = v.strip()
    return method, path, hdr


def http_reply(writer, status, body=b"", ctype="text/plain; charset=utf-8", head_only=False, extra=""):
    reason = {200: "OK", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 503: "Service Unavailable"}.get(status, "OK")
    h = (f"HTTP/1.1 {status} {reason}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\nCache-Control: no-cache\r\n"
         f"X-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n{extra}\r\n")
    writer.write(h.encode("latin-1") + (b"" if head_only else body))


def static_file(path):
    path = path.split("?", 1)[0].split("#", 1)[0]
    if path in ("", "/"):
        path = "/index.html"
    name = path.lstrip("/")
    if "/" in name or "\\" in name or name.startswith(".") or name in STATIC_BLOCK:
        return None
    ext = os.path.splitext(name)[1].lower()
    if ext not in STATIC_TYPES:
        return None
    fp = os.path.join(BASE, name)
    if not os.path.isfile(fp):
        return None
    with open(fp, "rb") as f:
        return f.read(), STATIC_TYPES[ext]


async def on_client(reader, writer):
    peer = writer.get_extra_info("peername")
    ip = peer[0] if peer else "?"
    try:
        method, path, hdr = await read_head(reader)
    except Exception:
        writer.close()
        return
    try:
        if hdr.get("upgrade", "").lower() == "websocket" and path.split("?")[0] in ("/ws", "/"):
            origin = hdr.get("origin", "").rstrip("/")
            if ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
                http_reply(writer, 403, b"origem nao permitida")
            elif len(conns) >= MAX_CONNS:
                http_reply(writer, 503, b"servidor cheio")
            else:
                await ws_session(reader, writer, hdr, ip)
            return
        if method not in ("GET", "HEAD"):
            http_reply(writer, 405)
        elif path.split("?")[0] == "/health":
            http_reply(writer, 200, json.dumps({"ok": True, "rooms": len(rooms), "conns": len(conns)}, separators=(",", ":")).encode(), "application/json", method == "HEAD")
        else:
            f = static_file(path)
            if f is None:
                http_reply(writer, 404, b"nao encontrado", head_only=method == "HEAD")
            else:
                http_reply(writer, 200, f[0], f[1], method == "HEAD")
        await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def ws_session(reader, writer, hdr, ip):
    key = hdr.get("sec-websocket-key")
    if not key:
        http_reply(writer, 400, b"sem chave")
        return
    acc = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    writer.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                  f"Sec-WebSocket-Accept: {acc}\r\n\r\n").encode())
    conn = Conn(reader, writer, ip)
    conns.add(conn)
    conn.send({"t": "hi", "v": 1, "levels": catalog(), "roles": ROLES})
    try:
        while conn.alive:
            op, payload = await ws_read(reader)
            conn.last_rx = time.monotonic()
            if op == 8:
                break
            if op == 9:
                writer.write(ws_frame(10, payload))
                continue
            if op == 10:
                continue
            if not conn.allow():
                conn.close()
                break
            try:
                m = json.loads(payload.decode("utf-8"))
            except Exception:
                continue
            if isinstance(m, dict):
                handle(conn, m)
    except (asyncio.IncompleteReadError, ConnectionError, WSClosed, OSError):
        pass
    except Exception as e:
        log("erro de conexão", repr(e))
    finally:
        conns.discard(conn)
        try:
            leave(conn, explicit=False)
        except Exception as e:
            log("erro ao sair", repr(e))
        conn.close()


async def main():
    server = await asyncio.start_server(on_client, HOST, PORT, limit=2 ** 16)
    asyncio.ensure_future(reaper())
    log(f"Dez segundos para fugir — online em http://{HOST}:{PORT}  (WebSocket em /ws)")
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
