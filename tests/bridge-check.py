"""Test de la passerelle Forexia avec un faux MetaTrader 5 (faux MetaEditor et faux terminal).

Usage : python3 tests/bridge-check.py      (Linux / macOS ; sous Windows, testez avec le vrai MT5)
"""
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE = os.path.join(ROOT, "bridge", "forexia_bridge.py")
ORIGIN = "https://zied99.github.io"

FAKE_METAEDITOR = r'''#!/usr/bin/env python3
import sys, os
args = dict(a[1:].split(":", 1) for a in sys.argv[1:])
src, log = args["compile"], args["log"]
code = open(src, encoding="utf-8-sig").read()
assert os.path.isdir(args["inc"]), "dossier d'include absent"
if "FX_FAKE_ERROR" in code:
    text = src + "(12,5) : error 256: 'FX_FAKE_ERROR' - undeclared identifier\nResult: 1 errors, 0 warnings, 120 msec elapsed\n"
else:
    open(src[:-4] + ".ex5", "wb").write(b"EX5")
    text = src + " : information: compiling\nResult: 0 errors, 0 warnings, 845 msec elapsed\n"
open(log, "wb").write(b"\xff\xfe" + text.replace("\n", "\r\n").encode("utf-16-le"))
'''

FAKE_TERMINAL = r'''#!/usr/bin/env python3
import sys, os, json
cfg = sys.argv[1].split(":", 1)[1]
raw = open(cfg, "rb").read()
assert raw.startswith(b"\xff\xfe"), "ini sans BOM UTF-16"
ini = raw[2:].decode("utf-16-le")
vals = dict(l.split("=", 1) for l in ini.splitlines() if "=" in l)
common = os.environ["FAKE_COMMON"]
if "[Tester]" in ini:
    name = vals["Expert"].split("\\")[-1][:-4]
    os.makedirs(os.path.join(common, "Forexia"), exist_ok=True)
    json.dump({"deposit": float(vals["Deposit"]), "profit": 42.5, "trades": 7, "profitTrades": 3, "profitFactor": 1.3,
               "maxDrawdownPct": 12.0, "sharpe": 0.5, "symbol": vals["Symbol"], "period": "PERIOD_" + vals["Period"],
               "ini": vals, "deals": []}, open(os.path.join(common, "Forexia", name + ".json"), "w"))
elif vals.get("Script") == "Forexia\\ForexiaCalendar":
    assert vals.get("ShutdownTerminal") == "1"
    os.makedirs(os.path.join(common, "Forexia"), exist_ok=True)
    rows = ["time;currency;importance;event", "1717763400;USD;3;Nonfarm Payrolls", "1717680600;EUR;3;ECB Interest Rate Decision",
            "1717750000;JPY;2;Household Spending", "1717600000;GBP;2;Construction PMI"]
    open(os.path.join(common, "Forexia", "calendar.csv"), "w", encoding="latin-1").write("\r\n".join(rows) + "\r\n")
    open(os.path.join(common, "Forexia", "calendar.done"), "w").write("4;4")
else:
    open(os.path.join(os.path.dirname(cfg), "startup_seen.txt"), "w").write(json.dumps(vals))
'''


FAKE_MT5 = r'''
from types import SimpleNamespace as NS
TIMEFRAME_D1, TIMEFRAME_H1, TIMEFRAME_M15, TIMEFRAME_M5, TIMEFRAME_M1, TIMEFRAME_H4, TIMEFRAME_M30, TIMEFRAME_W1, TIMEFRAME_MN1 = 1440, 60, 15, 5, 1, 240, 30, 10080, 43200
STATE = {"init": 0}
def initialize(path=None): STATE["init"] += 1; return True
def shutdown(): STATE["init"] -= 1
def last_error(): return (0, "ok")
def symbol_select(s, on): return s in ("GBPUSD", "EURUSD")
def symbols_get(pattern): return [NS(name="GBPUSD.m")]
def symbol_info(s): return NS(digits=5, point=0.00001, trade_contract_size=100000, volume_min=0.01, volume_max=100, volume_step=0.01,
    swap_mode=1, swap_long=-7.5, swap_short=1.2, swap_rollover3days=3, currency_base="GBP", currency_profit="USD", trade_stops_level=0, spread=12)
def account_info(): return NS(currency="EUR", leverage=100, server="MetaQuotes-Demo", company="MetaQuotes", trade_mode=0, margin_so_so=50.0)
def copy_rates_range(s, tf, a, b):
    t0, t1, step = int(a.timestamp()), int(b.timestamp()), tf * 60
    out, p = [], 1.25 if s == "GBPUSD" else 1.10
    for t in range(t0, t1, step):
        out.append({"time": t, "open": p, "high": p + 0.002, "low": p - 0.002, "close": p + 0.0005, "spread": 14})
        p += 0.0005
    return out
'''


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def main():
    tmp = tempfile.mkdtemp(prefix="fxbridge-")
    appdata = os.path.join(tmp, "appdata")
    install = os.path.join(tmp, "Program Files", "MetaTrader 5")
    data = os.path.join(appdata, "MetaQuotes", "Terminal", "D0E8209F77C8CF37AD8BF550E51FF075")
    common = os.path.join(appdata, "MetaQuotes", "Terminal", "Common", "Files")
    os.makedirs(os.path.join(data, "MQL5", "Experts"))
    os.makedirs(install)
    with open(os.path.join(data, "origin.txt"), "wb") as f:
        f.write(b"\xff\xfe" + install.encode("utf-16-le"))
    for name, body in (("metaeditor64.exe", FAKE_METAEDITOR), ("terminal64.exe", FAKE_TERMINAL)):
        p = os.path.join(install, name)
        open(p, "w").write(body)
        os.chmod(p, os.stat(p).st_mode | stat.S_IEXEC)

    port = free_port()
    env = dict(os.environ, APPDATA=appdata, FAKE_COMMON=common)
    fake_mt5 = os.path.join(tmp, "fake_mt5.py")
    open(fake_mt5, "w").write(FAKE_MT5)
    proc = subprocess.Popen([sys.executable, BRIDGE, "--port", str(port), "--fake-mt5", fake_mt5], env=env, stdout=subprocess.PIPE, text=True)
    lines = []
    while len(lines) < 3:
        lines.append(proc.stdout.readline())
    token = lines[1].split(":", 1)[1].split()[0]
    base = "http://127.0.0.1:%d" % port
    failed = 0

    def call(method, path, body=None, token_=token, origin=ORIGIN):
        req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
        req.add_header("Content-Type", "application/json")
        if origin:
            req.add_header("Origin", origin)
        if token_:
            req.add_header("X-Forexia-Token", token_)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read() or b"{}"), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), e.headers

    def check(label, cond, detail=""):
        nonlocal failed
        print(("  ok  " if cond else "  ÉCHEC ") + label + ("" if cond else "  →  " + str(detail)))
        failed += 0 if cond else 1

    print("Passerelle Forexia (faux MetaTrader 5)")
    st, js, _ = call("GET", "/ping", token_=None)
    check("ping sans code", st == 200 and js.get("app") == "forexia-bridge", js)
    st, js, _ = call("GET", "/status", token_="XXXX-XXXX")
    check("mauvais code refusé (401)", st == 401, st)
    st, js, _ = call("GET", "/status", origin="https://site-malveillant.example")
    check("autre site refusé (403)", st == 403, st)
    st, _, h = call("OPTIONS", "/deploy", token_=None)
    check("pré-vérification CORS / réseau local", st == 204 and h.get("Access-Control-Allow-Origin") == ORIGIN
          and h.get("Access-Control-Allow-Private-Network") == "true", dict(h))
    st, js, _ = call("GET", "/status")
    t = js.get("terminals", [{}])[0]
    check("terminal MT5 trouvé via origin.txt", st == 200 and t.get("metaeditor") and t.get("terminal") and t.get("installDir") == install, js)
    tid = t.get("id")

    st, js, _ = call("POST", "/deploy", {"terminalId": tid, "fileName": "..\\..\\evil.mq5", "code": "x"})
    check("nom de fichier dangereux refusé", js.get("ok") is False, js)
    code = "﻿// EA de test\nvoid OnTick() {}\n"
    st, js, _ = call("POST", "/deploy", {"terminalId": tid, "fileName": "Forexia_Test.mq5", "code": code})
    src = os.path.join(data, "MQL5", "Experts", "Forexia", "Forexia_Test.mq5")
    check("déploiement + compilation", js.get("compiled") is True and os.path.exists(src) and not js.get("errors"), js)
    check("fichier écrit en UTF-8 avec BOM et CRLF", open(src, "rb").read().startswith(b"\xef\xbb\xbf") and b"\r\n" in open(src, "rb").read())
    st, js, _ = call("POST", "/deploy", {"terminalId": tid, "fileName": "Forexia_Err.mq5", "code": "int x = FX_FAKE_ERROR;"})
    check("erreur de compilation remontée", js.get("compiled") is False and js.get("errors") and "undeclared" in js["errors"][0], js)

    flag = os.path.join(data, "Forexia", "RUNNING")
    os.makedirs(os.path.dirname(flag), exist_ok=True)
    open(flag, "w").close()
    test_body = {"terminalId": tid, "fileName": "Forexia_Test.mq5", "symbol": "GBPUSD", "period": "D1",
                 "from": "2024-11-15", "to": "2026-11-14", "deposit": 100, "currency": "EUR", "leverage": 100, "model": 1}
    st, js, _ = call("POST", "/test", test_body)
    check("MT5 ouvert : demande de fermeture", js.get("needClose") is True, js)
    st, js, _ = call("POST", "/test", dict(test_body, closeTerminal=True))
    ini = (js.get("result") or {}).get("ini", {})
    check("test MT5 lancé et résultat renvoyé", js.get("ok") and js["result"]["trades"] == 7 and js["result"]["deposit"] == 100, js)
    check("configuration du testeur correcte", ini.get("Expert") == "Forexia\\Forexia_Test.ex5" and ini.get("FromDate") == "2024.11.15"
          and ini.get("Leverage") == "1:100" and ini.get("Model") == "1" and ini.get("ShutdownTerminal") == "1", ini)
    st, js, _ = call("POST", "/test", dict(test_body, symbol="GBP USD;del"))
    check("symbole invalide refusé", js.get("ok") is False, js)

    st, js, _ = call("POST", "/attach", {"terminalId": tid, "fileName": "Forexia_Test.mq5", "symbol": "GBPUSD", "period": "D1"})
    seen = os.path.join(data, "Forexia", "startup_seen.txt")
    for _ in range(50):
        if os.path.exists(seen):
            break
        time.sleep(0.1)
    vals = json.load(open(seen)) if os.path.exists(seen) else {}
    check("EA ouvert sur un graphique", js.get("ok") and vals.get("Expert") == "Forexia\\Forexia_Test" and vals.get("Symbol") == "GBPUSD", (js, vals))

    st, js, _ = call("POST", "/bars", {"terminalId": tid, "symbol": "GBPUSD", "timeframe": "D1", "from": "2023-01-01", "to": "2024-12-31", "testFrom": "2024-01-01"})
    check("bougies du courtier (D1) + bougies fines M1 en colonnes", js.get("ok") and len(js["bars"]) == 730 and js["subTimeframe"] == "M1"
          and len(js["sub"]["t"]) == 365 * 1440 and len(js["sub"]["spread"]) == 365 * 1440 and js["bars"][0][5] == 14, {k: (v if not isinstance(v, list) else len(v)) for k, v in js.items()})
    check("caractéristiques du symbole et du compte", js.get("spec", {}).get("contract") == 100000 and js["spec"]["swapLong"] == -7.5
          and js["account"]["currency"] == "EUR" and js["account"]["leverage"] == 100, js.get("spec"))
    check("conversion USD -> EUR via EURUSD", (js.get("conv") or {}).get("symbol") == "EURUSD" and js["conv"]["divide"] is True and len(js["conv"]["rates"]) == 730, js.get("conv", {}).get("symbol"))
    st, js, _ = call("POST", "/bars", {"terminalId": tid, "symbol": "XAUUSD", "timeframe": "D1", "from": "2023-01-01", "to": "2024-12-31"})
    check("symbole absent : symboles proches proposés", js.get("ok") is False and "GBPUSD.m" in js.get("message", ""), js)

    st, js, _ = call("GET", "/calendar?from=0&to=9999999999")
    check("calendrier pas encore exporté", js.get("ok") is False and js.get("missing") is True, js)
    open(flag, "w").close()
    st, js, _ = call("POST", "/calendar/export", {"terminalId": tid})
    check("export du calendrier : MT5 ouvert, demande de fermeture", js.get("needClose") is True, js)
    st, js, _ = call("POST", "/calendar/export", {"terminalId": tid, "closeTerminal": True})
    script = os.path.join(data, "MQL5", "Scripts", "Forexia", "ForexiaCalendar.mq5")
    check("script MQL5 du calendrier compilé et lancé", js.get("ok") and js.get("count") == 4 and os.path.exists(script[:-4] + ".ex5")
          and "CalendarValueHistory" in open(script, encoding="utf-8-sig").read(), js)
    st, js, _ = call("GET", "/calendar?from=1717650000&to=1717800000")
    check("annonces filtrées par dates", js.get("ok") and sorted(e["currency"] for e in js["events"]) == ["EUR", "JPY", "USD"]
          and all(set(e) == {"t", "currency", "importance"} for e in js["events"]), js)
    st, js, _ = call("GET", "/calendar", token_="XXXX-XXXX")
    check("calendrier : code requis", st == 401, st)

    st, js, _ = call("POST", "/experts", {"terminalId": tid})
    names = [x["fileName"] for x in js.get("experts", [])]
    check("liste des EA installés", js.get("ok") and "Forexia_Test.mq5" in names and all("code" not in x for x in js["experts"]), js)
    st, js, _ = call("POST", "/experts", {"terminalId": tid, "fileName": "Forexia_Test.mq5"})
    one = [x for x in js.get("experts", []) if x["fileName"] == "Forexia_Test.mq5"]
    check("lecture du code d'un EA installé", one and "void OnTick()" in one[0].get("code", ""), js)

    # --- base de données
    st, js, _ = call("POST", "/db/info", {}, token_="XXXX-XXXX")
    check("base : code requis", st == 401, st)
    st, js, _ = call("POST", "/db/info", {})
    check("base créée dans %APPDATA%\\Forexia", js.get("ok") and js["path"].endswith(os.path.join("Forexia", "forexia.db")) and os.path.exists(js["path"]), js)
    check("journal automatique des opérations MT5", js["counts"]["events"] >= 4, js.get("counts"))
    strat = {"name": "Zied3 EURUSD", "longEntry": "RSI(14) < 30", "stopLossPips": 50}
    call("POST", "/db/strategies/put", {"name": "Zied3 EURUSD", "data": strat})
    call("POST", "/db/strategies/put", {"name": "Zied3 EURUSD", "data": dict(strat, stopLossPips=60)})
    st, js, _ = call("POST", "/db/strategies/list", {})
    check("stratégie enregistrée puis mise à jour (une seule ligne)", len(js["items"]) == 1 and js["items"][0]["data"]["stopLossPips"] == 60, js)
    sims = [{"key": "2026-11-15T10:00:00Z|A", "at": "2026-11-15T10:00:00Z", "name": "A", "pair": "EUR/USD", "returnPct": 5.5, "trades": 1, "tradeList": [{"pnl": 1}]},
            {"key": "2026-11-15T11:00:00Z|B", "at": "2026-11-15T11:00:00Z", "name": "B", "pair": "GBP/USD", "returnPct": -2}]
    call("POST", "/db/simulations/put", {"items": sims})
    call("POST", "/db/simulations/put", sims[0])  # doublon : remplacé, pas ajouté
    st, js, _ = call("POST", "/db/simulations/list", {})
    check("simulations : ajout par lot, sans doublon, ordre chronologique", [x["name"] for x in js["items"]] == ["A", "B"] and js["items"][0]["tradeList"][0]["pnl"] == 1, js)
    call("POST", "/db/simulations/delete", {"key": sims[1]["key"]})
    call("POST", "/db/events/put", {"type": "strategy.saved", "summary": "Stratégie enregistrée : Zied3 EURUSD", "data": {"name": "Zied3 EURUSD"}})
    st, js, _ = call("POST", "/db/events/list", {"limit": 50})
    types = [x["type"] for x in js["items"]]
    check("journal : événements de la page et de la passerelle", types[0] == "strategy.saved" and "mt5.compile" in types and "mt5.test" in types and "mt5.attach" in types, types)
    st, js, _ = call("POST", "/db/export", {})
    check("export complet", js.get("ok") and len(js["strategies"]) == 1 and len(js["simulations"]) == 1 and len(js["events"]) >= 5, {k: len(v) if isinstance(v, list) else v for k, v in js.items()})
    st, js, _ = call("POST", "/db/strategies/put", {"name": "", "data": {}})
    check("nom vide refusé", js.get("ok") is False, js)
    call("POST", "/db/strategies/delete", {"name": "Zied3 EURUSD"})
    st, js, _ = call("POST", "/db/simulations/clear", {})
    st, js, _ = call("POST", "/db/info", {})
    check("suppression et effacement", js["counts"]["strategies"] == 0 and js["counts"]["simulations"] == 0, js["counts"])

    proc.terminate()
    print("\n%d échec(s)" % failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
