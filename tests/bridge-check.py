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
else:
    open(os.path.join(os.path.dirname(cfg), "startup_seen.txt"), "w").write(json.dumps(vals))
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
    proc = subprocess.Popen([sys.executable, BRIDGE, "--port", str(port)], env=env, stdout=subprocess.PIPE, text=True)
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

    proc.terminate()
    print("\n%d échec(s)" % failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
