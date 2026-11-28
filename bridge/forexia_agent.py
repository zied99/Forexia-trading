#!/usr/bin/env python3
"""Agent Forexia : relie le MetaTrader 5 de ce PC à la page admin et à la page client.

Étape 1 (observation) : l'agent LIT seulement. Il ne passe, ne modifie et ne ferme aucun ordre.
Toutes les 30 secondes il envoie au compte en ligne Forexia (Supabase) :
  - l'état du compte MT5 (solde, valeur, marge, niveau de marge, mode hedging/netting, trading algo autorisé…) ;
  - les positions ouvertes ;
  - chaque opération de l'historique (ticket, numéro magique, symbole, volume, prix, résultat, swap, commission).
Toutes les 15 minutes, une photo du compte (valeur totale et résultat latent par numéro magique).

Le PC n'ouvre aucun port : c'est l'agent qui va vers Supabase. Il a son propre compte Supabase (pas le vôtre) :
il ne voit que sa machine. La machine apparaît dans la page admin une fois son code d'appairage saisi.

Première fois :  python forexia_agent.py --setup
Ensuite :        python forexia_agent.py            (ou demarrer-agent.bat)
Démarrage avec Windows : python forexia_agent.py --demarrage-auto
Module nécessaire : MetaTrader5  (pip install MetaTrader5)
"""
import argparse
import datetime as dt
import getpass
import json
import os
import re
import secrets
import socket
import sys
import time
import urllib.error
import urllib.request

VERSION = "1.0"
SUPABASE_URL = os.environ.get("FOREXIA_SUPABASE_URL", "https://bzrvzulyxkmozvxaedek.supabase.co")
SUPABASE_KEY = os.environ.get("FOREXIA_SUPABASE_KEY", "sb_publishable_69_wCXvwU1cVFerYyS-s0A_CDQ2Yt9C")  # clé publique
LOGIN_DOMAIN = "forexia.app"
LOCK_PORT = 8786
SNAP_MINUTES = 15
ADMIN_URL = "https://zied99.github.io/Forexia-trading/admin.html"

DEAL_KINDS = {0: "achat", 1: "vente", 2: "solde", 3: "crédit", 4: "frais", 5: "correction", 6: "bonus", 7: "commission",
              8: "commission jour", 9: "commission mois", 10: "commission agent jour", 11: "commission agent mois",
              12: "intérêts", 13: "achat annulé", 14: "vente annulée", 15: "dividende", 16: "dividende", 17: "taxe"}
DEAL_ENTRIES = {0: "in", 1: "out", 2: "inout", 3: "out_by"}
MARGIN_MODES = {0: "netting", 1: "bourse", 2: "hedging"}
TRADE_MODES = {0: "démo", 1: "concours", 2: "réel"}


class AgentError(Exception):
    def __init__(self, message, code=None):
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------- fichiers locaux
def appdata():
    return os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")


def config_path():
    return os.environ.get("FOREXIA_AGENT_CONFIG") or os.path.join(appdata(), "Forexia", "agent.json")


def load_config():
    try:
        with open(config_path(), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_config(cfg):
    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    os.replace(tmp, path)


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    print(line, flush=True)
    try:
        path = os.path.join(os.path.dirname(config_path()), "agent.log")
        if os.path.exists(path) and os.path.getsize(path) > 2_000_000:
            os.replace(path, path + ".1")
        with open(path, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def login_to_email(login):
    lg = str(login or "").strip().lower()
    if "@" in lg:
        return lg
    if not re.match(r"^[a-z0-9._-]{2,40}$", lg):
        raise AgentError("Identifiant : lettres, chiffres, point, tiret (2 à 40 caractères).")
    return lg + "@" + LOGIN_DOMAIN


def iso(ts):
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def utc_now_iso():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ---------------------------------------------------------------- Supabase
class Cloud:
    def __init__(self, cfg):
        self.cfg = cfg
        self.access = None
        self.expires = 0

    def _http(self, method, url, body=None, headers=None, timeout=30):
        h = {"apikey": SUPABASE_KEY, "Content-Type": "application/json"}
        h.update(headers or {})
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                text = r.read().decode("utf-8")
                return r.status, (json.loads(text) if text else None)
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            try:
                payload = json.loads(text) if text else {}
            except ValueError:
                payload = {"message": text[:300]}
            return e.code, payload
        except (urllib.error.URLError, socket.timeout, ConnectionError) as e:
            raise AgentError("Supabase injoignable (%s)." % getattr(e, "reason", e))

    def _auth(self, path, body, token=None):
        headers = {"Authorization": "Bearer " + token} if token else {}
        status, data = self._http("POST", SUPABASE_URL + "/auth/v1/" + path, body, headers)
        if status >= 400:
            data = data or {}
            msg = data.get("msg") or data.get("message") or data.get("error_description") or data.get("error") or ("erreur %s" % status)
            raise AgentError(msg, data.get("error_code") or data.get("code") or status)
        return data

    def _keep(self, data):
        self.access = data["access_token"]
        self.expires = time.time() + int(data.get("expires_in") or 3600)
        self.cfg["refresh_token"] = data["refresh_token"]  # le jeton change à chaque fois
        self.cfg["agent_user"] = (data.get("user") or {}).get("id") or self.cfg.get("agent_user")
        save_config(self.cfg)

    def sign_in(self, login, password):
        self._keep(self._auth("token?grant_type=password", {"email": login_to_email(login), "password": password}))

    def sign_up(self, login, password):
        data = self._auth("signup", {"email": login_to_email(login), "password": password})
        if not data.get("access_token"):
            raise AgentError("Compte créé mais Supabase attend une confirmation par e-mail : désactivez « Confirm email » "
                             "(Authentication → Sign In / Providers → Email) puis relancez --setup.")
        self._keep(data)

    def token(self):
        if self.access and self.expires - 120 > time.time():
            return self.access
        if not self.cfg.get("refresh_token"):
            raise AgentError("Agent non configuré : lancez  python forexia_agent.py --setup")
        try:
            self._keep(self._auth("token?grant_type=refresh_token", {"refresh_token": self.cfg["refresh_token"]}))
        except AgentError as e:
            if "injoignable" in str(e):
                raise
            raise AgentError("Connexion de l'agent refusée (%s) : relancez  python forexia_agent.py --setup" % e)
        return self.access

    def rest(self, method, path, body=None, prefer=None):
        headers = {"Authorization": "Bearer " + self.token()}
        if prefer:
            headers["Prefer"] = prefer
        status, data = self._http(method, SUPABASE_URL + "/rest/v1/" + path, body, headers)
        if status == 401:
            self.access = None
            headers["Authorization"] = "Bearer " + self.token()
            status, data = self._http(method, SUPABASE_URL + "/rest/v1/" + path, body, headers)
        if status >= 400:
            msg = (data or {}).get("message") or ("erreur %s" % status)
            if (data or {}).get("code") in ("PGRST205", "42P01") or "does not exist" in msg or "could not find the table" in msg.lower():
                msg = "tables absentes : exécutez supabase/schema.sql dans Supabase (SQL Editor)"
            raise AgentError("Supabase : " + msg)
        return data


# ---------------------------------------------------------------- MT5 (lecture seule)
def mt5_module():
    try:
        import MetaTrader5 as mt5  # noqa: N813
        return mt5
    except ImportError:
        raise AgentError("Module MetaTrader5 absent : pip install MetaTrader5  (ou lancez demarrer-agent.bat)")


def nt(x):
    """Objet MT5 (namedtuple) -> dict."""
    return x._asdict() if hasattr(x, "_asdict") else dict(x)


class Reader:
    def __init__(self, mt5, terminal=None):
        self.mt5 = mt5
        self.terminal = terminal
        self.ready = False

    def connect(self):
        if self.ready:
            return True
        ok = self.mt5.initialize(path=self.terminal) if self.terminal else self.mt5.initialize()
        if not ok:
            raise AgentError("MetaTrader 5 injoignable (%s) : MT5 est-il ouvert et connecté au compte ?" % (self.mt5.last_error(),))
        self.ready = True
        return True

    def close(self):
        if self.ready:
            try:
                self.mt5.shutdown()
            except Exception:  # noqa: BLE001
                pass
        self.ready = False

    def server_offset(self, symbols):
        """Décalage (heures) entre l'heure du serveur du courtier et UTC, d'après un prix reçu à l'instant."""
        now = time.time()
        best = None
        for s in symbols:
            t = self.mt5.symbol_info_tick(s)
            if t and t.time and (best is None or t.time > best):
                best = t.time
        if best is None:
            return None
        diff = best - now
        half_hours = round(diff / 1800.0)
        # le dernier prix doit dater de moins de 90 s (marché ouvert), sinon on ne peut pas conclure
        if abs(diff - half_hours * 1800) > 90 or abs(half_hours) > 28:
            return None
        return half_hours / 2.0

    def account(self):
        a = self.mt5.account_info()
        t = self.mt5.terminal_info()
        if a is None:
            raise AgentError("MT5 n'est connecté à aucun compte (%s)." % (self.mt5.last_error(),))
        a, t = nt(a), nt(t) if t else {}
        return {
            "login": a.get("login"), "server": a.get("server"), "company": a.get("company"), "currency": a.get("currency"),
            "leverage": a.get("leverage"), "balance": a.get("balance"), "equity": a.get("equity"), "profit": a.get("profit"),
            "margin": a.get("margin"), "marginFree": a.get("margin_free"), "marginLevel": a.get("margin_level"),
            "marginMode": MARGIN_MODES.get(a.get("margin_mode"), str(a.get("margin_mode"))),
            "tradeMode": TRADE_MODES.get(a.get("trade_mode"), str(a.get("trade_mode"))),
            "accountTradeAllowed": bool(a.get("trade_allowed")), "accountExpertAllowed": bool(a.get("trade_expert")),
            "connected": bool(t.get("connected")), "algoTrading": bool(t.get("trade_allowed")),
            "terminalBuild": t.get("build"), "terminalPath": t.get("path"),
        }

    def positions(self, offset_h):
        out = []
        for p in self.mt5.positions_get() or []:
            p = nt(p)
            out.append({
                "ticket": p.get("ticket"), "magic": p.get("magic"), "symbol": p.get("symbol"),
                "side": "achat" if p.get("type") == 0 else "vente", "volume": p.get("volume"),
                "open": p.get("price_open"), "price": p.get("price_current"), "sl": p.get("sl") or None, "tp": p.get("tp") or None,
                "profit": p.get("profit"), "swap": p.get("swap"), "at": iso(p.get("time", 0) - offset_h * 3600),
                "comment": p.get("comment") or "",
            })
        return out

    def deals(self, since_ts, offset_h):
        # MT5 compte en heure du serveur : on élargit la fenêtre de 3 jours de chaque côté
        start = max(0, int(since_ts - 3 * 86400))
        end = int(time.time() + 3 * 86400)
        rows = self.mt5.history_deals_get(start, end)
        if rows is None:
            raise AgentError("Historique MT5 illisible (%s)." % (self.mt5.last_error(),))
        return [deal_row(nt(d), offset_h) for d in rows]


def deal_row(d, offset_h):
    t = (d.get("time_msc") or d.get("time", 0) * 1000) / 1000.0
    return {
        "ticket": d.get("ticket"), "at": iso(t - offset_h * 3600), "magic": d.get("magic") or 0, "symbol": d.get("symbol") or None,
        "kind": DEAL_KINDS.get(d.get("type"), str(d.get("type"))), "entry": DEAL_ENTRIES.get(d.get("entry"), str(d.get("entry"))),
        "volume": d.get("volume"), "price": d.get("price"), "profit": d.get("profit") or 0, "swap": d.get("swap") or 0,
        "commission": d.get("commission") or 0, "fee": d.get("fee") or 0, "position_id": d.get("position_id") or None,
        "order_id": d.get("order") or None, "comment": d.get("comment") or None,
    }


# ---------------------------------------------------------------- agent
class Agent:
    def __init__(self, cfg, cloud, reader, interval=30):
        self.cfg, self.cloud, self.reader, self.interval = cfg, cloud, reader, interval
        self.sent = {}  # ticket -> empreinte déjà envoyée
        self.last_snap = None
        self.last_err = None
        self.claimed = None
        self.code_shown = (None, 0)

    @property
    def mid(self):
        return self.cfg["machine_id"]

    def offset(self, positions_symbols):
        off = None
        try:
            off = self.reader.server_offset(list(positions_symbols) + ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"])
        except Exception:  # noqa: BLE001
            off = None
        if off is not None and off != self.cfg.get("server_offset_h"):
            self.cfg["server_offset_h"] = off
            save_config(self.cfg)
            log("Heure du serveur du courtier : UTC%+g" % off)
        return self.cfg.get("server_offset_h", 0), self.cfg.get("server_offset_h") is not None

    def sync_deals(self, offset_h):
        since = self.cfg.get("deals_since_ts")
        if since is None:
            since = time.time() - self.cfg.get("history_days", 365) * 86400
        rows = self.reader.deals(since, offset_h)
        fresh = []
        for r in rows:
            key = json.dumps(r, sort_keys=True)
            if self.sent.get(r["ticket"]) != key:
                fresh.append((r, key))
        for i in range(0, len(fresh), 500):
            part = fresh[i:i + 500]
            body = [dict(r, machine_id=self.mid) for r, _ in part]
            self.cloud.rest("POST", "trade_ops?on_conflict=machine_id,ticket", body, "resolution=merge-duplicates,return=minimal")
            for r, key in part:
                self.sent[r["ticket"]] = key
        if rows:
            latest = max(dt.datetime.strptime(r["at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=dt.timezone.utc).timestamp() for r in rows)
            if latest > (self.cfg.get("deals_since_ts") or 0):
                self.cfg["deals_since_ts"] = latest
                save_config(self.cfg)
        elif self.cfg.get("deals_since_ts") is None:
            self.cfg["deals_since_ts"] = time.time() - 86400
            save_config(self.cfg)
        return len(fresh)

    def snapshot(self, acc, positions):
        now = time.time()
        slot = int(now // (SNAP_MINUTES * 60)) * SNAP_MINUTES * 60
        if self.last_snap == slot:
            return False
        by_magic = {}
        for p in positions:
            m = str(p["magic"] or 0)
            x = by_magic.setdefault(m, {"floating": 0.0, "positions": 0, "volume": 0.0})
            x["floating"] = round(x["floating"] + (p["profit"] or 0) + (p["swap"] or 0), 2)
            x["positions"] += 1
            x["volume"] = round(x["volume"] + (p["volume"] or 0), 2)
        data = {"balance": acc.get("balance"), "equity": acc.get("equity"), "margin": acc.get("margin"), "marginLevel": acc.get("marginLevel"),
                "currency": acc.get("currency"), "byMagic": by_magic}
        self.cloud.rest("POST", "trade_snaps?on_conflict=machine_id,at", [{"machine_id": self.mid, "at": iso(slot), "data": data}],
                        "resolution=merge-duplicates,return=minimal")
        self.last_snap = slot
        return True

    def heartbeat(self, info, positions=None):
        body = {"info": info, "seen_at": utc_now_iso()}
        if positions is not None:
            body["positions"] = positions
        self.cloud.rest("PATCH", "machines?id=eq." + self.mid, body, "return=minimal")

    def check_claim(self):
        rows = self.cloud.rest("GET", "machines?select=owner,pair_code,pair_until&id=eq." + self.mid)
        if not rows:
            raise AgentError("Cette machine n'existe plus dans Supabase : relancez  python forexia_agent.py --setup")
        m = rows[0]
        if m.get("owner"):
            if self.claimed is not True:
                log("Machine rattachée à votre compte : visible dans la page admin.")
            self.claimed = True
            return
        self.claimed = False
        until = m.get("pair_until")
        expired = not until or dt.datetime.fromisoformat(until.replace("Z", "+00:00")) < dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        if expired or not m.get("pair_code"):
            code = new_pair_code()
            self.cloud.rest("PATCH", "machines?id=eq." + self.mid, {"pair_code": code, "pair_until": iso(time.time() + 86400)}, "return=minimal")
            m["pair_code"] = code
        if self.code_shown[0] != m["pair_code"] or time.time() - self.code_shown[1] > 600:
            show_code(m["pair_code"])
            self.code_shown = (m["pair_code"], time.time())

    def cycle(self):
        base = {"agent": VERSION, "host": socket.gethostname(), "readOnly": True}
        try:
            if self.claimed is not True:
                self.check_claim()
            self.reader.connect()
            acc = self.reader.account()
            positions_raw = self.reader.positions(0)
            off, known = self.offset({p["symbol"] for p in positions_raw})
            positions = self.reader.positions(off) if off else positions_raw
            n = self.sync_deals(off)
            info = dict(base, mt5=True, serverOffsetH=off, serverOffsetKnown=known, **acc)
            self.heartbeat(info, positions)
            snapped = self.snapshot(acc, positions)
            msg = "OK : compte %s, valeur %s %s, %d position(s), %d opération(s) envoyée(s)%s" % (
                acc.get("login"), acc.get("equity"), acc.get("currency"), len(positions), n, ", photo du compte" if snapped else "")
            if msg != self.last_err or n or snapped:
                log(msg)
            self.last_err = msg
            return True
        except AgentError as e:
            if "MetaTrader" in str(e) or "MT5" in str(e):
                self.reader.close()
                try:
                    self.heartbeat(dict(base, mt5=False, error=str(e)))
                except AgentError:
                    pass
            if str(e) != self.last_err:
                log("⚠ " + str(e))
            self.last_err = str(e)
            return False

    def run(self, once=False):
        log("Agent Forexia %s démarré (lecture seule, aucun ordre n'est passé). Machine %s." % (VERSION, self.mid))
        while True:
            self.cycle()
            if once:
                return
            time.sleep(self.interval)


def new_pair_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(8))
    return raw[:4] + "-" + raw[4:]


def show_code(code):
    log("")
    log("  ┌──────────────────────────────────────────────────────┐")
    log("  │  Code d'appairage de ce PC :   %s            │" % code)
    log("  │  Page admin Forexia → « Ajouter une machine »        │")
    log("  └──────────────────────────────────────────────────────┘")
    log("  " + ADMIN_URL)
    log("")


# ---------------------------------------------------------------- installation
def setup(args, cfg):
    print("\n=== Agent Forexia : configuration ===\n")
    print("L'agent a son propre compte Forexia (différent du vôtre) : il ne pourra voir que ce PC.")
    default = "agent-" + re.sub(r"[^a-z0-9-]", "", socket.gethostname().lower())[:30]
    login = args.login or input("Identifiant de l'agent [%s] : " % default).strip() or default
    password = os.environ.get("FOREXIA_AGENT_PASSWORD") or getpass.getpass("Mot de passe de l'agent (6 caractères min.) : ")
    cloud = Cloud(cfg)
    cfg.pop("refresh_token", None)
    try:
        cloud.sign_in(login, password)
        print("Connecté avec le compte « %s »." % login)
    except AgentError as e:
        if "invalid" not in str(e).lower() and "incorrect" not in str(e).lower():
            raise
        if not os.environ.get("FOREXIA_AGENT_PASSWORD"):
            if getpass.getpass("Compte inexistant : retapez le mot de passe pour le créer : ") != password:
                raise AgentError("Les deux mots de passe sont différents.")
        cloud.sign_up(login, password)
        print("Compte « %s » créé." % login)
    cfg["login"] = login
    if args.terminal:
        cfg["terminal"] = args.terminal
    if args.depuis:
        cfg["history_days"] = args.depuis
    mid = cfg.get("machine_id")
    if mid and cloud.rest("GET", "machines?select=id&id=eq." + mid):
        print("Machine déjà enregistrée : %s" % mid)
    else:
        mid = "m-" + secrets.token_hex(6)
        name = args.name or socket.gethostname()
        cloud.rest("POST", "machines", [{"id": mid, "name": name, "pair_code": new_pair_code(), "pair_until": iso(time.time() + 86400)}], "return=minimal")
        cfg["machine_id"] = mid
        cfg.pop("deals_since_ts", None)
        print("Machine enregistrée : %s (%s)" % (name, mid))
    save_config(cfg)
    print("Configuration enregistrée dans %s (le mot de passe n'y est pas).\n" % config_path())
    return cloud


def install_startup():
    if os.name != "nt":
        raise AgentError("Le démarrage automatique ne concerne que Windows.")
    folder = os.path.join(appdata(), "Microsoft", "Windows", "Start Menu", "Programs", "Startup")
    bat = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demarrer-agent.bat")
    path = os.path.join(folder, "Forexia agent.bat")
    with open(path, "w", encoding="cp1252", errors="replace") as f:
        f.write('@echo off\r\nstart "Agent Forexia" /min cmd /c "%s"\r\n' % bat)
    print("Démarrage automatique installé : %s\nPour l'enlever, supprimez ce fichier." % path)


def single_instance():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    try:
        s.bind(("127.0.0.1", LOCK_PORT))
        s.listen(1)
    except OSError:
        raise AgentError("Un agent Forexia tourne déjà sur ce PC (port %d occupé)." % LOCK_PORT)
    return s


def main(argv=None):
    ap = argparse.ArgumentParser(description="Agent Forexia (lecture seule de MT5 → page admin)")
    ap.add_argument("--setup", action="store_true", help="configurer le compte de l'agent et enregistrer ce PC")
    ap.add_argument("--login", help="identifiant de l'agent (avec --setup)")
    ap.add_argument("--name", help="nom de la machine (avec --setup)")
    ap.add_argument("--terminal", help="chemin de terminal64.exe si plusieurs MT5 sont installés")
    ap.add_argument("--depuis", type=int, help="jours d'historique à envoyer la première fois (365 par défaut)")
    ap.add_argument("--interval", type=int, default=30, help="secondes entre deux relevés (30)")
    ap.add_argument("--once", action="store_true", help="un seul relevé puis arrêt")
    ap.add_argument("--demarrage-auto", action="store_true", help="lancer l'agent à l'ouverture de Windows")
    args = ap.parse_args(argv)
    try:
        if args.demarrage_auto:
            install_startup()
            return 0
        lock = single_instance() if not args.once else None  # noqa: F841
        cfg = load_config()
        if args.setup or not cfg.get("refresh_token") or not cfg.get("machine_id"):
            cloud = setup(args, cfg)
        else:
            cloud = Cloud(cfg)
            if args.terminal:
                cfg["terminal"] = args.terminal
                save_config(cfg)
        agent = Agent(cfg, cloud, Reader(mt5_module(), cfg.get("terminal")), max(10, args.interval))
        agent.run(once=args.once)
        return 0
    except AgentError as e:
        log("✖ " + str(e))
        return 1
    except KeyboardInterrupt:
        log("Agent arrêté.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
