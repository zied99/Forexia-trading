# Serveur MCP Forexia

Donne à un agent IA (Claude Code, Claude Desktop ou tout client compatible MCP) l'accès complet au moteur
de Forexia : backtests, lots de périodes aléatoires, « Améliorer », robustesse sur d'autres paires,
recommandations, stratégies enregistrées, génération de l'EA MetaTrader 5 et, si la passerelle tourne,
données du courtier, déploiement et test dans MT5. Et toute la démarche « FX » de la page : batchs, comparaisons
temporelles, époques, analyseurs, retraits, FX, chercheur de FX, avec échange des résultats avec la page.

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
| `get_market_data` | Cours et indicateurs bougie par bougie (D1, W1, MN), pour « regarder le graphique ». |
| `find_levels` / `make_trend_line` | Supports, résistances, lignes de tendance (détectés ou tracés entre 2 points) → expressions pour les règles. |
| `edit_conditions` | Liste les conditions (ET / OU) et en retire (par chemin ou par texte, ex. toutes les `LINE(`). |
| `stress_test` | Prolonger, raccourcir, découper en tranches, changer le capital de départ. |
| `improve_across_periods` | Améliorations communes aux périodes perdantes / à fort impact, puis resimulation. |
| `mt5_status` / `mt5_deploy_ea` / `mt5_run_test` / `mt5_export_calendar` | Passerelle MT5 : terminaux, envoi + compilation de l'EA, testeur de stratégie MT5, calendrier économique. |

### Chercher un FX (plan d'investissement) comme un humain

Tout ce que vous faites dans la page pour trouver un FX : lancer des batchs, comparer les époques et les batchs,
comprendre les pertes, choisir la manière de retirer, le capital et la durée. Mêmes calculs que la page
(`js/fxcore.js`, `js/advisor.js`, `js/analyzer.js`, `js/events.js`, `js/confidence.js`).

| Outil | Rôle |
|---|---|
| `fx_method` | **À appeler en premier** : le guide de recherche choisi dans la page (bouton « 🧭 Guide agent » : votre guide, la Démarche Forexia, ou liberté de l'agent par défaut), les outils, les précautions. |
| `agent_guide` | Liste des guides, texte d'un guide, ou changement de guide demandé dans la conversation. |
| `modify_strategy` | Affiner pas à pas : ajouter un indicateur / une condition (ET, OU, aux deux entrées avec miroir pour les ventes), remplacer un réglage (`RSI(14)` → `RSI(10)`), retirer, stop / objectif / stop suiveur / break-even / durée max / pause, achats ou ventes seulement, style (scalping → long terme). |
| `vary_batch` | Faire varier **un** élément sur les mêmes périodes qu'un batch : levier, budget, durée en mois, exposition, taille de position, spread, paire, stratégie, retrait ; comparaison automatique. |
| `improve_batch` | « Améliorer » sur tout un batch, puis batch amélioré sur les mêmes périodes et comparaison. |
| `subset_batch` | Batch extrait d'un autre (époque, années, périodes perdantes…). |
| `import_ea` | Relit un EA Forexia (.mq5) : stratégie et réglages. |
| `resimulate_batch` / `restore_batch` | « 🔄 Resimuler » : un batch relancé avec la stratégie mise à jour (mêmes dates), comparé avant / après ; `replace` = « Garder », `restore_batch` = revenir aux résultats d'avant. |
| `strategy_versions` / `revert_strategy` | « 🧬 Versions » : ajouts et ajustements successifs d'une stratégie (+ / − / ~, simulations de chaque version) ; retour à une version. Journal partagé avec la page. |
| `batches_by_era` | « 📅 Analyse temporelle › Les batchs dans le temps » : chaque batch d'une stratégie, époque par époque ; époques où tous gagnent ou perdent. |
| `fx_simulations` / `fx_ea` | « 📂 Voir les simulations » d'un FX (recalculées en batch si besoin) et « ⬇ EA (.mq5) » du FX. |
| `run_batch` | Batch : une stratégie sur N périodes de `months` mois (ou `monthsList`), dans une plage `yearFrom`–`yearTo`, graine `seed` reproductible, périodes données (`periods`) ou **les mêmes qu'un autre batch** (`sameAs`) pour ne changer qu'une chose (levier, capital, stratégie, paire, retrait). Enregistré. |
| `list_batches` / `get_batch` / `rename_batch` / `delete_batch` | Batchs enregistrés (agent et, après `forexia_sync`, ceux de la page) : rendement médian, part gagnante, capital moyen, chaque simulation. |
| `compare_batches` | Batchs côte à côte, par époque, et période par période quand ils ont les mêmes périodes (qui gagne le plus souvent, écart médian), classement « régularité ». |
| `time_analysis` | Analyse temporelle : par année, par époque (avec les grands événements de marché), rupture, tendance avec les années, années non couvertes, verdict. |
| `get_eras` / `set_eras` | Époques de l'analyse (les vôtres après `forexia_sync`, sinon 2000 / 2008 / 2013 / 2020). |
| `market_events` | Événements du marché depuis 1971 et mouvements exceptionnels détectés (`detect`). |
| `analyze_simulation` / `apply_proposal` | L'Analyseur : d'où vient la baisse, où la stratégie gagne et perd, corrections ; test d'une correction sur une simulation ou tout le batch (`saveAsBatch`). |
| `era_analysis` | Analyseur d'époque : ce qui change entre époques perdantes et gagnantes, corrections testées époque par époque. |
| `simulate_withdrawal` / `compare_withdrawals` | « Resimuler avec un retrait » et « Comparer » : la meilleure manière de retirer sur les mêmes simulations. |
| `save_withdraw_mechanic` / `list_withdraw_mechanics` | Mécaniques de retrait enregistrées. |
| `build_fx` / `fx_projection` | FX à partir d'un batch et d'une mécanique : durée recommandée, scénarios en €, revenu, capital au bout d'un an avec / sans retrait, risque 1–7, score de confiance ; projection pour un capital et un scénario (le point à glisser). |
| `list_fx` / `get_fx` / `save_fx` / `rename_fx` / `delete_fx` | FX enregistrés ; `save_fx` garde un candidat de `mine_fx` (et sa stratégie créée). |
| `mine_fx` | Le chercheur de FX : budget, risque, confiance, durée en mois, revenu, levier jusqu'à 1:500, paire ou toutes, manières de retirer ; crée aussi des variantes de stratégies. |
| `note_add` / `note_list` | Carnet de déductions de l'agent, relu d'une itération à l'autre. |
| `forexia_sync` | Échange avec la page par la base de la passerelle MT5 (1.6) : `pull` récupère vos FX, batchs, époques, mécaniques, événements ; `push` y envoie ceux de l'agent (visibles dans la page). |

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

### En ligne de commande (sans client MCP)

`node mcp/cli.js list`, `node mcp/cli.js help run_backtest`, `node mcp/cli.js run_backtest '{"strategy":{"preset":"macd"}}'`
(ou `@arguments.json`) : mêmes outils, sortie JSON. Pratique pour un agent dans le cloud.

### Projet d'agent prêt à l'emploi

Le dossier [`agent/`](../agent/README.md) contient un projet complet pour un agent Claude dans le cloud
(instructions `CLAUDE.md`, `.mcp.json`, script d'installation).

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

### Tout ce que fait la page, côté agent

| Dans la page | Outils de l'agent |
|---|---|
| Choisir un modèle, écrire en français ou en règles, aide syntaxe | `list_presets`, `translate_french`, `validate_strategy`, `forexia_help` |
| Éditer les règles, ajouter / retirer des indicateurs, gestion des trades, style | `modify_strategy`, `edit_conditions` |
| Enregistrer / charger / supprimer une stratégie, importer un EA | `save_strategy`, `list_strategies`, `delete_strategy`, `import_ea` |
| Marché et capital, source des cours, spread, taille, news, MT5 | paramètre `market` de chaque outil |
| Lancer le backtest, graphiques, rentabilité mensuelle, trades | `run_backtest`, `get_market_data` |
| Dessiner supports / lignes de tendance | `find_levels`, `make_trend_line` |
| Prolonger, raccourcir, découper, autre capital | `stress_test` |
| Améliorer la stratégie (une simulation / plusieurs / un batch) | `enhance_strategy`, `apply_improvements`, `improve_across_periods`, `improve_batch` |
| Lancer un lot (plage d'années), enregistrer un batch, recharger | `run_batch`, `list_batches`, `get_batch`, `rename_batch`, `delete_batch`, `subset_batch` |
| Changer un élément et comparer (levier, budget, durée, paire…) | `vary_batch`, `run_batch` `sameAs`, `compare_batches` |
| Évaluation, historique, recommandations | `list_evaluations`, `clear_evaluations`, `recommend` |
| Analyse temporelle, époques, événements de marché | `time_analysis`, `get_eras`, `set_eras`, `market_events` |
| Analyseur, Appliquer à tout le batch, Analyseur d'époque | `analyze_simulation`, `apply_proposal`, `era_analysis` |
| Resimuler avec un retrait, mécaniques, comparer (aussi par époque) | `simulate_withdrawal`, `compare_withdrawals`, `save_withdraw_mechanic`, `list_withdraw_mechanics`, `vary_batch` `withdraw` |
| FX : enregistrer, cartes, capital, point à glisser, renommer | `build_fx`, `list_fx`, `get_fx`, `fx_projection`, `rename_fx`, `delete_fx` |
| Chercheur de FX | `mine_fx`, `save_fx` |
| Tester sur d'autres paires | `test_other_pairs`, `vary_batch` `pair` |
| EA MT5 : générer, déployer, tester, calendrier | `generate_ea`, `mt5_deploy_ea`, `mt5_run_test`, `mt5_status`, `mt5_export_calendar` |
| 🔄 Resimuler, Garder / Revenir / Retirer l'amélioration | `resimulate_batch`, `restore_batch`, `revert_strategy` |
| 🧬 Versions de la stratégie | `strategy_versions`, `revert_strategy` |
| 📅 Analyse temporelle (batchs dans le temps), écart entre simulations | `batches_by_era`, `time_analysis`, chiffres des batchs (`gapBetweenSimulations`) |
| FX : 📂 Voir les simulations, ⬇ EA, FX sans retrait | `fx_simulations`, `fx_ea`, `build_fx` avec `mechanic: "none"` |
| 🧭 Guide agent | `fx_method`, `agent_guide` |
| Base de données (passerelle) | `forexia_sync` (stratégies, FX, batchs, époques, mécaniques, événements) |

Restent propres à la page : compte cloud (connexion), export CSV / JSON, annuler (Ctrl+Z), affichage.

### Ce que l'agent sait des réglages de l'utilisateur

`fx_method` renvoie une rubrique `notions` (aussi dans `CLAUDE.md` et la Démarche Forexia) : seul le résultat actuel
d'une simulation compte ; versions de stratégie et retour (`strategy_versions`, `revert_strategy`, `resimulate_batch`) ;
mise à jour des simulations d'une ancienne version seulement avec l'accord de l'utilisateur (`strategyOutdated`) ; EA
d'un FX avec la dernière version (`fx_ea`, `changesSinceFx`) ; FX sur les résultats actuels, depuis un batch avec les
mêmes filtres que la page ; calcul du risque (baisses en cours de route) et de la confiance (régularité année par année
si une seule époque est choisie) ; respect des époques de l'utilisateur ; écart entre simulations.

### Guide de recherche (bouton « 🧭 Guide agent » de la page)

Dans la page, le bouton **🧭 Guide agent** ouvre la fenêtre des guides : vous pouvez en écrire plusieurs, mais **un
seul est appliqué** :
- **Liberté de l'agent** (par défaut) : il cherche avec sa propre méthode ;
- **Démarche Forexia** ([`mcp/guide-demarche.md`](guide-demarche.md)) : choix de la stratégie, ajout progressif
  d'indicateurs selon les constats, mêmes périodes pour chaque comparaison, confirmation sur des périodes neuves,
  levier / durée / budget, retraits réglés selon l'analyse temporelle ; « Copier dans un nouveau guide » pour la modifier ;
- **vos guides**, écrits librement.

L'agent lit le guide choisi au début de chaque recherche (`fx_method`), en direct par la base de la passerelle MT5
(`FOREXIA_BRIDGE_TOKEN`), sinon dans la dernière copie reçue par `forexia_sync`. Sans passerelle : « 📋 Copier pour
l'agent » sur le guide, puis collez-le dans la conversation.

### Commande `/fx` (Claude Code)

Dans une session Claude Code ouverte sur le dossier du projet (terminal ou onglet Code de Claude Desktop, session
locale), tapez `/fx` suivi de vos critères, par exemple `/fx capital 20000 €, risque 4/7, 12 mois, 150 €/mois` :
l'agent applique le guide choisi dans la page.

### Exemple : trouver un FX

> Tu as accès à Forexia par le serveur MCP « forexia ». Lis `fx_method`, puis `forexia_sync` (pull) pour voir
> mes batchs, mes époques et mes FX. Objectif : un FX pour 20 000 €, risque 4/7 au plus, revenu mensuel régulier.
> 1. Pour 3 ou 4 stratégies, `run_batch` de 30 périodes de 12 mois sur tout l'historique (cours `online`).
> 2. `time_analysis` de chacun ; `era_analysis` du meilleur ; teste les corrections recommandées (`apply_proposal`).
> 3. Sur les mêmes périodes (`sameAs`) : levier 1:5, 1:10, 1:20 ; durée 6, 12, 18 mois ; `compare_batches`.
> 4. `compare_withdrawals` sur le meilleur batch, puis `build_fx` avec la meilleure mécanique et `capital: 20000`.
> 5. Lance aussi `mine_fx` avec mes critères et vérifie ses propositions de la même façon.
> 6. Note chaque déduction (`note_add`). Garde le meilleur plan (`save=true`), `forexia_sync` push, et explique-moi
>    pourquoi : époques gagnées, confiance, pire cas, revenu.

## Bon à savoir

- Les stratégies, l'historique, les batchs, les FX, les époques, les mécaniques de retrait et le carnet de
  l'agent sont dans `~/.forexia-mcp` (fichiers JSON). `forexia_sync` les échange avec la page (passerelle 1.6,
  `FOREXIA_BRIDGE_TOKEN`) : la page les reprend en se reconnectant à la passerelle.
- Les résultats passés ne garantissent rien : l'agent doit privilégier une stratégie gagnante sur la plupart
  des périodes plutôt qu'un seul gros résultat, et tout EA doit être testé en démo avant un compte réel.
- `mt5_run_test` ferme MetaTrader 5 pendant le test si `closeTerminal` vaut `true`.
- Test du serveur : `npm run test:mcp`.
