#!/usr/bin/env python3
"""Proxy TCP que acrescenta latência (e variação) em CADA sentido, para medir o jogo com rede ruim.
Uso: python3 tools/latproxy.py PORTA_LOCAL PORTA_SERVIDOR ATRASO_MS [VARIACAO_MS]"""
import asyncio, random, sys, time

async def pipe(r, w, base, jit):
    q = asyncio.Queue()
    async def sender():
        while True:
            at, data = await q.get()
            d = at - time.monotonic()
            if d > 0: await asyncio.sleep(d)
            w.write(data); await w.drain()
    task = asyncio.ensure_future(sender()); last = 0
    try:
        while True:
            data = await r.read(65536)
            if not data: break
            at = max(last, time.monotonic() + base + random.uniform(0, jit)); last = at   # mantém a ordem
            q.put_nowait((at, data))
    except Exception: pass
    await asyncio.sleep(base + jit + 0.05); task.cancel()
    try: w.close()
    except Exception: pass

async def main(lp, sp, base, jit):
    async def handle(cr, cw):
        sr, sw = await asyncio.open_connection("127.0.0.1", sp)
        await asyncio.gather(pipe(cr, sw, base, jit), pipe(sr, cw, base, jit))
    srv = await asyncio.start_server(handle, "127.0.0.1", lp)
    async with srv: await srv.serve_forever()

if __name__ == "__main__":
    lp, sp, ms = int(sys.argv[1]), int(sys.argv[2]), float(sys.argv[3])
    jit = float(sys.argv[4]) if len(sys.argv) > 4 else 0
    asyncio.run(main(lp, sp, ms / 1000, jit / 1000))
