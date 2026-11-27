#!/usr/bin/env python3
"""Passerelle Forexia <-> MetaTrader 5.

Petit serveur local (http://127.0.0.1:8787) qui permet à la page Forexia de :
  1. déposer l'Expert Advisor généré dans MQL5\\Experts\\Forexia et le compiler avec MetaEditor ;
  2. lancer le testeur de stratégie de MT5 et renvoyer ses résultats ;
  3. ouvrir l'EA sur un graphique (le terminal est relancé avec un fichier de configuration).

Sécurité :
  - écoute uniquement sur 127.0.0.1 (inaccessible depuis le réseau) ;
  - n'accepte que la page Forexia (en-tête Origin) et exige le code d'appairage affiché au démarrage ;
  - n'écrit que dans MQL5\\Experts\\Forexia et dans un dossier Forexia du terminal ;
  - n'exécute que MetaEditor et le terminal MT5, jamais une commande reçue.

Lancement : python forexia_bridge.py   (Python 3.8+ ; aucun module à installer)
"""
import argparse
import glob
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

VERSION = "1.7"
DEFAULT_PORT = 8787
PAGE_ORIGIN = "https://zied99.github.io"
FILE_RE = re.compile(r"^Forexia_[A-Za-z0-9_]{1,60}\.mq5$")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9._#\-]{3,30}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PERIODS = {"M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"}
MAX_BODY = 2 * 1024 * 1024
JOB_LOCK = threading.Lock()


# ---------------------------------------------------------------- utilitaires
def appdata():
    return os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")


def read_text(path):
    """Lit un fichier texte MetaTrader (UTF-16 avec BOM, UTF-8 ou ANSI)."""
    with open(path, "rb") as f:
        data = f.read()
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", "replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", "replace")


def write_ini(path, text):
    """Fichiers de configuration MT5 : UTF-16 LE avec BOM, fins de ligne Windows."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\xff\xfe" + text.replace("\n", "\r\n").encode("utf-16-le"))


def config_file():
    return os.path.join(appdata(), "Forexia", "bridge.json")


def load_config():
    path = config_file()
    cfg = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                cfg = json.load(f)
        except (OSError, ValueError):
            cfg = {}
    if not re.match(r"^[A-Z2-9]{4}-[A-Z2-9]{4}$", str(cfg.get("token", ""))):
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        cfg["token"] = raw[:4] + "-" + raw[4:]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f)
    return cfg


# ---------------------------------------------------------------- terminaux MT5
def find_terminals(args):
    """Dossiers de données MT5 (%APPDATA%\\MetaQuotes\\Terminal\\<id>) et leur installation (origin.txt)."""
    root = args.terminal_root or os.path.join(appdata(), "MetaQuotes", "Terminal")
    found = []
    for d in sorted(glob.glob(os.path.join(root, "*"))):
        if not os.path.isdir(os.path.join(d, "MQL5", "Experts")):
            continue
        install = ""
        origin = os.path.join(d, "origin.txt")
        if os.path.exists(origin):
            install = read_text(origin).strip()
        metaeditor = args.metaeditor or os.path.join(install, "metaeditor64.exe")
        terminal = args.terminal_exe or os.path.join(install, "terminal64.exe")
        found.append({
            "id": os.path.basename(d),
            "dataDir": d,
            "installDir": install,
            "name": os.path.basename(install.rstrip("\\/")) or os.path.basename(d),
            "metaeditor": metaeditor if os.path.exists(metaeditor) else None,
            "terminal": terminal if os.path.exists(terminal) else None,
        })
    return found


def common_files(args):
    return args.common_dir or os.path.join(appdata(), "MetaQuotes", "Terminal", "Common", "Files")


def run_program(exe, params, timeout, wait=True):
    """Lance MetaEditor / le terminal. Sous Windows la ligne de commande est passée telle quelle
    (MetaTrader attend la forme /option:"chemin")."""
    if os.name == "nt":
        cmd = '"%s" %s' % (exe, " ".join(params))
        if not wait:
            flags = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
            subprocess.Popen(cmd, creationflags=flags, close_fds=True)
            return None
        return subprocess.run(cmd, timeout=timeout, capture_output=True)
    argv = [exe] + [p.replace('"', "") for p in params]
    if not wait:
        subprocess.Popen(argv, start_new_session=True)
        return None
    return subprocess.run(argv, timeout=timeout, capture_output=True)


def terminal_running(term):
    if os.name != "nt":
        return os.path.exists(os.path.join(term["dataDir"], "Forexia", "RUNNING"))  # tests hors Windows
    exe = (term["terminal"] or "").replace("'", "''")
    ps = "@(Get-Process terminal64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '%s' }).Count" % exe
    out = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=30)
    return out.stdout.strip() not in ("", "0")


def close_terminal(term):
    """Ferme proprement le terminal (comme un clic sur la croix) et attend sa fermeture."""
    if os.name != "nt":
        flag = os.path.join(term["dataDir"], "Forexia", "RUNNING")
        if os.path.exists(flag):
            os.remove(flag)
        return True
    exe = (term["terminal"] or "").replace("'", "''")
    ps = ("Get-Process terminal64 -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '%s' } | "
          "ForEach-Object { $_.CloseMainWindow() | Out-Null }" % exe)
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=30)
    for _ in range(60):
        if not terminal_running(term):
            time.sleep(1)
            return True
        time.sleep(1)
    return False


# ---------------------------------------------------------------- actions
def deploy(args, term, body):
    name = str(body.get("fileName", ""))
    code = body.get("code")
    if not FILE_RE.match(name) or not isinstance(code, str) or not code.strip():
        raise ValueError("Nom de fichier ou code invalide.")
    if not term["metaeditor"]:
        raise ValueError("MetaEditor (metaeditor64.exe) introuvable dans " + (term["installDir"] or "?"))
    folder = os.path.join(term["dataDir"], "MQL5", "Experts", "Forexia")
    os.makedirs(folder, exist_ok=True)
    src = os.path.join(folder, name)
    ex5 = src[:-4] + ".ex5"
    log = src[:-4] + ".log"
    with open(src, "wb") as f:
        f.write(b"\xef\xbb\xbf" + code.lstrip("\ufeff").replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
    for p in (ex5, log):
        if os.path.exists(p):
            os.remove(p)
    started = time.time()
    run_program(term["metaeditor"], ['/compile:"%s"' % src, '/log:"%s"' % log,
                                     '/inc:"%s"' % os.path.join(term["dataDir"], "MQL5")], timeout=180)
    text = read_text(log) if os.path.exists(log) else ""
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    errors = [l for l in lines if re.search(r":\s*(error|erreur)\s*\d*\s*:", l, re.I)]
    warnings = [l for l in lines if re.search(r":\s*(warning|avertissement)\s*\d*\s*:", l, re.I)]
    compiled = os.path.exists(ex5) and os.path.getmtime(ex5) >= started - 2 and not errors
    return {
        "ok": True, "compiled": compiled, "errors": errors[:50], "warnings": warnings[:50],
        "summary": next((l for l in reversed(lines) if re.search(r"result|r[ée]sultat", l, re.I)), ""),
        "path": src, "expert": "Forexia\\" + name[:-4],
    }


def _check_ex5(term, name):
    if not FILE_RE.match(name):
        raise ValueError("Nom de fichier invalide.")
    ex5 = os.path.join(term["dataDir"], "MQL5", "Experts", "Forexia", name[:-4] + ".ex5")
    if not os.path.exists(ex5):
        raise ValueError("EA non compilé : déployez-le d'abord.")
    if not term["terminal"]:
        raise ValueError("Terminal MT5 (terminal64.exe) introuvable dans " + (term["installDir"] or "?"))


def _ensure_closed(term, body):
    if terminal_running(term):
        if not body.get("closeTerminal"):
            return {"ok": False, "needClose": True,
                    "message": "MetaTrader 5 est ouvert : il doit être fermé pour cette opération."}
        if not close_terminal(term):
            return {"ok": False, "message": "MetaTrader 5 ne s'est pas fermé. Fermez-le puis réessayez."}
    return None


def run_test(args, term, body):
    name = str(body.get("fileName", ""))
    _check_ex5(term, name)
    symbol, period = str(body.get("symbol", "")), str(body.get("period", "D1"))
    date_from, date_to = str(body.get("from", "")), str(body.get("to", ""))
    currency = str(body.get("currency", "EUR")).upper()
    if not SYMBOL_RE.match(symbol) or period not in PERIODS or not DATE_RE.match(date_from) or not DATE_RE.match(date_to):
        raise ValueError("Paramètres de test invalides.")
    if not CURRENCY_RE.match(currency):
        raise ValueError("Devise invalide.")
    deposit = float(body.get("deposit", 10000))
    leverage = int(body.get("leverage", 100))
    model = int(body.get("model", 1))
    if not (0 < deposit < 1e9) or not (1 <= leverage <= 1000) or model not in (0, 1, 2, 4):
        raise ValueError("Paramètres de test invalides.")
    blocked = _ensure_closed(term, body)
    if blocked:
        return blocked
    report = os.path.join(common_files(args), "Forexia", name[:-4] + ".json")
    if os.path.exists(report):
        os.remove(report)
    ini = os.path.join(term["dataDir"], "Forexia", "tester.ini")
    write_ini(ini, "\n".join([
        "[Tester]",
        "Expert=Forexia\\" + name[:-4] + ".ex5",
        "Symbol=" + symbol,
        "Period=" + period,
        "Optimization=0",
        "Model=%d" % model,
        "FromDate=" + date_from.replace("-", "."),
        "ToDate=" + date_to.replace("-", "."),
        "ForwardMode=0",
        "Deposit=%g" % deposit,
        "Currency=" + currency,
        "Leverage=1:%d" % leverage,
        "ExecutionMode=0",
        "Visual=0",
        "Report=Forexia\\" + name[:-4] + "_rapport",
        "ReplaceReport=1",
        "ShutdownTerminal=1",
        "",
    ]))
    started = time.time()
    run_program(term["terminal"], ['/config:"%s"' % ini], timeout=args.test_timeout)
    if not os.path.exists(report):
        return {"ok": False, "message": "MT5 n'a pas produit de résultat. Ouvrez MT5 et regardez l'onglet Journal du testeur "
                                        "(symbole « %s » disponible chez votre courtier ? historique téléchargé ?)." % symbol}
    with open(report, "r", encoding="utf-8", errors="replace") as f:
        result = json.load(f)
    return {"ok": True, "result": result, "seconds": round(time.time() - started)}


# ---------------------------------------------------------------- données du courtier
# Bougies fines : M1, comme le mode « 1 minute OHLC » du testeur MT5 (repli sur M5 / M15 si la période est très longue).
SUB_TF = ["M1", "M5", "M15"]
MAX_SUB_BARS = 1600000


def _mt5_module(args):
    if args.fake_mt5:  # tests : faux module MetaTrader5
        import importlib.util
        spec = importlib.util.spec_from_file_location("MetaTrader5", args.fake_mt5)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    import MetaTrader5  # noqa: F401  (pip install MetaTrader5)
    return MetaTrader5


def _rates(mt5, symbol, tf_const, start, end):
    """Bougies [t, open, high, low, close, spread] ; MT5 télécharge l'historique à la demande."""
    rates = None
    for _ in range(15):
        rates = mt5.copy_rates_range(symbol, tf_const, start, end)
        if rates is not None and len(rates) > 0:
            break
        time.sleep(1)
    if rates is None:
        return []
    return [[int(r["time"]), float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]), int(r["spread"])] for r in rates]


def broker_bars(args, term, body):
    from datetime import datetime, timezone
    symbol, tf = str(body.get("symbol", "")), str(body.get("timeframe", "D1"))
    date_from, date_to = str(body.get("from", "")), str(body.get("to", ""))
    if not SYMBOL_RE.match(symbol) or tf not in PERIODS or not DATE_RE.match(date_from) or not DATE_RE.match(date_to):
        raise ValueError("Paramètres invalides.")
    try:
        mt5 = _mt5_module(args)
    except ImportError:
        return {"ok": False, "needPackage": True,
                "message": "Module Python « MetaTrader5 » absent : relancez demarrer-passerelle.bat (il l'installe) "
                           "ou tapez « py -m pip install MetaTrader5 »."}
    if not mt5.initialize(path=term["terminal"]) if term["terminal"] else not mt5.initialize():
        return {"ok": False, "message": "Connexion à MetaTrader 5 impossible (%s). MT5 est-il installé et connecté à votre compte ?" % (mt5.last_error(),)}
    try:
        if not mt5.symbol_select(symbol, True):
            similar = [x.name for x in (mt5.symbols_get("*" + symbol[:6] + "*") or [])][:10]
            return {"ok": False, "message": "Symbole « %s » introuvable chez votre courtier." % symbol
                    + (" Symboles proches : " + ", ".join(similar) if similar else "")}
        info, acc = mt5.symbol_info(symbol), mt5.account_info()
        if info is None or acc is None:
            return {"ok": False, "message": "Informations du symbole ou du compte indisponibles (MT5 connecté ?)."}
        start = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end = datetime.strptime(date_to, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        tfc = lambda name: getattr(mt5, "TIMEFRAME_" + name)
        bars = _rates(mt5, symbol, tfc(tf), start, end)
        if len(bars) < 30:
            return {"ok": False, "message": "MT5 n'a renvoyé que %d bougies %s %s : historique indisponible pour cette période "
                                            "(ouvrez un graphique %s %s dans MT5 pour le télécharger, puis réessayez)." % (len(bars), symbol, tf, symbol, tf)}
        sub, sub_tf = None, None
        if body.get("intrabar", True):
            first_test = datetime.strptime(str(body.get("testFrom", date_from)), "%Y-%m-%d").replace(tzinfo=timezone.utc)
            minutes = {"M1": 1, "M5": 5, "M15": 15, "M30": 30, "H1": 60, "H4": 240, "D1": 1440}
            for cand in SUB_TF:
                if minutes[cand] >= minutes[tf]:
                    break
                if (end - first_test).total_seconds() / 60 / minutes[cand] * 5 / 7 > MAX_SUB_BARS:
                    continue
                rows = _rates(mt5, symbol, tfc(cand), first_test, end)
                if rows:
                    # En colonnes (bien plus compact que des objets) : t, open, high, low, close, spread
                    sub = {k: [r[i] for r in rows] for i, k in enumerate(("t", "open", "high", "low", "close", "spread"))}
                    sub_tf = cand
                    break
        conv = None
        if info.currency_profit != acc.currency:
            for name, divide in ((acc.currency + info.currency_profit, True), (info.currency_profit + acc.currency, False)):
                for cand in [name] + [x.name for x in (mt5.symbols_get("*" + name + "*") or [])][:3]:
                    if mt5.symbol_select(cand, True):
                        r = _rates(mt5, cand, mt5.TIMEFRAME_D1, start, end)
                        if r:
                            conv = {"symbol": cand, "divide": divide, "rates": [[x[0], x[4]] for x in r]}
                            break
                if conv:
                    break
        return {
            "ok": True, "symbol": symbol, "timeframe": tf, "subTimeframe": sub_tf, "bars": bars, "sub": sub, "conv": conv,
            "spec": {
                "digits": info.digits, "point": info.point, "contract": info.trade_contract_size,
                "volumeMin": info.volume_min, "volumeMax": info.volume_max, "volumeStep": info.volume_step,
                "swapMode": info.swap_mode, "swapLong": info.swap_long, "swapShort": info.swap_short,
                "swapRollover3days": info.swap_rollover3days, "currencyBase": info.currency_base,
                "currencyProfit": info.currency_profit, "stopsLevel": info.trade_stops_level, "spread": info.spread,
            },
            "account": {"currency": acc.currency, "leverage": acc.leverage, "server": acc.server, "company": acc.company,
                        "tradeMode": acc.trade_mode, "marginSoSo": acc.margin_so_so},
            "conversionMissing": info.currency_profit != acc.currency and conv is None,
        }
    finally:
        mt5.shutdown()


def list_experts(args, term, body):
    """EA Forexia présents dans MQL5\\Experts\\Forexia (le plus récent d'abord), avec leur code si demandé."""
    folder = os.path.join(term["dataDir"], "MQL5", "Experts", "Forexia")
    want = str(body.get("fileName", ""))
    items = []
    for path in glob.glob(os.path.join(folder, "Forexia_*.mq5")):
        name = os.path.basename(path)
        if not FILE_RE.match(name):
            continue
        item = {"fileName": name, "modified": int(os.path.getmtime(path)), "size": os.path.getsize(path)}
        if want == name:
            item["code"] = read_text(path)
        items.append(item)
    items.sort(key=lambda x: -x["modified"])
    return {"ok": True, "experts": items[:200]}


def attach(args, term, body):
    name = str(body.get("fileName", ""))
    _check_ex5(term, name)
    symbol, period = str(body.get("symbol", "")), str(body.get("period", "D1"))
    if not SYMBOL_RE.match(symbol) or period not in PERIODS:
        raise ValueError("Symbole ou unité de temps invalide.")
    blocked = _ensure_closed(term, body)
    if blocked:
        return blocked
    ini = os.path.join(term["dataDir"], "Forexia", "startup.ini")
    write_ini(ini, "\n".join([
        "[Experts]",
        "AllowLiveTrading=1",
        "AllowDllImport=0",
        "Enabled=1",
        "Account=0",
        "Profile=0",
        "[StartUp]",
        "Expert=Forexia\\" + name[:-4],
        "Symbol=" + symbol,
        "Period=" + period,
        "",
    ]))
    run_program(term["terminal"], ['/config:"%s"' % ini], timeout=0, wait=False)
    return {"ok": True, "message": "MetaTrader 5 redémarre avec l'EA sur un graphique %s %s." % (symbol, period)}


# ---------------------------------------------------------------- calendrier économique (Forexia 1.2)
# Le module Python MetaTrader5 n'a pas de calendrier : un petit script MQL5 l'exporte depuis le terminal
# dans Common\Files\Forexia\calendar.csv (heure du serveur ; devise ; importance 1-3 ; nom).
# Ce fichier sert aussi aux EA Forexia dans le testeur de stratégie, qui n'a pas accès au calendrier.
CALENDAR_SCRIPT = r"""//+------------------------------------------------------------------+
//| ForexiaCalendar : export du calendrier économique pour Forexia    |
//+------------------------------------------------------------------+
#property script_show_inputs false
void OnStart()
  {
   datetime from = D'2010.01.01';
   datetime to = TimeTradeServer() + 60 * 86400;
   MqlCalendarValue v[];
   int n = CalendarValueHistory(v, from, to);
   int fh = FileOpen("Forexia\\calendar.tmp", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(fh == INVALID_HANDLE) { Print("Forexia : calendrier non écrit (", GetLastError(), ")"); return; }
   FileWriteString(fh, "time;currency;importance;event\r\n");
   int kept = 0;
   ulong lastId = 0;
   MqlCalendarEvent ev;
   MqlCalendarCountry co;
   bool ok = false;
   for(int i = 0; i < n; i++)
     {
      if(v[i].event_id != lastId)
        {
         lastId = v[i].event_id;
         ok = CalendarEventById(v[i].event_id, ev) && CalendarCountryById(ev.country_id, co);
        }
      if(!ok || ev.importance < CALENDAR_IMPORTANCE_MODERATE) continue;
      string name = ev.name;
      StringReplace(name, ";", ",");
      FileWriteString(fh, IntegerToString((long)v[i].time) + ";" + co.currency + ";" + IntegerToString((int)ev.importance) + ";" + name + "\r\n");
      kept++;
     }
   FileClose(fh);
   FileDelete("Forexia\\calendar.csv", FILE_COMMON);
   FileMove("Forexia\\calendar.tmp", FILE_COMMON, "Forexia\\calendar.csv", FILE_COMMON | FILE_REWRITE);
   int fd = FileOpen("Forexia\\calendar.done", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(fd != INVALID_HANDLE) { FileWriteString(fd, IntegerToString(kept) + ";" + IntegerToString(n)); FileClose(fd); }
   PrintFormat("Forexia : %d annonces exportées (%d au total).", kept, n);
  }
"""


def _compile(term, src):
    ex5, log = src[:-4] + ".ex5", src[:-4] + ".log"
    for p in (ex5, log):
        if os.path.exists(p):
            os.remove(p)
    started = time.time()
    run_program(term["metaeditor"], ['/compile:"%s"' % src, '/log:"%s"' % log,
                                     '/inc:"%s"' % os.path.join(term["dataDir"], "MQL5")], timeout=180)
    text = read_text(log) if os.path.exists(log) else ""
    errors = [l.strip() for l in text.splitlines() if re.search(r":\s*(error|erreur)\s*\d*\s*:", l, re.I)]
    return os.path.exists(ex5) and os.path.getmtime(ex5) >= started - 2 and not errors, errors


def calendar_file(args):
    return os.path.join(common_files(args), "Forexia", "calendar.csv")


def read_calendar(args, t_from=None, t_to=None):
    path = calendar_file(args)
    if not os.path.exists(path):
        return None
    events = []
    with open(path, "r", encoding="latin-1", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\r\n").split(";")
            if len(parts) < 3 or not parts[0].isdigit():
                continue
            t = int(parts[0])
            if (t_from is not None and t < t_from) or (t_to is not None and t > t_to):
                continue
            events.append({"t": t, "currency": parts[1].upper()[:3], "importance": int(parts[2]) if parts[2].isdigit() else 0})
    return {"events": events, "updated": int(os.path.getmtime(path))}


def calendar_export(args, term, body):
    if not term["metaeditor"] or not term["terminal"]:
        raise ValueError("MetaEditor ou le terminal MT5 introuvable dans " + (term["installDir"] or "?"))
    folder = os.path.join(term["dataDir"], "MQL5", "Scripts", "Forexia")
    os.makedirs(folder, exist_ok=True)
    src = os.path.join(folder, "ForexiaCalendar.mq5")
    with open(src, "wb") as f:
        f.write(b"\xef\xbb\xbf" + CALENDAR_SCRIPT.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8"))
    compiled, errors = _compile(term, src)
    if not compiled:
        return {"ok": False, "message": "Le script d'export du calendrier ne compile pas : " + "; ".join(errors[:3])}
    blocked = _ensure_closed(term, body)
    if blocked:
        return blocked
    done = os.path.join(common_files(args), "Forexia", "calendar.done")
    os.makedirs(os.path.dirname(done), exist_ok=True)
    if os.path.exists(done):
        os.remove(done)
    symbol = str(body.get("symbol") or "EURUSD")
    if not SYMBOL_RE.match(symbol):
        symbol = "EURUSD"
    ini = os.path.join(term["dataDir"], "Forexia", "calendar.ini")
    write_ini(ini, "\n".join(["[StartUp]", "Script=Forexia\\ForexiaCalendar", "Symbol=" + symbol, "Period=H1", "ShutdownTerminal=1", ""]))
    run_program(term["terminal"], ['/config:"%s"' % ini], timeout=0, wait=False)
    for _ in range(int(args.test_timeout)):
        if os.path.exists(done):
            break
        time.sleep(1)
    if not os.path.exists(done):
        return {"ok": False, "message": "MT5 n'a pas exporté le calendrier à temps. Ouvrez MT5 : le compte est-il connecté ? "
                                        "(onglet Calendrier visible dans la Boîte à outils)"}
    cal = read_calendar(args) or {"events": []}
    ev = cal["events"]
    ts = [e["t"] for e in ev]
    return {"ok": True, "count": len(ev), "from": min(ts) if ts else None, "to": max(ts) if ts else None, "updated": cal.get("updated")}


# ---------------------------------------------------------------- base de données (SQLite)
DB_LOCK = threading.Lock()
SCHEMA = """
CREATE TABLE IF NOT EXISTS strategies (name TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS simulations (key TEXT PRIMARY KEY, at TEXT NOT NULL, name TEXT, pair TEXT, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, type TEXT NOT NULL, summary TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS simulations_at ON simulations (at);
CREATE INDEX IF NOT EXISTS events_at ON events (at);
"""


def db_path(args):
    return args.db or os.path.join(appdata(), "Forexia", "forexia.db")


def db_connect(args):
    path = db_path(args)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def db_event(args, kind, summary, data=None):
    """Journal d'activité ; une erreur de base ne doit jamais bloquer une opération MT5."""
    try:
        with DB_LOCK:
            conn = db_connect(args)
            with conn:
                conn.execute("INSERT INTO events (at, type, summary, data) VALUES (?, ?, ?, ?)",
                             (now_iso(), kind[:60], str(summary)[:500], json.dumps(data, ensure_ascii=False) if data is not None else None))
            conn.close()
    except (sqlite3.Error, OSError, TypeError, ValueError):
        pass


def _text(v, limit):
    s = json.dumps(v, ensure_ascii=False)
    if len(s) > limit:
        raise ValueError("Donnée trop volumineuse.")
    return s


def db_action(args, path, body):
    with DB_LOCK:
        conn = db_connect(args)
        try:
            with conn:
                if path == "info":
                    counts = {t: conn.execute("SELECT COUNT(*) FROM " + t).fetchone()[0] for t in ("strategies", "simulations", "events", "kv")}
                    return {"ok": True, "path": db_path(args), "size": os.path.getsize(db_path(args)), "counts": counts}
                if path == "strategies/list":
                    rows = conn.execute("SELECT name, data, updated_at FROM strategies ORDER BY name").fetchall()
                    return {"ok": True, "items": [dict(name=r["name"], data=json.loads(r["data"]), updatedAt=r["updated_at"]) for r in rows]}
                if path == "strategies/put":
                    name = str(body.get("name", "")).strip()
                    if not name or len(name) > 120:
                        raise ValueError("Nom de stratégie invalide.")
                    conn.execute("INSERT INTO strategies (name, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                                 (name, _text(body.get("data"), 200000), str(body.get("updatedAt") or now_iso())))
                    return {"ok": True}
                if path == "strategies/delete":
                    conn.execute("DELETE FROM strategies WHERE name = ?", (str(body.get("name", "")),))
                    return {"ok": True}
                if path == "simulations/list":
                    limit = max(1, min(int(body.get("limit", 2000)), 10000))
                    rows = conn.execute("SELECT data FROM (SELECT data, at FROM simulations ORDER BY at DESC LIMIT ?) ORDER BY at", (limit,)).fetchall()
                    return {"ok": True, "items": [json.loads(r["data"]) for r in rows]}
                if path == "simulations/put":
                    items = body.get("items") if isinstance(body.get("items"), list) else [body]
                    for it in items[:2000]:
                        key, at = str(it.get("key", "")), str(it.get("at", ""))
                        if not key or not at:
                            raise ValueError("Simulation sans identifiant.")
                        conn.execute("INSERT OR REPLACE INTO simulations (key, at, name, pair, data) VALUES (?, ?, ?, ?, ?)",
                                     (key[:300], at[:40], str(it.get("name", ""))[:120], str(it.get("pair", ""))[:10], _text(it, 2000000)))
                    return {"ok": True, "count": len(items)}
                if path == "simulations/delete":
                    conn.execute("DELETE FROM simulations WHERE key = ?", (str(body.get("key", "")),))
                    return {"ok": True}
                if path == "simulations/clear":
                    n = conn.execute("DELETE FROM simulations").rowcount
                    return {"ok": True, "deleted": n}
                # Autres données de Forexia (FX, batchs, époques, événements de marché, mécaniques de retrait, dessins…) :
                # une ligne par clé, la plus récente l'emporte.
                if path == "kv/list":
                    rows = conn.execute("SELECT key, data, updated_at FROM kv ORDER BY key").fetchall()
                    return {"ok": True, "items": [dict(key=r["key"], data=json.loads(r["data"]) if r["data"] is not None else None, updatedAt=r["updated_at"]) for r in rows]}
                if path == "kv/put":
                    key = str(body.get("key", "")).strip()
                    if not key or len(key) > 120:
                        raise ValueError("Clé invalide.")
                    data = body.get("data")
                    conn.execute("INSERT INTO kv (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                                 (key, _text(data, 80000000) if data is not None else None, str(body.get("updatedAt") or now_iso())[:40]))
                    return {"ok": True}
                if path == "kv/delete":
                    conn.execute("DELETE FROM kv WHERE key = ?", (str(body.get("key", "")),))
                    return {"ok": True}
                if path == "events/put":
                    kind = str(body.get("type", "")).strip()
                    if not kind:
                        raise ValueError("Type d'événement manquant.")
                    conn.execute("INSERT INTO events (at, type, summary, data) VALUES (?, ?, ?, ?)",
                                 (now_iso(), kind[:60], str(body.get("summary", ""))[:500], _text(body.get("data"), 500000) if body.get("data") is not None else None))
                    return {"ok": True}
                if path == "events/list":
                    limit = max(1, min(int(body.get("limit", 300)), 5000))
                    rows = conn.execute("SELECT id, at, type, summary, data FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
                    return {"ok": True, "items": [dict(id=r["id"], at=r["at"], type=r["type"], summary=r["summary"],
                                                       data=json.loads(r["data"]) if r["data"] else None) for r in rows]}
                if path == "export":
                    out = {"exportedAt": now_iso(), "path": db_path(args)}
                    out["strategies"] = [dict(name=r["name"], data=json.loads(r["data"]), updatedAt=r["updated_at"]) for r in conn.execute("SELECT * FROM strategies")]
                    out["simulations"] = [json.loads(r["data"]) for r in conn.execute("SELECT data FROM simulations ORDER BY at")]
                    out["data"] = {r["key"]: json.loads(r["data"]) if r["data"] is not None else None for r in conn.execute("SELECT key, data FROM kv")}
                    out["events"] = [dict(at=r["at"], type=r["type"], summary=r["summary"], data=json.loads(r["data"]) if r["data"] else None)
                                     for r in conn.execute("SELECT * FROM events ORDER BY id")]
                    return dict(out, ok=True)
                raise ValueError("Inconnu.")
        finally:
            conn.close()


# ---------------------------------------------------------------- serveur HTTP
def origin_allowed(origin, extra):
    if not origin or origin == "null":
        return True  # page ouverte en local (file://) ou outil local : le code d'appairage reste exigé
    if origin == PAGE_ORIGIN or origin in extra:
        return True
    u = urlparse(origin)
    return u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")


class Handler(BaseHTTPRequestHandler):
    server_version = "ForexiaBridge/" + VERSION

    def log_message(self, fmt, *a):
        if self.server.args.verbose:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % a))

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and origin_allowed(origin, self.server.args.allow_origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Forexia-Token")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")

    def _send(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        gz = len(data) > 100000 and "gzip" in self.headers.get("Accept-Encoding", "")
        if gz:
            import gzip
            data = gzip.compress(data, compresslevel=5)
        self.send_response(code)
        self._cors()
        if gz:
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _authorized(self):
        if not origin_allowed(self.headers.get("Origin"), self.server.args.allow_origin):
            self._send(403, {"ok": False, "message": "Origine non autorisée."})
            return False
        token = self.headers.get("X-Forexia-Token", "")
        if not secrets.compare_digest(token.strip().upper(), self.server.token):
            self._send(401, {"ok": False, "message": "Code d'appairage incorrect."})
            return False
        return True

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/ping":
            return self._send(200, {"app": "forexia-bridge", "version": VERSION})
        if path == "/status":
            if not self._authorized():
                return
            terms = find_terminals(self.server.args)
            return self._send(200, {"ok": True, "version": VERSION, "terminals": [
                dict({k: t[k] for k in ("id", "name", "installDir", "dataDir")}, metaeditor=bool(t["metaeditor"]), terminal=bool(t["terminal"]))
                for t in terms]})
        if path == "/calendar":
            if not self._authorized():
                return
            q = parse_qs(urlparse(self.path).query)
            try:
                t_from = int(q.get("from", ["0"])[0])
                t_to = int(q.get("to", [str(2 ** 40)])[0])
            except ValueError:
                return self._send(200, {"ok": False, "message": "Dates invalides."})
            cal = read_calendar(self.server.args, t_from, t_to)
            if cal is None:
                return self._send(200, {"ok": False, "missing": True, "message": "Calendrier pas encore exporté depuis MT5."})
            return self._send(200, dict(ok=True, **cal))
        self._send(404, {"ok": False, "message": "Inconnu."})

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/db/"):
            if not self._authorized():
                return
            try:
                length = int(self.headers.get("Content-Length", "0") or 0)
                if length > MAX_BODY * 60:  # base : données de la page (batchs, FX…) jusqu'à ~120 Mo
                    raise ValueError("Requête trop volumineuse.")
                body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
                return self._send(200, db_action(self.server.args, path[4:], body))
            except (ValueError, sqlite3.Error, OSError) as e:
                return self._send(200, {"ok": False, "message": str(e)})
        actions = {"/deploy": deploy, "/test": run_test, "/attach": attach, "/bars": broker_bars, "/experts": list_experts, "/calendar/export": calendar_export}
        if path not in actions:
            return self._send(404, {"ok": False, "message": "Inconnu."})
        if not self._authorized():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("Requête trop volumineuse.")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            terms = find_terminals(self.server.args)
            term = next((t for t in terms if t["id"] == body.get("terminalId")), terms[0] if len(terms) == 1 else None)
            if not term:
                raise ValueError("Terminal MT5 introuvable." if not terms else "Choisissez le terminal MT5.")
            if not JOB_LOCK.acquire(blocking=False):
                return self._send(409, {"ok": False, "message": "Une opération MT5 est déjà en cours."})
            try:
                result = actions[path](self.server.args, term, body)
            finally:
                JOB_LOCK.release()
            log = {"/deploy": ("mt5.compile", lambda r: ("Compilé : " if r.get("compiled") else "Échec de compilation : ") + str(body.get("fileName"))),
                   "/test": ("mt5.test", lambda r: "Test MT5 %s %s %s → %s" % (body.get("fileName"), body.get("symbol"), body.get("period"),
                             "%.2f %%" % (100.0 * r["result"]["profit"] / r["result"]["deposit"]) if r.get("ok") and r["result"].get("deposit") else (r.get("message") or "en attente"))),
                   "/calendar/export": ("mt5.calendar", lambda r: "Calendrier économique exporté : %s annonces" % r.get("count") if r.get("ok") else "Export du calendrier : " + str(r.get("message"))),
                   "/attach": ("mt5.attach", lambda r: "EA ouvert sur un graphique : %s %s %s" % (body.get("fileName"), body.get("symbol"), body.get("period")))}.get(path)
            if log and not result.get("needClose"):
                light = {k: v for k, v in result.items() if k != "result"} if path == "/test" else result
                if path == "/test" and result.get("result"):
                    light["result"] = {k: v for k, v in result["result"].items() if k != "deals"}
                db_event(self.server.args, log[0], log[1](result), dict(request={k: v for k, v in body.items() if k != "code"}, response=light))
            self._send(200, result)
        except subprocess.TimeoutExpired:
            self._send(200, {"ok": False, "message": "MetaTrader 5 n'a pas répondu à temps."})
        except (ValueError, OSError) as e:
            self._send(200, {"ok": False, "message": str(e)})


def main():
    ap = argparse.ArgumentParser(description="Passerelle Forexia <-> MetaTrader 5")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--terminal-root", help="dossier contenant les dossiers de données MT5")
    ap.add_argument("--common-dir", help="dossier Common\\Files des terminaux")
    ap.add_argument("--metaeditor", help="chemin de metaeditor64.exe (sinon trouvé via origin.txt)")
    ap.add_argument("--terminal-exe", help="chemin de terminal64.exe (sinon trouvé via origin.txt)")
    ap.add_argument("--allow-origin", action="append", default=[], help="origine supplémentaire autorisée")
    ap.add_argument("--test-timeout", type=int, default=1800, help="durée maximale d'un test (secondes)")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--fake-mt5", help=argparse.SUPPRESS)  # tests : faux module MetaTrader5
    ap.add_argument("--db", help="chemin de la base SQLite (par défaut %%APPDATA%%\\Forexia\\forexia.db)")
    args = ap.parse_args()

    cfg = load_config()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError:
        # le port est pris : le plus souvent une ancienne passerelle encore ouverte (c'est elle que la page voit)
        other = "?"
        try:
            import urllib.request
            with urllib.request.urlopen("http://127.0.0.1:%d/ping" % args.port, timeout=3) as r:
                other = json.loads(r.read().decode("utf-8")).get("version", "?")
        except Exception:  # noqa: BLE001
            pass
        print("")
        print("!!! Impossible de démarrer la passerelle %s : le port %d est déjà utilisé." % (VERSION, args.port))
        if other != "?":
            print("!!! Une autre passerelle Forexia (version %s) tourne déjà sur ce PC : c'est elle que la page voit." % other)
        print("!!! Fermez l'autre fenêtre noire de la passerelle (ou, dans le Gestionnaire des tâches, terminez « Python »),")
        print("!!! puis relancez demarrer-passerelle.bat.")
        sys.exit(1)
    server.args, server.token = args, cfg["token"]
    terms = find_terminals(args)
    print("Passerelle Forexia %s : http://127.0.0.1:%d" % (VERSION, args.port))
    print("Code d'appairage : %s   (à coller une fois dans Forexia → Déployer)" % cfg["token"])
    if not terms:
        print("Aucun MetaTrader 5 trouvé dans " + (args.terminal_root or os.path.join(appdata(), "MetaQuotes", "Terminal")))
    for t in terms:
        print(" - MT5 « %s » : %s  [MetaEditor %s, terminal %s]" % (
            t["name"], t["dataDir"], "ok" if t["metaeditor"] else "absent", "ok" if t["terminal"] else "absent"))
    try:
        _mt5_module(args)
        print("Module MetaTrader5 : ok (données du courtier disponibles)")
    except ImportError:
        print("Module MetaTrader5 absent : installez-le avec « py -m pip install MetaTrader5 » pour utiliser les données du courtier.")
    try:
        db_connect(args).close()
        print("Base de données : " + db_path(args))
    except (sqlite3.Error, OSError) as e:
        print("Base de données indisponible : %s" % e)
    print("Laissez cette fenêtre ouverte pendant l'utilisation. Ctrl+C pour arrêter.")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
