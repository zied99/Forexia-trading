#!/usr/bin/env python3
"""Tests de l'agent Forexia (bridge/forexia_agent.py) avec un faux MT5 et un faux Supabase.
Lancement : python3 tests/agent-check.py"""
import json
import os
import sys
import tempfile
import threading
import time
import types
from collections import namedtuple
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp()
os.environ["FOREXIA_AGENT_CONFIG"] = os.path.join(TMP, "agent.json")
os.environ["FOREXIA_AGENT_PASSWORD"] = "secret1"

# ---------------------------------------------------------------- faux Supabase
DB = {"users": {}, "machines": {}, "trade_ops": {}, "trade_snaps": {}, "calls": []}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, status, body=None):
        data = b"" if body is None else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null")

    def _user(self):
        tok = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        return tok[4:] if tok.startswith("acc-") else None

    def handle_any(self, method):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        body = self._body() if method in ("POST", "PATCH") else None
        DB["calls"].append((method, u.path, q))
        if u.path.startswith("/auth/v1/"):
            what = u.path[9:]
            if what == "signup":
                if body["email"] in DB["users"]:
                    return self._send(422, {"error_code": "user_already_exists", "msg": "User already registered"})
                DB["users"][body["email"]] = body["password"]
                return self._send(200, {"access_token": "acc-" + body["email"], "refresh_token": "ref-1-" + body["email"], "expires_in": 3600, "user": {"id": "u-" + body["email"]}})
            if q.get("grant_type") == ["password"]:
                if DB["users"].get(body["email"]) != body["password"]:
                    return self._send(400, {"error_code": "invalid_credentials", "msg": "Invalid login credentials"})
                return self._send(200, {"access_token": "acc-" + body["email"], "refresh_token": "ref-1-" + body["email"], "expires_in": 3600, "user": {"id": "u-" + body["email"]}})
            if q.get("grant_type") == ["refresh_token"]:
                _, n, email = body["refresh_token"].split("-", 2)
                return self._send(200, {"access_token": "acc-" + email, "refresh_token": "ref-%d-%s" % (int(n) + 1, email), "expires_in": 3600, "user": {"id": "u-" + email}})
        user = self._user()
        if not user:
            return self._send(401, {"message": "JWT expired"})
        table = u.path.split("/")[-1]
        rows = DB[table]
        if table == "machines":
            mid = (q.get("id") or ["eq."])[0][3:]
            if method == "GET":
                m = rows.get(mid)
                return self._send(200, [m] if m and m["agent"] == "u-" + user else [])
            if method == "POST":
                for r in body:
                    rows[r["id"]] = dict(r, agent="u-" + user, owner=None, info={}, positions=[])
                return self._send(201)
            if method == "PATCH":
                if "owner" in body or "agent" in body:
                    return self._send(403, {"message": "permission denied"})
                if mid in rows:
                    rows[mid].update(body)
                return self._send(204)
        if method == "POST" and table in ("trade_ops", "trade_snaps"):
            assert q.get("on_conflict"), "upsert sans on_conflict"
            for r in body:
                assert rows is not None and r["machine_id"] in DB["machines"]
                key = (r["machine_id"], r["ticket"] if table == "trade_ops" else r["at"])
                rows[key] = r
            return self._send(201)
        return self._send(404, {"message": "?"})

    def do_GET(self):
        self.handle_any("GET")

    def do_POST(self):
        self.handle_any("POST")

    def do_PATCH(self):
        self.handle_any("PATCH")


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["FOREXIA_SUPABASE_URL"] = "http://127.0.0.1:%d" % srv.server_address[1]

# ---------------------------------------------------------------- faux MetaTrader5
OFFSET = 2 * 3600  # serveur du courtier en UTC+2
Acc = namedtuple("Acc", "login server company currency leverage balance equity profit margin margin_free margin_level margin_mode trade_mode trade_allowed trade_expert")
Term = namedtuple("Term", "connected trade_allowed build path")
Tick = namedtuple("Tick", "time bid ask")
Pos = namedtuple("Pos", "ticket magic symbol type volume price_open price_current sl tp profit swap time comment")
Deal = namedtuple("Deal", "ticket order time time_msc type entry magic position_id volume price commission swap profit fee symbol comment")
STATE = {"up": True, "deals": [], "positions": [], "calls": []}
mt5 = types.ModuleType("MetaTrader5")
mt5.initialize = lambda path=None: STATE["up"]
mt5.shutdown = lambda: None
mt5.last_error = lambda: (-10004, "No IPC connection")
mt5.account_info = lambda: Acc(5012345, "Broker-Live", "Broker Ltd", "EUR", 30, 10000.0, 10025.5, 25.5, 300.0, 9725.5, 3341.8, 2, 2, True, True)
mt5.terminal_info = lambda: Term(True, True, 4410, "C:\\MT5")
mt5.symbol_info_tick = lambda s: Tick(int(time.time()) + OFFSET - 2, 1.1, 1.1001) if s == "EURUSD" else None
mt5.positions_get = lambda: STATE["positions"]
mt5.history_deals_get = lambda a, b: (STATE["calls"].append((a, b)), [d for d in STATE["deals"] if a <= d.time <= b])[1]
for forbidden in ("order_send", "order_check", "Buy", "Sell"):
    setattr(mt5, forbidden, lambda *a, **k: (_ for _ in ()).throw(AssertionError("l'agent ne doit passer aucun ordre")))
sys.modules["MetaTrader5"] = mt5

sys.path.insert(0, os.path.join(ROOT, "bridge"))
import forexia_agent as A  # noqa: E402

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("ok  " if cond else "ÉCHEC ") + name + ("" if cond else "  " + str(detail)))
    if not cond:
        fails += 1


now = int(time.time())
STATE["deals"] = [
    Deal(1, 0, now + OFFSET - 86400 * 5, (now + OFFSET - 86400 * 5) * 1000, 2, 0, 0, 0, 0, 0, 0, 0, 10000, 0, "", "Dépôt"),
    Deal(2, 11, now + OFFSET - 7200, (now + OFFSET - 7200) * 1000 + 250, 0, 0, 1001, 50, 0.1, 1.1, -0.7, 0, 0, 0, "EURUSD", "Forexia plan A"),
    Deal(3, 12, now + OFFSET - 3600, (now + OFFSET - 3600) * 1000, 1, 1, 1001, 50, 0.1, 1.102, -0.7, -0.1, 20, 0, "EURUSD", ""),
]
STATE["positions"] = [Pos(60, 1002, "GBPUSD", 1, 0.2, 1.27, 1.268, 0, 1.26, 25.5, 0, now + OFFSET - 600, "")]

# 1. configuration : création du compte de l'agent et de la machine
args = A.argparse.Namespace(login="agent-test", name="PC test", terminal=None, depuis=30)
cfg = {}
cloud = A.setup(args, cfg)
check("compte de l'agent créé", "agent-test@forexia.app" in DB["users"])
check("machine enregistrée avec un code", cfg.get("machine_id") in DB["machines"] and len(DB["machines"][cfg["machine_id"]]["pair_code"]) == 9)
saved = json.load(open(os.environ["FOREXIA_AGENT_CONFIG"]))
check("mot de passe absent du fichier local", "secret1" not in json.dumps(saved) and saved.get("refresh_token"))

# 2. un relevé
agent = A.Agent(cfg, A.Cloud(cfg), A.Reader(mt5), 30)
ok = agent.cycle()
m = DB["machines"][cfg["machine_id"]]
check("relevé réussi", ok, agent.last_err)
check("décalage du serveur détecté (UTC+2)", m["info"].get("serverOffsetH") == 2, m["info"].get("serverOffsetH"))
check("état du compte envoyé", m["info"].get("login") == 5012345 and m["info"].get("marginMode") == "hedging" and m["info"].get("readOnly") is True, m["info"])
check("positions envoyées", len(m["positions"]) == 1 and m["positions"][0]["magic"] == 1002)
check("3 opérations envoyées", len(DB["trade_ops"]) == 3, DB["trade_ops"].keys())
op2 = DB["trade_ops"][(cfg["machine_id"], 2)]
expect = A.iso((now - 7200) + 0.25)
check("heure des opérations ramenée en UTC", op2["at"] == expect, (op2["at"], expect))
check("opération : magique, type, entrée", op2["magic"] == 1001 and op2["kind"] == "achat" and op2["entry"] == "in")
check("dépôt classé « solde »", DB["trade_ops"][(cfg["machine_id"], 1)]["kind"] == "solde")
check("photo du compte", len(DB["trade_snaps"]) == 1 and list(DB["trade_snaps"].values())[0]["data"]["byMagic"]["1002"]["positions"] == 1)
check("historique demandé sur la période --depuis", STATE["calls"][0][0] <= now - 30 * 86400)

# 3. deuxième relevé : rien de neuf, rien de renvoyé ; puis une nouvelle opération
before = sum(1 for c in DB["calls"] if c[1].endswith("trade_ops"))
agent.cycle()
check("pas de renvoi des opérations connues", sum(1 for c in DB["calls"] if c[1].endswith("trade_ops")) == before)
STATE["deals"].append(Deal(4, 13, now + OFFSET - 60, (now + OFFSET - 60) * 1000, 0, 0, 1001, 51, 0.1, 1.1, -0.7, 0, 0, 0, "EURUSD", ""))
agent.cycle()
check("nouvelle opération envoyée", (cfg["machine_id"], 4) in DB["trade_ops"])
check("relevés suivants : fenêtre courte", STATE["calls"][-1][0] >= now - 4 * 86400 - 10)

# 4. MT5 fermé : l'agent le signale sans planter
STATE["up"] = False
agent.reader.close()
ok = agent.cycle()
check("MT5 injoignable signalé", not ok and m["info"].get("mt5") is False and "MetaTrader" in m["info"].get("error", ""), m["info"])
STATE["up"] = True
check("reprise quand MT5 revient", agent.cycle() and m["info"].get("mt5") is True)

# 5. redémarrage de l'agent : le jeton est renouvelé et sauvegardé
cfg2 = A.load_config()
c2 = A.Cloud(cfg2)
c2.token()
check("jeton renouvelé et sauvegardé", A.load_config()["refresh_token"] != saved["refresh_token"])

# 6. relance de --setup : même machine, pas de doublon
A.setup(args, cfg2)
check("--setup relancé : pas de nouvelle machine", len(DB["machines"]) == 1)

print("\n%s" % ("Tous les tests de l'agent passent." if not fails else "%d échec(s)." % fails))
srv.shutdown()
sys.exit(1 if fails else 0)
