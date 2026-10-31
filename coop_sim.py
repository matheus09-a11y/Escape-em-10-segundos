"""Simulação do modo cooperativo (3 jogadores). Roda no servidor: os navegadores só enviam o
comando de direção e desenham o que o servidor mostra. Sem rede aqui dentro: é código puro,
por isso os testes (test_coop.py) usam esta classe direto.

Regras (iguais às da campanha onde existem equivalentes):
  jogador: círculo de raio 11, 260 u/s, anda em micro-passos de no máximo 3 u (nunca atravessa parede);
  espinhos/lasers com a mesma tolerância da campanha (3 e 2 u); serras: contato quando a distância
  é menor que 11 + raio - 3.
Fluxo de uma tentativa: espera (todos carregando) -> contagem (3 s) -> jogo (o tempo corre) -> won | lost.
Perdeu (qualquer perigo, esmagamento ou tempo): a tentativa acaba para TODOS e o servidor reinicia sozinho
depois de LOSE_PAUSE segundos. Vitória: com a chave pega, TODOS os participantes vivos dentro da área de saída
ao mesmo tempo. Ninguém some ao chegar na saída.
"""
import math

from coop_levels import W, H, ROLES

PLAYER_R = 11
SPEED = 260.0
STEP = 3.0
KEY_R = 12
DOOR_HALF = 20
EXIT_HALF = 36          # a saída é uma ÁREA (72x72 u): vale o centro do jogador dentro dela; cabem os 3 sem sobrepor
PLATE_R = 20.0          # distância (centro do jogador até a placa) que conta como "em cima"
SPIKE_INSET = 3
LASER_INSET = 2
SAW_SLACK = 3
COUNTDOWN = 3.0
START_SLOTS = {1: [1], 2: [0, 2], 3: [0, 1, 2]}   # quais pontos de largada cada tamanho de sala usa
LOSE_PAUSE = 2.2
PORTAL_R = 18            # área de ativação do portal (centro do jogador) — igual à campanha (engine.js)
PORTAL_EXIT = PORTAL_R + PLAYER_R   # distância para "sair" da área de chegada e o portal destravar
WARN = 0.5


def circle_rect(cx, cy, r, rc):
    nx = min(max(cx, rc[0]), rc[0] + rc[2])
    ny = min(max(cy, rc[1]), rc[1] + rc[3])
    dx, dy = cx - nx, cy - ny
    return dx * dx + dy * dy < r * r


def laser_state(l, t):
    """0 apagado, 1 aviso, 2 ligado. off=0 significa sempre ligado."""
    cycle = l["on"] + l["off"]
    p = (t + l.get("offset", 0)) % cycle
    if p >= l["off"]:
        return 2
    if p >= l["off"] - WARN:
        return 1
    return 0


_DRONE_CACHE = {}


def _drone_prep(d):
    k = id(d)
    c = _DRONE_CACHE.get(k)
    if c is None:
        pts = [(float(p[0]), float(p[1])) for p in d["route"]]
        cum = [0.0]
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            cum.append(cum[i] + math.hypot(b[0] - a[0], b[1] - a[1]))
        c = _DRONE_CACHE[k] = (pts, cum, cum[-1])
    return c


def drone_pos(d, t):
    """Drone de patrulha (mesma regra da campanha): percorre a rota em laço fechado a `speed` u/s; só depende do tempo da tentativa."""
    pts, cum, per = _drone_prep(d)
    s = ((t * d.get("speed", 100) + d.get("phase", 0) * per) % per + per) % per
    i = 0
    while i < len(pts) - 1 and s >= cum[i + 1]:
        i += 1
    a, b = pts[i], pts[(i + 1) % len(pts)]
    ln = (cum[i + 1] - cum[i]) or 1.0
    k = (s - cum[i]) / ln
    return a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k


def saw_pos(m, t):
    dx, dy = m["x2"] - m["x1"], m["y2"] - m["y1"]
    ln = math.hypot(dx, dy)
    if ln == 0 or not m.get("speed"):
        return m["x1"], m["y1"]
    period = 2 * ln / m["speed"]
    p = (t / period + m.get("phase", 0)) % 1
    d = p * 2 if p < 0.5 else 2 - p * 2
    return m["x1"] + dx * d, m["y1"] + dy * d


class Sim:
    def __init__(self, level, roles, limit=None, wait=False):
        self.lv = level
        # papéis de cada vaga: lista de ids (com menos de 3 jogadores, um jogador acumula papéis)
        self.roles = [[r] if isinstance(r, str) else list(r) for r in roles]
        self.n = len(self.roles)          # 1..3 jogadores
        self.limit = float(limit) if limit else float(level["time"])   # tempo da tentativa (escolhido no lobby)
        self._wait = bool(wait)           # True: só começa a contagem quando o servidor chamar begin()
        self.attempt = 0
        self.inp = [(0.0, 0.0)] * self.n
        self.events = []
        self.reset()

    # ------------------------------------------------------------------
    def reset(self):
        self.attempt += 1
        lv = self.lv
        idx = list(range(self.n)) if len(lv["starts"]) == self.n else START_SLOTS[self.n]     # fases novas trazem uma largada por jogador
        self.pos = [[float(lv["starts"][k][0]), float(lv["starts"][k][1])] for k in idx]
        self.esc = [False] * self.n
        self.lock = [None] * self.n          # portal em que o jogador acabou de chegar: só reativa depois que ele sair da área
        self.has_key = False
        self.latched = [False] * len(lv["plates"])
        self.pressed = [False] * len(lv["plates"])
        self.gate_open = [False] * len(lv["gates"])
        self.t = 0.0
        self.phase = "wait" if self._wait else "count"
        self._wait = False                # depois de uma derrota o reinício vai direto à contagem
        self.count = COUNTDOWN
        self.after = 0.0
        self.result = None
        self._resume_play = False
        self.events.append(("start", self.attempt))

    def begin(self):
        """Todos carregaram: começa a contagem de 3 s (e só depois dela o tempo corre)."""
        if self.phase == "wait":
            self.phase = "count"
            self.count = COUNTDOWN

    def resume_count(self, secs=2.0):
        """Depois de uma reconexão: nada se mexe durante a contagem."""
        if self.phase == "play":
            self.phase = "count"
            self.count = secs
            self._resume_play = True

    def set_input(self, slot, x, y):
        if not (isinstance(slot, int) and 0 <= slot < self.n):
            return
        try:
            x, y = float(x), float(y)
        except (TypeError, ValueError):
            x = y = 0.0
        if not (math.isfinite(x) and math.isfinite(y)):
            x = y = 0.0
        m = math.hypot(x, y)
        if m > 1:
            x, y = x / m, y / m
        self.inp[slot] = (x, y)

    # ------------------------------------------------------------------
    def _closed_gates(self):
        return [g["r"] for i, g in enumerate(self.lv["gates"]) if not self.gate_open[i]]

    def _hits_wall(self, x, y, closed):
        for w in self.lv["walls"]:
            if circle_rect(x, y, PLAYER_R, w):
                return True
        for g in closed:
            if circle_rect(x, y, PLAYER_R, g):
                return True
        return False

    def _move(self, p, dx, dy, closed):
        dist = math.hypot(dx, dy)
        if dist <= 0:
            return
        n = max(1, math.ceil(dist / STEP))
        sx, sy = dx / n, dy / n
        x, y = p
        for _ in range(n):
            if sx:
                nx = min(max(x + sx, PLAYER_R), W - PLAYER_R)
                if not self._hits_wall(nx, y, closed):
                    x = nx
            if sy:
                ny = min(max(y + sy, PLAYER_R), H - PLAYER_R)
                if not self._hits_wall(x, ny, closed):
                    y = ny
        p[0], p[1] = x, y

    def _eject(self, i, gate, closed):
        """A porta fechou em cima do jogador: ele é empurrado para o lado mais próximo (ao longo da espessura)."""
        r = gate["r"]
        p = self.pos[i]
        if r[2] <= r[3]:   # porta numa parede vertical: sai pela esquerda/direita
            first = (r[0] - PLAYER_R - 0.5, p[1]) if p[0] < r[0] + r[2] / 2 else (r[0] + r[2] + PLAYER_R + 0.5, p[1])
            second = (r[0] + r[2] + PLAYER_R + 0.5, p[1]) if first[0] < r[0] else (r[0] - PLAYER_R - 0.5, p[1])
        else:
            first = (p[0], r[1] - PLAYER_R - 0.5) if p[1] < r[1] + r[3] / 2 else (p[0], r[1] + r[3] + PLAYER_R + 0.5)
            second = (p[0], r[1] + r[3] + PLAYER_R + 0.5) if first[1] < r[1] else (p[0], r[1] - PLAYER_R - 0.5)
        for c in (first, second):
            if not self._hits_wall(c[0], c[1], closed):
                p[0], p[1] = c
                return True
        return False

    # ------------------------------------------------------------------
    def tick(self, dt):
        """Avança dt segundos. Eventos ficam em self.events (o servidor esvazia a lista)."""
        if self.phase == "count":
            self.count -= dt
            if self.count <= 0:
                self.count = 0
                self.phase = "play"
                if not getattr(self, "_resume_play", False):
                    self.events.append(("go",))
                self._resume_play = False
            return
        if self.phase == "lost":
            self.after -= dt
            if self.after <= 0:
                self.reset()
            return
        if self.phase != "play":
            return
        lv = self.lv
        self.t += dt
        closed = self._closed_gates()
        # 1) movimento
        for i in range(self.n):
            ux, uy = self.inp[i]
            if ux or uy:
                self._move(self.pos[i], ux * SPEED * dt, uy * SPEED * dt, closed)
        # 1b) portais (iguais aos da campanha): entrar leva ao outro; fica travado até sair da área de chegada
        for i in range(self.n):
            self._portals(i)
        # 2) placas (segurar) e interruptores (ficam ligados); vários jogadores na mesma placa não alternam nada
        for k, pl in enumerate(lv["plates"]):
            on = any(math.hypot(self.pos[i][0] - pl["x"], self.pos[i][1] - pl["y"]) < PLATE_R for i in range(self.n))
            if on != self.pressed[k]:
                self.pressed[k] = on
                self.events.append(("plate", k, on))
            if on and not pl["hold"] and not self.latched[k]:
                self.latched[k] = True
        for gi, g in enumerate(lv["gates"]):
            want = all((lv["plates"][k]["hold"] and self.pressed[k]) or (not lv["plates"][k]["hold"] and self.latched[k]) for k in g["plates"])
            # uma porta nunca fecha em cima de alguém: fica aberta enquanto a passagem estiver ocupada
            if not want and self.gate_open[gi] and any(circle_rect(self.pos[i][0], self.pos[i][1], PLAYER_R, g["r"]) for i in range(self.n)):
                want = True
            if want != self.gate_open[gi]:
                self.gate_open[gi] = want
                self.events.append(("gate", gi, want))
        closed = self._closed_gates()
        for g in lv["gates"]:           # rede de segurança (não deve acontecer): empurra para fora ou perde
            if g["r"] in closed:
                for i in range(self.n):
                    if circle_rect(self.pos[i][0], self.pos[i][1], PLAYER_R, g["r"]):
                        if not self._eject(i, g, closed):
                            return self._lose(i, "crush")
        # 3) chave e área de saída
        d = lv["door"]
        for i in range(self.n):
            px, py = self.pos[i]
            if not self.has_key and (px - lv["key"][0]) ** 2 + (py - lv["key"][1]) ** 2 < (PLAYER_R + KEY_R) ** 2:
                self.has_key = True
                self.events.append(("key", i))
            inside = abs(px - d[0]) <= EXIT_HALF and abs(py - d[1]) <= EXIT_HALF
            if inside != self.esc[i]:
                self.esc[i] = inside
                self.events.append(("esc", i, inside))
        # 4) perigos: qualquer jogador atingido encerra a tentativa de todos
        for i in range(self.n):
            why = self._hazard(i)
            if why:
                return self._lose(i, why)
        # 5) vitória (todos dentro da saída, com a chave) / tempo
        if self.has_key and all(self.esc):
            self.phase = "won"
            self.result = {"time": round(self.t, 2), "attempt": self.attempt}
            self.events.append(("win", self.result))
            return
        if self.t >= self.limit:
            self.t = self.limit
            return self._lose(-1, "time")

    def _portals(self, i):
        pt = self.lv.get("portals")
        if not pt:
            return
        pos = self.pos[i]
        lk = self.lock[i]
        if lk is not None:
            p = pt[lk[0]][lk[1]]
            if math.hypot(pos[0] - p["x"], pos[1] - p["y"]) > PORTAL_EXIT:
                self.lock[i] = lk = None
        for k, pr in enumerate(pt):
            for end, other in (("a", "b"), ("b", "a")):
                if lk is not None and lk == (k, end):
                    continue
                p = pr[end]
                if math.hypot(pos[0] - p["x"], pos[1] - p["y"]) < PORTAL_R:
                    d = pr[other]
                    pos[0], pos[1] = float(d["x"]), float(d["y"])
                    self.lock[i] = (k, other)
                    self.events.append(("tp", i, k))
                    return

    def _hazard(self, i):
        lv = self.lv
        immune = {ROLES[r]["immune"] for r in self.roles[i] if r in ROLES}
        px, py = self.pos[i]
        if "spike" not in immune:
            for s in lv["spikes"]:
                if circle_rect(px, py, PLAYER_R, [s[0] + SPIKE_INSET, s[1] + SPIKE_INSET, s[2] - 2 * SPIKE_INSET, s[3] - 2 * SPIKE_INSET]):
                    return "spike"
        if "laser" not in immune:
            for l in lv["lasers"]:
                if laser_state(l, self.t) == 2:
                    r = l["r"]
                    if circle_rect(px, py, PLAYER_R, [r[0] + LASER_INSET, r[1] + LASER_INSET, r[2] - 2 * LASER_INSET, r[3] - 2 * LASER_INSET]):
                        return "laser"
        for dr in lv.get("drones", ()):      # drones matam qualquer um (nenhum papel é imune)
            dx, dy = drone_pos(dr, self.t)
            rr = PLAYER_R + dr.get("r", 12)
            if (px - dx) ** 2 + (py - dy) ** 2 < rr * rr:
                return "drone"
        if "saw" not in immune:
            for m in lv["saws"]:
                sx, sy = saw_pos(m, self.t)
                rr = PLAYER_R + m["r"] - SAW_SLACK
                if (px - sx) ** 2 + (py - sy) ** 2 < rr * rr:
                    return "saw"
        return None

    def _lose(self, who, why):
        self.phase = "lost"
        self.after = LOSE_PAUSE
        self.result = {"who": who, "why": why}
        self.events.append(("lose", who, why))

    # ------------------------------------------------------------------
    def snapshot(self):
        r = lambda v: round(v, 1)
        return {
            "t": "s", "ph": self.phase, "c": round(self.count, 2), "e": round(self.t, 3), "a": self.attempt,
            "lim": self.limit, "in": sum(1 for x in self.esc if x), "n": self.n,
            "p": [[r(p[0]), r(p[1]), 1 if self.esc[i] else 0] for i, p in enumerate(self.pos)],
            "g": [1 if o else 0 for o in self.gate_open],
            "pl": [1 if (self.pressed[k] or self.latched[k]) else 0 for k in range(len(self.pressed))],
            "k": 1 if self.has_key else 0,
        }
