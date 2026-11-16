# Serveur MCP Forexia

Donne à un agent IA (Claude Code, Claude Desktop ou tout client compatible MCP) l'accès complet au moteur
de Forexia : backtests, lots de périodes aléatoires, « Améliorer », robustesse sur d'autres paires,
recommandations, stratégies enregistrées, génération de l'EA MetaTrader 5 et, si la passerelle tourne,
données du courtier, déploiement et test dans MT5.

Le serveur utilise **exactement les mêmes fichiers de calcul que le site** (`js/*.js`) : un backtest lancé par
l'agent donne le même résultat que sur https://zied99.github.io/Forexia-trading/ avec les mêmes réglages.

## Prérequis

- **Node.js 18 ou plus** (https://nodejs.org) ; aucune autre dépendance.
- Le dossier du projet Forexia sur la machine de l'agent (`git clone https://github.com/zied99/Forexia-trading`).
- Internet pour la source `online` (cours BCE).
- Facultatif : la passerelle MT5 (`bridge/demarrer-passerelle.bat`) pour les données du courtier et le déploiement.

## Connecter un agent

Dans les exemples, remplacez `C:\\Forexia-trading` par le dossier du projet.

### Claude Code (terminal)

```
claude mcp add forexia -- node C:\Forexia-trading\mcp\forexia-mcp.js
```

Avec la passerelle MT5 (code d'appairage affiché dans la fenêtre de la passerelle) :

```
claude mcp add forexia -e FOREXIA_BRIDGE_TOKEN=ABCD-EFGH -- node C:\Forexia-trading\mcp\forexia-mcp.js
```

Vérifier : `claude mcp list`, puis dans Claude Code `/mcp`.

### Claude Desktop

Paramètres → Développeur → Modifier la configuration (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "forexia": {
      "command": "node",
      "args": ["C:\\Forexia-trading\\mcp\\forexia-mcp.js"],
      "env": { "FOREXIA_BRIDGE_TOKEN": "ABCD-EFGH" }
    }
  }
}
```

(Retirer `env` si la passerelle MT5 n'est pas utilisée.) Redémarrer Claude Desktop.

### Autre client MCP / accès HTTP

```
node mcp/forexia-mcp.js --http 3333 --token UN_SECRET_LONG
```

- URL : `http://127.0.0.1:3333/mcp` (transport « Streamable HTTP », réponses JSON)
- En-tête : `Authorization: Bearer UN_SECRET_LONG`
- `--host 0.0.0.0` pour l'ouvrir au réseau local : **toujours avec `--token`**. Ne l'exposez pas sur Internet
  sans protection supplémentaire (tunnel authentifié, VPN).

### Variables d'environnement

| Variable | Rôle | Défaut |
|---|---|---|
| `FOREXIA_MCP_DATA` | dossier des stratégies et de l'historique des simulations | `~/.forexia-mcp` |
| `FOREXIA_BRIDGE_URL` | adresse de la passerelle MT5 | `http://127.0.0.1:8787` |
| `FOREXIA_BRIDGE_TOKEN` | code d'appairage de la passerelle (outils `mt5_*`, source `broker`) | — |
| `FOREXIA_MCP_TOKEN` | jeton du mode HTTP (équivaut à `--token`) | — |

## Outils

| Outil | Rôle |
|---|---|
| `forexia_help` | Mode d'emploi : langage des règles, indicateurs, français compris, sources, méthode conseillée. **À appeler en premier.** |
| `list_presets` | Modèles fournis (RSI, MACD, moyennes, stochastique, Bollinger, SuperTrend, Donchian, Ichimoku…). |
| `translate_french` | Stratégie en français → règles techniques. |
| `validate_strategy` | Vérifie les règles, renvoie la description en français. |
| `run_backtest` | Backtest : statistiques, rentabilité mensuelle, motifs de sortie, trades (option). Enregistré dans l'historique. |
| `random_batch` | N backtests sur des périodes aléatoires (durée fixe, minimum ou maximum) + synthèse (médiane, % gagnant, pire / meilleur). |
| `enhance_strategy` | Le bouton « Améliorer » : suggestions testées, avec contrôle hors échantillon. |
| `apply_improvements` | Applique des suggestions (par id) et/ou une amélioration en français ; résultat avant / après et stratégie améliorée. |
| `test_other_pairs` | Robustesse sur d'autres paires, même période. |
| `recommend` | Synthèse de l'historique : meilleure stratégie, paire, court / long terme, retrait, levier, avec confiance. |
| `list_evaluations` / `clear_evaluations` | Historique des simulations de l'agent. |
| `save_strategy` / `list_strategies` / `delete_strategy` | Stratégies enregistrées de l'agent. |
| `generate_ea` | Expert Advisor MT5 (.mq5) de la stratégie (code renvoyé ou fichier écrit). |
| `mt5_status` / `mt5_deploy_ea` / `mt5_run_test` | Passerelle MT5 : terminaux, envoi + compilation de l'EA, testeur de stratégie MT5. |

### Décrire une stratégie (`strategy`)

- un modèle : `{ "preset": "macd" }` ;
- une stratégie enregistrée : `{ "saved": "Ma stratégie" }` ;
- du français : `{ "frenchText": "Acheter quand le RSI 14 passe au-dessus de 30. Vendre dans le cas inverse. Stop loss 50 pips." }` ;
- des règles : `{ "name": "…", "longEntry": "CROSS_UP(EMA(20), EMA(50)) AND ADX(14) > 25", "shortEntry": "…", "stopAtr": 2, "trailAtr": 3 }`.

Les champs fournis complètent ou remplacent la base (ex. `{ "preset": "rsi", "stopLossPips": 40 }`).

### Décrire le marché (`market`)

```json
{ "pair": "EUR/USD", "source": "online", "period": "2y",
  "capital": 10000, "leverage": 10, "exposurePct": 100, "spreadPips": 1,
  "sizing": "backtest", "commissionPerLot": 0,
  "withdraw": { "mode": "periodic", "every": "month", "type": "pct", "value": 2 } }
```

- `period` : `1m`, `2m`, `3m`, `6m`, `1y`, `2y` (jusqu'à aujourd'hui), ou `dateFrom` / `dateTo` (AAAA-MM-JJ).
- `source` : `online` (BCE, défaut), `synthetic` (marche aléatoire, tests), `csv` (`csvPath`), `broker`
  (passerelle MT5 : `symbol`, `timeframe` M15…D1 ; même calcul que le testeur MT5).

## Consigne à donner à l'agent (exemple)

> Tu as accès à Forexia par le serveur MCP « forexia ». Lis d'abord `forexia_help`.
> Objectif : trouver une stratégie robuste sur EUR/USD (données `online`), capital 10 000, levier 1:10.
> 1. Teste tous les modèles (`list_presets`, puis `run_backtest` sur 2 ans).
> 2. Pour les 3 meilleurs, lance `random_batch` (20 périodes, durée `min 6 mois`) et compare le résultat médian
>    et la part de périodes gagnantes.
> 3. Améliore le meilleur avec `enhance_strategy` → `apply_improvements` (suggestions confirmées hors
>    échantillon seulement), puis revalide avec `random_batch`.
> 4. Vérifie avec `test_other_pairs` et `recommend`.
> 5. Garde le meilleur avec `save_strategy` et donne-moi : les règles, le résultat médian, la part de périodes
>    gagnantes, le pire drawdown, et pourquoi tu le penses robuste. Pas de déploiement MT5 sans mon accord.

## Bon à savoir

- Les stratégies et l'historique de l'agent sont dans `~/.forexia-mcp` (fichiers JSON), séparés de ceux du site.
- Les résultats passés ne garantissent rien : l'agent doit privilégier une stratégie gagnante sur la plupart
  des périodes plutôt qu'un seul gros résultat, et tout EA doit être testé en démo avant un compte réel.
- `mt5_run_test` ferme MetaTrader 5 pendant le test si `closeTerminal` vaut `true`.
- Test du serveur : `npm run test:mcp`.
