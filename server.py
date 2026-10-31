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
import collections
import hashlib
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

from coop_levels import LEVELS, ROLES, ROLE_IDS, SKIN_IDS, EXPEDITIONS, BY_MID, DIFF_NAMES, public, catalog, compatible, maps_for, variant_of_family, exp_maps, sequences
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
RS_STALE = 0.8                 # a ação de resgatar vale 0,8 s sem renovação
INPUT_STALE = 0.8            # entrada de direção sem renovar por tanto tempo vira "parado"
TICK = 1 / 60
_D = 0.7071067811865476
DIRS = [(0.0, 0.0), (1.0, 0.0), (_D, _D), (0.0, 1.0), (-_D, _D), (-1.0, 0.0), (-_D, -_D), (0.0, -1.0), (_D, -_D)]
CMD_QUEUE_MAX = 8            # comandos de movimento aguardando (cada um vale 1/60 s); passar disso descarta os mais antigos
DEFAULT_LIMIT = 25           # segundos por tentativa (o anfitrião muda no lobby: 5 a 300)
LIMIT_MIN, LIMIT_MAX = 5, 300
BUILD = "2026-11-02-r1"       # versão do cliente/servidor: mudou aqui => mudou em coop.js (BUILD). Clientes com página antiga são avisados.
REQUIRE_BUILD = os.environ.get("REQUIRE_BUILD", "1") == "1"    # os testes automáticos desligam (os robôs não têm "página")
SIZES = (2, 3)               # modalidades: Dupla (2) e Trio (3)
MODALITY = {2: "Dupla — 2 jogadores", 3: "Trio — 3 jogadores"}
EXP_STEPS = 6
DIFFS = ("easy", "normal", "hard")
LOAD_TIMEOUT = 20.0          # quanto esperamos todos carregarem a fase antes de voltar ao lobby
MARK_GAP = 1.2               # intervalo mínimo entre marcações de um mesmo jogador
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
        self.last_mark = 0.0

    def send(self, obj):
        self.send_raw(ws_frame(1, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode()))

    def send_raw(self, frame):
        if not self.alive:
            return
        try:
            tr = self.writer.transport
            if tr.is_closing() or tr.get_write_buffer_size() > 200_000:   # cliente lento demais: derruba
                self.close()
                return
            self.writer.write(frame)
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


_MVER = {}


def map_version(lv):
    """Versão curta do conteúdo do mapa (muda se qualquer parede, porta, perigo ou parâmetro mudar)."""
    k = lv["mid"]
    if k not in _MVER:
        _MVER[k] = hashlib.sha1(json.dumps(public(lv), sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:8]
    return _MVER[k]


def ent_counts(lv):
    """Quantidade de entidades do mapa por tipo: o servidor diz, cada navegador confere o que recebeu e desenhou."""
    return {k: len(lv.get(k) or []) for k in ("walls", "plates", "gates", "spikes", "lasers", "saws", "drones", "portals")}


class Slot:
    def __init__(self, idx, name, conn):
        self.idx, self.name, self.conn = idx, name, conn
        self.roles = []             # com menos de 3 jogadores, um jogador pode acumular papéis
        self.skin = "explorer"
        self.ready = False          # "estou pronto" no lobby
        self.loaded = False         # já carregou a fase atual (só vale durante a espera)
        self.build = None           # versão da página do jogador (None = página antiga, que não informa)
        self.ent_bad = 0            # confirmações de carga com entidades diferentes das do servidor
        self.fp = None              # impressão digital do estado do navegador (só com o diagnóstico ligado)
        self.fp_t = 0.0
        self.token = secrets.token_urlsafe(12)
        self.dropped = None          # instante da queda (None = conectado)
        self.inp = (0.0, 0.0)
        self.inp_t = 0.0
        self.rs = False             # mantendo a ação de resgatar
        self.rs_t = 0.0
        self.mode = "legacy"         # "cmd" depois do primeiro comando numerado (mv)
        self.cmdq = collections.deque(maxlen=CMD_QUEUE_MAX)
        self.expect = None           # próximo número de sequência esperado
        self.ack = 0                 # último comando aplicado pelo servidor


class Exp:
    """Progresso de uma EXPEDIÇÃO (6 fases da modalidade, em ordem). Fixa modalidade, capítulo, dificuldade e tempo durante a sequência.
    Só muda nas transições (derrota, vitória, reinício): nunca por quadro."""
    def __init__(self, n, limit, chap=1, diff="normal", rule="classic"):
        self.n, self.limit, self.chap, self.diff, self.rule = n, limit, chap, diff, rule
        self.seq = EXPEDITIONS[(n, chap)]
        self.maps = exp_maps(n, chap, diff)       # None = esse capítulo não existe nessa dificuldade
        self.step = 0               # fase atual/pendente (0..5); 6 = concluída
        self.per = []               # resultado de cada fase vencida: {"mid", "time", "defeats"}
        self.defeats = 0
        self.active = 0.0           # tempo ATIVO total: só o tempo de jogo das tentativas (sem contagem, carga, telas)
        self.cur_defeats = 0        # derrotas na fase atual
        self.restored = False       # veio de um checkpoint

    def available_(self):
        return self.maps is not None

    def has_progress(self):
        return self.step > 0 or self.defeats > 0 or self.active > 0

    def current_map(self):
        return self.maps[self.step] if self.maps and self.step < EXP_STEPS else None

    def stats(self):
        return {"active": round(self.active, 2), "defeats": self.defeats, "done": self.step, "per": [dict(x) for x in self.per]}

    def pub(self):
        return {"id": self.seq["id"], "ver": self.seq["ver"], "chapter": self.chap, "title": self.seq["title"], "diff": self.diff, "rule": self.rule, "available": self.maps is not None,
                "step": self.step, "total": EXP_STEPS, "mids": [LEVELS[i]["mid"] for i in self.maps] if self.maps else [], "maps": self.maps or [],
                "stats": self.stats(), "restored": self.restored, "progress": self.has_progress()}

    def checkpoint(self):
        return {"v": 2, "seq": {"id": self.seq["id"], "ver": self.seq["ver"]}, "mod": self.n, "diff": self.diff, "rule": self.rule, "limit": self.limit, "next": self.step,
                "stats": self.stats(), "saved": int(time.time())}


RULES = ("classic", "rescue")
RULE_NAMES = {"classic": "Clássico", "rescue": "Resgate"}


def _num(x, lo, hi):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and lo <= x <= hi


def validate_ckpt(ck, n, limit, diff="normal", chap=1, rule="classic"):
    """Valida um checkpoint ANTES de usá-lo. Devolve (Exp, None) ou (None, motivo).
    Versão 1 (anterior à dificuldade) é migrada com segurança: vale como NORMAL."""
    if not isinstance(ck, dict):
        return None, "Checkpoint inválido."
    v = ck.get("v")
    if v not in (1, 2):
        return None, "Checkpoint de uma versão antiga ou desconhecida: não dá para continuar por ele."
    cdiff = ck.get("diff", "normal") if v == 2 else "normal"          # v1 não tinha dificuldade: era sempre Normal
    seq = ck.get("seq")
    found = next(((k, e) for k, e in EXPEDITIONS.items() if isinstance(seq, dict) and seq.get("id") == e["id"]), None)
    if found is None or ck.get("mod") != n or found[0][0] != n:
        return None, "Esse checkpoint é de outra expedição ou de outra modalidade (Dupla × Trio)."
    (_, cchap), e = found
    if seq.get("ver") != e["ver"]:
        return None, "A sequência da expedição foi atualizada: esse checkpoint não vale mais."
    if cchap != chap:
        return None, f"Esse checkpoint é do {e['title']}. Escolha esse capítulo para continuar."
    if cdiff != diff:
        return None, f"Esse checkpoint é da dificuldade {DIFF_NAMES.get(cdiff, cdiff)} e a sala está em {DIFF_NAMES[diff]}. Ajuste a dificuldade para continuar."
    crule = ck.get("rule", "classic")                                   # checkpoints antigos não tinham regra: eram Clássico
    if crule not in RULES:
        return None, "Checkpoint com regra desconhecida."
    if crule != rule:
        return None, f"Esse checkpoint é da regra {RULE_NAMES[crule]} e a sala está em {RULE_NAMES[rule]}. Ajuste a regra para continuar."
    if ck.get("limit") != limit:
        return None, f"Esse checkpoint é de uma expedição com {ck.get('limit')} s por fase e a sala está com {limit} s. Ajuste o tempo para continuar."
    nxt = ck.get("next")
    if not (isinstance(nxt, int) and not isinstance(nxt, bool) and 1 <= nxt < EXP_STEPS):
        return None, "O checkpoint não tem uma fase pendente (a expedição já terminou ou ainda não começou)."
    maps = exp_maps(n, cchap, diff)
    if maps is None:
        return None, "Esse capítulo não existe nessa dificuldade."
    mids = [LEVELS[i]["mid"] for i in maps]
    st = ck.get("stats")
    if not isinstance(st, dict) or not isinstance(st.get("per"), list) or len(st["per"]) != nxt or st.get("done") != nxt:
        return None, "Checkpoint com estatísticas inconsistentes."
    tot_def, tot_time = 0, 0.0
    for i, it in enumerate(st["per"]):
        if not isinstance(it, dict) or it.get("mid") != mids[i] or not _num(it.get("time"), 0, limit + 1) or not (isinstance(it.get("defeats"), int) and not isinstance(it.get("defeats"), bool) and 0 <= it["defeats"] <= 999):
            return None, "Checkpoint com fases que não batem com a sequência."
        tot_def += it["defeats"]; tot_time += it["time"]
    if not (isinstance(st.get("defeats"), int) and not isinstance(st.get("defeats"), bool)) or st["defeats"] != tot_def or not _num(st.get("active"), tot_time - 0.5, 100000):
        return None, "Checkpoint com totais que não batem."
    x = Exp(n, limit, chap, diff, rule)
    x.step, x.per, x.defeats, x.active, x.restored = nxt, [{"mid": it["mid"], "time": float(it["time"]), "defeats": it["defeats"]} for it in st["per"]], tot_def, float(st["active"]), True
    return x, None


class Room:
    def __init__(self, code):
        self.code = code
        self.slots = [None, None, None]
        self.size = 3             # MODALIDADE = capacidade: 2 (Dupla) ou 3 (Trio), escolhida pelo anfitrião
        self.host = 0
        self.mode = "free"        # "free" (mapa avulso) | "exp" (expedição de 6 fases)
        self.difficulty = "normal"   # fácil | normal | difícil (independente do tempo)
        self.chapter = 1             # capítulo da expedição (1 = clássico, 2 = novas fases)
        self.level = maps_for(3, "normal")[0]   # mapa avulso escolhido (None = nenhum compatível/escolhido)
        self.exp = None           # Exp da modalidade e do tempo atuais
        self.transit = None       # tela de resultado entre fases da expedição (aguardando "pronto para continuar")
        self.rid = 0
        self.gid = 0              # número desta partida/fase (muda a cada start_game): mensagens de outra partida são ignoradas
        self.snapn = 0
        self.phase = "lobby"      # lobby | playing
        self.sim = None
        self.task = None
        self.paused = False
        self.won_at = None
        self.rule = "classic"        # regra da sala: "classic" | "rescue" (só o anfitrião muda, só no lobby; fixa durante a tentativa/expedição)
        self.limit = DEFAULT_LIMIT   # tempo da tentativa, igual para todos (só o anfitrião muda, só no lobby)
        self.load_t0 = None
        self.evn = 0                 # contador de eventos da sala (o navegador descarta repetidos/antigos)
        self.last_attempt = 0
        self.exp_counted = False
        self.created = time.monotonic()
        self.empty_since = None

    # -- utilidades
    def connected(self):
        return [s for s in self.slots if s and s.conn and s.conn.alive]

    def broadcast(self, obj, skip=None):
        frame = ws_frame(1, json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode())   # serializa UMA vez
        for s in self.slots:
            if s and s.conn and s.conn.alive and s is not skip:
                s.conn.send_raw(frame)

    def state(self):
        return {
            "t": "room", "code": self.code, "host": self.host, "size": self.size, "modality": MODALITY[self.size], "limit": self.limit, "level": self.level, "rule": self.rule, "rule_name": RULE_NAMES[self.rule],
            "build": BUILD, "mode": self.mode, "exp": self.exp.pub() if self.exp else None, "maps": maps_for(self.size, self.difficulty), "difficulty": self.difficulty, "diff_name": DIFF_NAMES[self.difficulty], "chapter": self.chapter,
            "transit": ({"rid": self.transit["rid"], "c": sorted(self.transit["confirmed"]), "final": self.transit["final"]} if self.transit else None),
            "phase": self.phase, "paused": self.paused,
            "players": [None if s is None else {"name": s.name, "roles": s.roles, "skin": s.skin, "ready": s.ready, "stale": bool(REQUIRE_BUILD and s.build != BUILD), "on": bool(s.conn and s.conn.alive)} for s in self.slots],
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
    def target(self):
        """Índice do mapa que COMEÇARIA agora (fase avulsa ou fase pendente da expedição)."""
        if self.mode == "exp":
            return self.exp.current_map() if self.exp else None
        return self.level

    def can_start(self):
        ss = self.slots[:self.size]
        need = f"{self.size} jogadores"
        if any(x is None or not (x.conn and x.conn.alive) for x in ss):
            return f"{MODALITY[self.size]}: precisamos de exatamente {need} conectados."
        old = [x.name for x in ss if REQUIRE_BUILD and x.build != BUILD]
        if old:
            return f"A página de {', '.join(old)} está desatualizada (versão diferente do servidor): recarregue com ⌘⇧R (Ctrl+Shift+R) antes de começar, senão elementos podem não aparecer."
        idx = self.target()
        if idx is None:
            if self.mode == "exp" and self.exp and not self.exp.available_():
                return f"O {self.exp.seq['title']} não existe na dificuldade {DIFF_NAMES[self.difficulty]}. Escolha o Capítulo 2 ou a dificuldade Normal."
            if self.mode == "exp" and self.exp and self.exp.step >= EXP_STEPS:
                return "Essa expedição já terminou: recomece do início."
            return "Escolha um mapa ou a Expedição."
        lv = LEVELS[idx]
        if not compatible(lv, self.size, self.difficulty):     # defesa final: nunca começa mapa de outra modalidade nem de outra dificuldade
            return f"Esse mapa é para exatamente {lv['players']} jogadores, dificuldade {DIFF_NAMES[lv['diff']]}; a sala é {MODALITY[self.size]}, {DIFF_NAMES[self.difficulty]}."
        if not lv["fixed"] and any(len(x.roles) != 1 for x in ss):
            return "Cada jogador precisa escolher 1 poder."
        if any(not x.ready for x in ss):
            return "Todos precisam estar prontos."
        return None

    def reset_ready(self):
        for x in self.slots:
            if x:
                x.ready = False

    def start_game(self):
        self.phase = "playing"
        self.paused = False
        self.won_at = None
        idx = self.target()
        if idx is None or not compatible(LEVELS[idx], self.size, self.difficulty):      # nunca inicia mapa incompatível, mesmo que alguém tente
            self.phase = "lobby"
            return self.stop_game("Esse mapa não serve para esta modalidade.")
        self.level = idx
        if self.mode == "exp":
            self.exp.cur_defeats = 0
        lv = LEVELS[idx]
        if lv["fixed"]:                     # fases novas: papéis definidos pela fase, por ordem de vaga
            for i, x in enumerate(self.slots[:self.size]):
                x.roles = [ROLE_IDS[i]]
        self.sim = Sim(lv, [s.roles for s in self.slots[:self.size]], limit=self.limit, wait=True, rescue=(self.rule == "rescue"))
        self.load_t0 = time.monotonic()
        for s in self.slots:
            if s:
                s.loaded = False
                s.cmdq.clear(); s.expect = None; s.ack = 0
        self.last_attempt = 0
        for s in self.slots:
            if s:
                s.inp, s.inp_t = (0.0, 0.0), 0.0
                s.rs = False
        self.gid += 1; self.snapn = 0
        self.broadcast(self.level_msg())
        self.push_state()
        if self.task:
            self.task.cancel()
        self.task = asyncio.ensure_future(self.run())

    def level_msg(self, resync=False):
        """Estado COMPLETO e idêntico da fase para todos: mapa, versão, modalidade, dificuldade, número da partida (gid) e quantidade de
        cada tipo de entidade. Não depende de eventos anteriores: serve também para reenviar a quem perdeu algo (resync)."""
        lv = LEVELS[self.level]
        lv_pub = dict(public(lv), time=self.limit)    # o tempo mostrado é o da sala, não o da fase
        return {"t": "level", "level": lv_pub, "n": self.level, "total": len(LEVELS), "roles": [s.roles for s in self.slots[:self.size]], "size": self.size, "limit": self.limit, "rule": self.rule,
                "exp": ({"step": self.exp.step + 1, "total": EXP_STEPS, "id": self.exp.seq["id"], "chapter": self.exp.chap, "title": self.exp.seq["title"], "diff": self.exp.diff} if self.mode == "exp" and self.exp else None),
                "diff": lv["diff"], "difficulty": self.difficulty, "rule": self.rule, "gid": self.gid, "build": BUILD, "mver": map_version(lv), "mid": lv["mid"], "ent": ent_counts(lv), "resync": resync}

    def advance(self):
        """Mapa avulso: depois da vitória segue para o próximo mapa da MESMA modalidade (ou encerra). A expedição usa a tela de resultado."""
        lst = maps_for(self.size, self.difficulty)
        nxt = None
        if self.level in lst:
            k = lst.index(self.level) + 1
            nxt = lst[k] if k < len(lst) else None
        if nxt is not None and compatible(LEVELS[nxt], self.size, self.difficulty):
            self.level = nxt
            self.start_game()
        else:
            self.stop_game(f"Vocês zeraram todos os mapas de {MODALITY[self.size]} ({DIFF_NAMES[self.difficulty]})! 🏆")

    def notice(self, msg):
        self.broadcast({"t": "notice", "msg": msg})

    def new_exp(self):
        self.exp = Exp(self.size, self.limit, self.chapter, self.difficulty, self.rule)

    def begin_transit(self):
        """Venceu uma fase da expedição: contabiliza UMA vez, mostra o resultado e espera todos confirmarem."""
        sim, e = self.sim, self.exp
        e.active += sim.t
        res = {"mid": LEVELS[self.level]["mid"], "time": round(sim.t, 2), "defeats": e.cur_defeats}
        e.per.append(res)
        e.step += 1
        final = e.step >= EXP_STEPS
        self.rid += 1
        self.transit = {"rid": self.rid, "confirmed": set(), "final": final}
        nxt = LEVELS[e.current_map()]["name"] if not final else None
        self.broadcast({"t": "result", "rid": self.rid, "a": sim.attempt, "final": final, "step": e.step, "total": EXP_STEPS, "time": res["time"], "defeats": res["defeats"],
                        "stats": e.stats(), "next": nxt, "limit": self.limit, "modality": MODALITY[self.size], "rule": self.rule, "diff": self.difficulty, "diff_name": DIFF_NAMES[self.difficulty], "chapter": e.chap, "title": e.seq["title"], "seq": e.seq["id"]})
        host = self.slots[self.host]
        if host and host.conn and host.conn.alive:      # o checkpoint é guardado no navegador do anfitrião (somente nas transições)
            host.conn.send({"t": "ckpt", "c": None if final else e.checkpoint(), "mod": self.size, "limit": self.limit, "diff": self.difficulty, "rule": self.rule, "seq": e.seq["id"], "done": final})
        self.push_state()

    def go_next(self):
        """Todos confirmaram: começa a próxima fase (uma única vez)."""
        tr, e = self.transit, self.exp
        if not tr or tr["final"] or not e or e.step >= EXP_STEPS:
            return
        ss = self.slots[:self.size]
        if len(tr["confirmed"]) < self.size or any(x is None or not (x.conn and x.conn.alive) for x in ss):
            return
        self.transit = None        # impede um segundo avanço por cliques repetidos ou mensagens atrasadas
        self.start_game()

    def stop_game(self, why=None):
        self.phase = "lobby"
        self.paused = False
        self.sim = None
        self.transit = None
        self.reset_ready()
        if self.task:
            self.task.cancel()
            self.task = None
        for s in self.slots:
            if s:
                s.inp = (0.0, 0.0)
        self.broadcast({"t": "stopped", "why": why or ""})
        self.push_state()

    def snap(self):
        """Estado autorizado + relógio do servidor: os clientes calculam o tempo restante pelo prazo (en), não por contadores próprios."""
        sim = self.sim
        m = sim.snapshot()
        now = time.monotonic()
        m["st"] = round(now, 3)
        m["ak"] = [(x.ack if x else 0) for x in self.slots[:self.size]]
        m["gd"] = self.gid
        self.snapn += 1
        if self.snapn % 30 == 1:                       # a cada ~1 s: contagem de entidades (cada navegador confere o que tem e o que desenhou)
            m["ent"] = ent_counts(LEVELS[self.level])
        if sim.phase == "play":
            m["en"] = round(now + max(0.0, sim.limit - sim.t), 3)
        if sim.phase == "wait":
            m["ld"] = [1 if (x and x.loaded) else 0 for x in self.slots[:self.size]]
        return m

    def all_loaded(self):
        return all(x and x.loaded for x in self.slots[:self.size])

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
                if sim.attempt != self.last_attempt:        # tentativa nova: comandos antigos não valem
                    self.last_attempt = sim.attempt
                    for s in self.slots:
                        if s:
                            s.cmdq.clear()
                # entradas: cada comando numerado vale exatamente 1/60 s (1 por quadro do servidor); sem comando = parado.
                # Navegadores antigos/robôs ainda podem mandar a direção por estado (expira se parar de renovar).
                for i, s in enumerate(self.slots):
                    if s:
                        if s.mode == "cmd":
                            if s.cmdq and sim.phase == "play":
                                s.ack, c = s.cmdq.popleft()
                                x, y = DIRS[c]
                            else:
                                if sim.phase != "play":
                                    s.cmdq.clear()
                                x, y = 0.0, 0.0
                        else:
                            x, y = s.inp if now - s.inp_t < INPUT_STALE else (0.0, 0.0)
                        sim.set_input(i, x, y)
                        sim.set_rescue(i, bool(s.rs and now - s.rs_t < RS_STALE))
                if sim.phase == "wait":
                    # a fase é preparada em todos os navegadores antes da contagem; nenhum tempo corre enquanto isso
                    if self.all_loaded():
                        sim.begin()
                        self.broadcast(self.snap())
                    elif now - self.load_t0 > LOAD_TIMEOUT:
                        slow = [x.name for x in self.slots[:self.size] if x and not x.loaded]
                        self.stop_game("Não deu para carregar a fase em todos os navegadores (" + ", ".join(slow) + "). Tentem de novo.")
                        return
                    else:
                        n += 1
                        if n % 15 == 0:
                            self.broadcast(self.snap())
                        continue
                before = sim.phase
                if sim.phase == "won":
                    if self.mode == "exp" and self.exp:
                        if self.transit is None and not self.exp_counted:
                            self.exp_counted = True
                            self.begin_transit()
                    else:
                        if self.won_at is None:
                            self.won_at = now
                        elif now - self.won_at >= WIN_HOLD:
                            self.advance()
                            return
                    nxt += 0.09     # parado: 10 quadros por segundo bastam
                else:
                    self.won_at = None
                    self.exp_counted = False
                sim.tick(TICK)
                had_ev = bool(sim.events)
                for ev in sim.events:
                    if ev[0] == "lose" and self.mode == "exp" and self.exp:      # estatística da expedição: só em derrota (transição)
                        self.exp.cur_defeats += 1; self.exp.defeats += 1; self.exp.active += sim.t
                    # cada evento leva o número da tentativa e um contador: quem recebe atrasado/repetido descarta
                    self.evn += 1
                    self.broadcast({"t": "ev", "a": ev[1] if ev[0] == "start" else sim.attempt, "i": self.evn, "g": self.gid, "e": list(ev)})
                sim.events.clear()
                n += 1
                if n % 2 == 0 or sim.phase != before or had_ev:      # evento (placa/porta/chave): quadro na hora, sem esperar o próximo ciclo
                    self.broadcast(self.snap())
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


def now_ok(conn, key, gap):
    """limita a frequência de mensagens auxiliares por conexão"""
    d = conn.__dict__.setdefault("_gaps", {})
    t = time.monotonic()
    if t - d.get(key, 0.0) < gap:
        return False
    d[key] = t
    return True


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
        room.new_exp()
        room.slots[0] = Slot(0, clean_name(m.get("name")), conn)
        room.slots[0].skin = clean_skin(m.get("skin"))
        room.slots[0].build = str(m.get("build"))[:24] if m.get("build") is not None else None
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
            return err(conn, "Essa sala está no meio de uma partida. Entre quando ela voltar para a sala.")
        i = r.free_slot()
        if i is None:
            return err(conn, f"A sala está cheia ({r.size} jogador{'es' if r.size > 1 else ''}).")
        r.slots[i] = Slot(i, clean_name(m.get("name")), conn)
        r.slots[i].skin = clean_skin(m.get("skin"))
        r.slots[i].build = str(m.get("build"))[:24] if m.get("build") is not None else None
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
            conn.send(r.level_msg(resync=True))
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
        if room.phase != "lobby" or (room.target() is not None and LEVELS[room.target()]["fixed"]):
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
        me.ready = False
        room.push_state()
    elif t == "limit":
        if conn.slot != room.host or room.phase != "lobby":
            return
        v = m.get("v")
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if not (isinstance(v, int) and not isinstance(v, bool) and LIMIT_MIN <= v <= LIMIT_MAX):
            return err(conn, f"O tempo precisa ser um número inteiro entre {LIMIT_MIN} e {LIMIT_MAX} segundos.")
        if v != room.limit:
            room.limit = v
            room.reset_ready()
            if room.exp and room.exp.has_progress():
                room.notice("Mudar o tempo recomeça a expedição (resultados de tempos diferentes não se misturam). O checkpoint antigo continua no navegador do anfitrião.")
            room.new_exp()
        room.push_state()
    elif t == "ready":
        if room.phase != "lobby":
            return
        me.ready = bool(m.get("v"))
        room.push_state()
    elif t == "loaded":
        if room.phase == "playing" and room.sim and room.sim.phase == "wait":
            g = m.get("g")
            if g is not None and g != room.gid:
                return                                   # confirmação de uma partida/fase anterior: ignora
            ent = m.get("ent")
            if ent is not None and ent != ent_counts(LEVELS[room.level]):
                # o navegador preparou entidades diferentes das do servidor: reenvia o estado completo; se persistir, não começa
                me.ent_bad += 1
                log("carga com entidades diferentes", me.name, ent)
                if me.ent_bad == 1:
                    conn.send(room.level_msg(resync=True))
                    return
                return room.stop_game(f"O navegador de {me.name} não preparou a fase igual à do servidor. Recarregue a página (⌘⇧R) e tentem de novo.")
            me.loaded = True
    elif t == "resync":
        if room.phase == "playing" and room.sim and conn.slot is not None and now_ok(conn, "resync", 2.0):
            conn.send(room.level_msg(resync=True))
            conn.send(room.snap())
    elif t == "fp":
        f = m.get("f")
        if isinstance(f, str) and now_ok(conn, "fp", 1.0):
            me.fp = f[:240]
            room.broadcast({"t": "fps", "l": [(x.fp if x else None) for x in room.slots[:room.size]], "n": [(x.name if x else None) for x in room.slots[:room.size]]})
    elif t == "mark":
        now = time.monotonic()
        if room.phase != "playing" or not room.sim or now - conn.last_mark < MARK_GAP:
            return
        k = m.get("k")
        try:
            x, y = float(m.get("x", 0)), float(m.get("y", 0))
        except (TypeError, ValueError):
            return
        if not (isinstance(k, int) and not isinstance(k, bool) and 0 <= k < 3 and math.isfinite(x) and math.isfinite(y)):
            return
        conn.last_mark = now
        room.broadcast({"t": "mark", "s": conn.slot, "k": k, "x": round(max(0.0, min(800.0, x)), 1), "y": round(max(0.0, min(500.0, y)), 1)})
    elif t == "size":
        # MODALIDADE: Dupla (2) ou Trio (3). Só o anfitrião, só fora de uma tentativa.
        if conn.slot != room.host or room.phase != "lobby":
            return
        n = m.get("n")
        if not (isinstance(n, int) and not isinstance(n, bool) and n in SIZES):
            return err(conn, "A modalidade é Dupla (2 jogadores) ou Trio (3 jogadores).")
        if n == room.size:
            return
        if any(room.slots[i] for i in range(n, 3)):       # nunca expulsa ninguém em silêncio
            return err(conn, f"Já há {sum(1 for x in room.slots if x)} participantes na sala (contando quem caiu): para virar {MODALITY[n]}, alguém precisa sair antes.")
        room.size = n
        room.reset_ready()
        for x in room.slots:
            if x:
                x.roles = []
        msgs = [f"Modalidade: {MODALITY[n]}."]
        if room.level is not None and not compatible(LEVELS[room.level], n, room.difficulty):
            room.level = None                              # mapa da outra modalidade: limpa a seleção
            msgs.append("O mapa escolhido era da outra modalidade e foi desmarcado.")
        if room.exp and room.exp.has_progress():
            msgs.append("O progresso da expedição anterior não vale nesta modalidade (continua só no checkpoint do navegador do anfitrião).")
        room.new_exp()                                     # expedição sempre da modalidade e do tempo atuais
        room.notice(" ".join(msgs))
        room.push_state()
    elif t == "rule":
        # REGRA (Clássico/Resgate): só o anfitrião, só no lobby; muda a regra, então a expedição recomeça (resultados de regras diferentes não se misturam)
        if conn.slot != room.host or room.phase != "lobby":
            return
        v = m.get("v")
        if v not in RULES:
            return err(conn, "A regra é Clássico ou Resgate.")
        if v == room.rule:
            return
        room.rule = v
        room.reset_ready()
        if room.exp and room.exp.has_progress():
            room.notice("Mudar a regra recomeça a expedição (resultados de regras diferentes não se misturam). O checkpoint antigo continua no navegador do anfitrião.")
        room.new_exp()
        room.notice(f"Regra: {RULE_NAMES[v]}." + (" Quem for atingido fica caído e um amigo pode resgatar (E ou botão Resgatar, 1,5 s)." if v == "rescue" else ""))
        room.push_state()
    elif t == "rs":
        if room.phase != "playing":
            return
        me.rs, me.rs_t = bool(m.get("v")), time.monotonic()
    elif t == "diff":
        # DIFICULDADE (fácil/normal/difícil): independente do tempo; só o anfitrião, só fora de uma tentativa
        if conn.slot != room.host or room.phase != "lobby":
            return
        v = m.get("v")
        if v not in DIFFS:
            return err(conn, "A dificuldade é fácil, normal ou difícil.")
        if v == room.difficulty:
            return
        room.difficulty = v
        room.reset_ready()
        msgs = [f"Dificuldade: {DIFF_NAMES[v]} (o tempo por tentativa continua {room.limit} s)."]
        if room.level is not None:
            nv = variant_of_family(room.level, v)       # a MESMA fase na nova dificuldade, se existir
            if nv is not None and compatible(LEVELS[nv], room.size, v):
                room.level = nv
            else:
                room.level = None
                msgs.append("O mapa escolhido só existe em outra dificuldade e foi desmarcado (os mapas clássicos só existem em Normal).")
        if room.exp and room.exp.has_progress():
            msgs.append("Mudar a dificuldade recomeça a expedição (resultados de dificuldades diferentes não se misturam).")
        room.new_exp()
        room.notice(" ".join(msgs))
        room.push_state()
    elif t == "chapter":
        if conn.slot != room.host or room.phase != "lobby":
            return
        v = m.get("v")
        if v not in (1, 2):
            return
        if v != room.chapter:
            room.chapter = v
            room.reset_ready()
            room.new_exp()
            if room.exp.maps is None:
                room.notice(f"O {room.exp.seq['title']} só existe na dificuldade Normal.")
            room.push_state()
    elif t == "mode":
        if conn.slot != room.host or room.phase != "lobby":
            return
        v = m.get("v")
        if v not in ("free", "exp"):
            return
        room.mode = v
        if v == "exp" and (room.exp is None or room.exp.n != room.size or room.exp.limit != room.limit or room.exp.diff != room.difficulty or room.exp.chap != room.chapter or room.exp.rule != room.rule):
            room.new_exp()
        room.reset_ready()
        room.push_state()
    elif t == "exp":
        if conn.slot != room.host:
            return
        a_ = m.get("a")
        if a_ == "repeat":                                  # depois de terminar: repete a expedição (volta ao lobby, todos ficam prontos de novo)
            if room.phase == "playing" and room.transit and room.transit["final"]:
                room.mode = "exp"; room.new_exp()
                room.stop_game("Nova expedição pronta. Confirmem que estão prontos para começar.")
            return
        if room.phase != "lobby":
            return
        if a_ in ("new", "restart"):
            room.mode = "exp"; room.new_exp(); room.reset_ready()
            room.notice("Expedição recomeçada do início.")
            room.push_state()
        elif a_ == "continue":
            ck = m.get("ck")
            if ck is None:
                if room.exp and room.exp.has_progress() and room.exp.step < EXP_STEPS and room.exp.n == room.size and room.exp.limit == room.limit and room.exp.diff == room.difficulty and room.exp.chap == room.chapter and room.exp.rule == room.rule:
                    room.mode = "exp"; room.reset_ready(); room.push_state()
                    return
                return err(conn, "Não há expedição em andamento nesta sala. Use o checkpoint salvo neste navegador, se houver.")
            x, why = validate_ckpt(ck, room.size, room.limit, room.difficulty, room.chapter, room.rule)
            if x is None:
                return err(conn, why)
            room.exp, room.mode = x, "exp"
            room.reset_ready()
            room.notice(f"Expedição retomada na fase {x.step + 1} de {EXP_STEPS}. O checkpoint pertence à expedição: não comprova que cada pessoa jogou as fases anteriores. A fase pendente começa do início.")
            room.push_state()
    elif t == "cont":
        # "Pronto para continuar" depois de vencer uma fase da expedição: só vale para a tela atual (rid) e conta uma vez por jogador
        tr = room.transit
        rid = m.get("rid")
        if room.phase != "playing" or not tr or rid != tr["rid"] or tr["final"] or conn.slot is None or conn.slot >= room.size:
            return
        if conn.slot not in tr["confirmed"]:
            tr["confirmed"].add(conn.slot)
            room.push_state()
        room.go_next()
    elif t == "cerr":
        if conn.cerr < 3:       # relatório de erro de desenho do navegador de alguém (ajuda a achar bugs)
            conn.cerr += 1
            log("erro no cliente:", str(m.get("m", ""))[:120], "|", str(m.get("ua", ""))[:80])
    elif t == "skin":
        me.skin = clean_skin(m.get("id"))
        room.push_state()
    elif t == "level":
        # identificador: posição histórica (n, 0..), id numérico antigo (1..) ou mid textual; SEMPRE validado pela modalidade da sala
        if conn.slot != room.host or room.phase != "lobby":
            return
        idx = None
        if isinstance(m.get("mid"), str):
            idx = BY_MID.get(m["mid"])
        elif isinstance(m.get("n"), int) and not isinstance(m.get("n"), bool) and 0 <= m["n"] < len(LEVELS):
            idx = m["n"]
        elif isinstance(m.get("id"), int) and not isinstance(m.get("id"), bool) and 1 <= m["id"] <= len(LEVELS):
            idx = m["id"] - 1
        if idx is None:
            return err(conn, "Mapa desconhecido.")
        if LEVELS[idx]["players"] != room.size:
            return err(conn, f"Esse mapa é para exatamente {LEVELS[idx]['players']} jogadores e esta sala é {MODALITY[room.size]}. Escolha um mapa da lista da modalidade.")
        if LEVELS[idx]["diff"] != room.difficulty:         # o servidor escolhe a variante da dificuldade da sala
            nv = variant_of_family(idx, room.difficulty)
            if nv is None:
                return err(conn, f"Esse mapa só existe na dificuldade {DIFF_NAMES[LEVELS[idx]['diff']]}; a sala está em {DIFF_NAMES[room.difficulty]}.")
            idx = nv
        room.level = idx
        room.mode = "free"
        room.reset_ready()
        room.push_state()
    elif t == "start":
        if conn.slot != room.host or room.phase != "lobby":
            return
        why = room.can_start()
        if why:
            return err(conn, why)
        room.start_game()
    elif t == "mv":
        # lote de comandos numerados (1 por 1/60 s): {"s": primeiro número, "d": [códigos 0..8]}
        if room.phase != "playing":
            return
        s0, ds = m.get("s"), m.get("d")
        if not (isinstance(s0, int) and not isinstance(s0, bool) and isinstance(ds, list) and 0 < len(ds) <= 12):
            return
        me.mode = "cmd"
        if me.expect is None or s0 > me.expect:
            me.expect = s0                      # primeiro lote (ou salto): começa daqui
        for k, c in enumerate(ds):
            sq = s0 + k
            if sq < me.expect:
                continue                        # repetido/atrasado: descarta
            if not (isinstance(c, int) and not isinstance(c, bool) and 0 <= c <= 8):
                c = 0
            me.cmdq.append((sq, c))
            me.expect = sq + 1
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
        a = m.get("a")
        # só vale para a tentativa atual (um clique atrasado não reinicia a seguinte) e só com o jogo rodando
        if conn.slot == room.host and room.phase == "playing" and room.sim and room.sim.phase in ("count", "play") and (a is None or a == room.sim.attempt):
            if room.mode == "exp" and room.exp:
                room.exp.active += room.sim.t
            room.sim.reset()
            room.evn += 1
            room.broadcast({"t": "ev", "a": room.sim.attempt, "i": room.evn, "g": room.gid, "e": ["rs", conn.slot]})     # aviso visível para o grupo
            room.broadcast(room.snap())
    elif t == "next":
        if conn.slot == room.host and room.phase == "playing" and room.sim and room.sim.phase == "won" and room.mode == "free":
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
        who = room.slots[idx].name
        room.slots[idx] = None
        if room.phase == "playing":
            room.stop_game(f"{who} saiu da sala. A partida foi encerrada.")
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
            # ninguém vence nem joga com participante ausente: a tentativa é encerrada e o grupo volta ao lobby
            room.stop_game(f"{s.name} desconectou. A partida foi encerrada e o grupo voltou para a sala.")
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
                        room.reset_ready()
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
    conn.send({"t": "hi", "v": 3, "build": BUILD, "levels": catalog(), "roles": ROLES, "seqs": sequences(), "modalities": {str(k): v for k, v in MODALITY.items()}})
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
