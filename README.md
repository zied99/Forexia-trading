# Forexia — Backtest de stratégies Forex

Page web qui simule (*backtest*) une stratégie de trading Forex fondée sur des indicateurs techniques
(RSI, MACD, stochastique, moyennes mobiles, Bollinger…). Tout tourne dans le navigateur : pas de serveur,
pas d'installation.

## Lancer

- **En ligne (GitHub Pages)** : https://zied99.github.io/Forexia-trading/
- **En local** : ouvrir `index.html` dans le navigateur (double-clic).
- Ou servir le dossier : `npm start` puis http://localhost:8080

## Utilisation

1. **Stratégie** :
   - **écrire sa stratégie en français** dans la zone de texte, puis « Traduire en règles » (ou lancer
     directement le backtest, la traduction est automatique) ;
   - ou choisir un modèle (RSI, MACD, croisement de moyennes, stochastique + EMA 200, Bollinger, combinée) ;
   - ou cliquer sur **« Stratégie aléatoire »** : une stratégie est tirée au hasard et testée aussitôt.
     Si elle vous plaît, cliquez sur **« Enregistrer »** (en haut des résultats).
   - **Style de trading** : *Aucun* (réglages du modèle), *Scalping*, *Court terme*, *Moyen terme* ou *Long terme*.
     Le style règle les périodes des indicateurs et le stop-loss / take-profit des modèles et des stratégies
     aléatoires ; « Adapter ma stratégie » l'applique à une stratégie écrite à la main.
     Le scalping demande des données intraday (CSV en M1 à M15).
   Les stratégies enregistrées sont dans Modèle → *Mes stratégies* (stockées dans ce navigateur).
   L'enregistrement garde aussi la configuration (paire, levier, capital, exposition, spread, période ou dates,
   source des données) et le résultat du dernier backtest ; recharger la stratégie remet tout en place.
2. **Marché et capital** : paire de devises, levier (1:1 à 1:500), capital, exposition, spread,
   période : **1, 2, 3 ou 6 mois, 1 an, 2 ans**, ou **Dates** pour choisir librement le début et la fin du test
   (raccourcis 3 / 5 / 10 ans, année dernière, depuis janvier). Les cours BCE remontent à janvier 1999.
3. **Données** :
   - *Cours réels en ligne* : taux de référence journaliers de la BCE via l'API gratuite
     [Frankfurter](https://frankfurter.dev) (sans clé). En cas d'échec, la page bascule sur des données
     simulées et l'indique clairement.
   - *Fichier CSV* : vos propres cotations OHLC (export MT4/MT5, etc.), toute unité de temps.
     Colonnes `date, open, high, low, close` (en-tête facultatif, séparateur `,` `;` ou tabulation).
     La période est comptée à partir de la dernière date du fichier.
   - *Données simulées* : marche aléatoire reproductible, pour tester hors ligne.

**Améliorer** : après une simulation, ce bouton ouvre une fenêtre de suggestions (réglage des périodes
d'indicateurs, seuils des oscillateurs, filtre de tendance, confirmation RSI, règle de sortie, achats ou ventes
seulement, stop-loss, take-profit, levier). Chaque suggestion est backtestée sur les mêmes données et affichée
avec son résultat ; on en coche plusieurs, le résultat combiné s'affiche, puis « Appliquer et relancer ».
Attention à la sur-optimisation : vérifiez ensuite la stratégie sur une autre période.

**Déployer** : génère un **Expert Advisor MetaTrader 5** (fichier `.mq5`) qui applique la stratégie sur votre compte.
Les indicateurs y sont recalculés avec exactement les mêmes formules que le backtest (vérifié par `npm run test:mql5`,
qui compile le calcul des signaux en C++ et le compare au moteur JavaScript). Réglages : unité de temps, taille des
positions (comme le backtest, lots fixes ou % de risque), plafond de lots, spread maximum. La fenêtre détaille
l'installation : copie dans `MQL5\Experts`, compilation dans MetaEditor, backtest dans le testeur de MT5, puis compte démo.

Résultats : capital final, profit net, nombre de trades et taux de réussite, profit factor, drawdown max,
ratio de Sharpe, courbe du capital, cours avec les points d'entrée/sortie et les indicateurs,
statistiques détaillées et historique des trades (export CSV).

## Écrire sa stratégie en français

```
Acheter quand le RSI 14 passe au-dessus de 30 et que le prix est au-dessus de la moyenne mobile 200.
Vendre dans le cas inverse.
Sortir de l'achat quand le RSI dépasse 70.
Stop loss 50 pips, take profit 100 pips.
```

- **Actions** : acheter / achat / position longue, vendre / vente / short, sortir / fermer / clôturer
  (de l'achat, de la vente, ou les deux), « dans le cas inverse » pour la règle symétrique.
- **Indicateurs** : RSI, MACD, ligne de signal, histogramme du MACD, stochastique (%K, %D), moyenne mobile
  (simple, exponentielle, MM 50, MME 21), bandes de Bollinger (haute, basse, médiane), CCI, Williams %R, prix.
- **Conditions** : passe au-dessus / en dessous de, croise à la hausse / à la baisse, casse, est supérieur /
  inférieur à, est entre 40 et 60, zone de survente / surachat, sort de la zone de survente,
  positif / négatif, haussier / baissier ; reliées par « et » / « ou ».
- **Risque** : stop loss N pips, take profit / objectif N pips.

La page affiche « Ce que j'ai compris » et signale chaque phrase non comprise.

## Écrire une règle technique

```
CROSS_UP(RSI(14), 30)
CROSS_UP(MACD(12,26,9), MACD_SIGNAL(12,26,9)) AND CLOSE > EMA(200)
CROSS_UP(SMA(20), SMA(50))
STOCH_K(14,3,3) < 20 AND CROSS_UP(STOCH_K(14,3,3), STOCH_D(14,3,3))
CLOSE < BB_LOWER(20, 2) OR RSI(14) < 25
```

| Élément | Syntaxe |
|---|---|
| Prix | `CLOSE`, `OPEN`, `HIGH`, `LOW` |
| Moyennes mobiles | `SMA(n)`, `EMA(n)` — ou sur une autre série : `SMA(RSI(14), 9)` |
| RSI | `RSI(n)` |
| MACD | `MACD(f,s,sig)`, `MACD_SIGNAL(f,s,sig)`, `MACD_HIST(f,s,sig)` |
| Stochastique | `STOCH_K(k,d,lissage)`, `STOCH_D(k,d,lissage)` |
| Bollinger | `BB_UPPER(n,k)`, `BB_MIDDLE(n,k)`, `BB_LOWER(n,k)` |
| Autres oscillateurs | `CCI(n)`, `WILLR(n)`, `MOM(n)`, `ROC(n)`, `ATR(n)` |
| Outils | `CROSS_UP(a,b)`, `CROSS_DOWN(a,b)`, `PREV(x,n)`, `HIGHEST(x,n)`, `LOWEST(x,n)` |
| Opérateurs | `> < >= <= == != + - * /`, `AND` `OR` `NOT` (ou `ET` `OU` `NON`) |

## Hypothèses de simulation

- Signal calculé à la clôture d'une bougie, exécuté à l'**ouverture de la suivante** (pas de biais d'anticipation).
- Une position à la fois ; un signal d'entrée inverse ferme la position et la retourne.
- Taille de position : `capital × exposition % × levier` (les gains sont réinvestis).
- Stop-loss / take-profit testés sur le plus haut / plus bas de la bougie ; si les deux sont touchés, le stop est retenu.
- **Margin call** : clôture forcée quand les fonds propres tombent sous 50 % de la marge utilisée (règle ESMA).
- Spread payé à chaque ouverture. Pas de swap / frais de financement overnight.
- Le P&L est calculé en rendement relatif du notionnel (approximation de la conversion de devise du compte).
- Les données BCE n'ont qu'un cours par jour : ouverture = clôture de la veille, pas de mèches.
  Pour un test plus fin des stops, importez un CSV OHLC.

## Passerelle MetaTrader 5 (déploiement direct)

La fenêtre **Déployer** peut envoyer l'EA directement dans MT5 grâce à une petite passerelle locale
(`bridge/forexia_bridge.py`, Python 3 sans module supplémentaire) :

1. installer Python (python.org, cocher « Add python.exe to PATH ») ;
2. télécharger `bridge/forexia_bridge.py` et `bridge/demarrer-passerelle.bat` dans un même dossier,
   double-cliquer sur le `.bat` et laisser la fenêtre ouverte ;
3. dans Forexia → Déployer, coller le **code d'appairage** affiché (une seule fois).

« Déployer dans MetaTrader 5 » : dépose l'EA dans `MQL5\Experts\Forexia`, le **compile avec MetaEditor**
(erreurs affichées dans la page), lance si demandé le **testeur MT5** sur la même période et affiche
Forexia et MT5 côte à côte, puis peut **ouvrir l'EA sur un graphique** (MT5 est relancé avec un fichier
de configuration). MT5 doit être fermé pour le testeur et l'ouverture du graphique : la page le demande.

Sécurité : la passerelle n'écoute que `127.0.0.1`, n'accepte que la page Forexia et le code d'appairage,
n'écrit que dans les dossiers Forexia du terminal et n'exécute que MetaEditor et le terminal. L'EA refuse
de trader sur un compte réel tant que le paramètre « Autoriser le trading sur un compte RÉEL » est désactivé.
Test (faux MT5) : `python3 tests/bridge-check.py`.

## Données du courtier : simulation identique au testeur MT5

Source **« Mon courtier (MetaTrader 5) »** (nécessite la passerelle et le module Python `MetaTrader5`, installé
automatiquement par `demarrer-passerelle.bat`) : Forexia récupère dans MT5 les bougies du courtier (M15 à D1),
leur spread, des bougies plus fines (H1 pour du D1…), les caractéristiques du symbole (contrat, lots, swap)
et du compte (devise, stop-out), et le taux de conversion vers la devise du compte.

Le moteur `js/broker.js` applique alors exactement les règles de l'EA : achat à l'ask / vente au bid, lots
arrondis au pas du courtier, plafonnés et limités à 90 % de la marge libre, ordre annulé si le spread dépasse
le maximum, stops testés bougie fine par bougie fine, swaps (triples le mercredi), conversion en devise du
compte, stop-out. Les réglages de taille (comme le backtest, lots fixes, % de risque) sont repris par l'EA.
Après « Déployer dans MetaTrader 5 », un tableau **trade par trade** compare Forexia et le testeur MT5.
L'EA et Forexia **reportent un ordre** quand le spread dépasse le maximum (pic de la bascule de minuit, annonces)
et réessaient jusqu'à la fin de la bougie ; le détail intra-bougie est en M15 pour du D1. Le rapport de test MT5
contient un diagnostic (signaux, ordres reportés ou perdus pour spread, tailles trop petites, refus du courtier)
affiché à côté de celui de Forexia.

## Réalisme : se rapprocher de MetaTrader 5

Les cours BCE n'ont qu'**un prix par jour** (14 h 15), sans plus haut ni plus bas. Sans correction, un stop-loss
n'est touché que si l'écart d'un jour à l'autre le dépasse : les stops serrés semblent « gratuits » et les
résultats sont beaucoup trop optimistes.

- **Mèches estimées** (activé par défaut avec les cours BCE) : chaque bougie reçoit une amplitude égale à
  2 fois la variation moyenne des 20 dernières clôtures (valeur théorique d'une marche aléatoire, mesurée à
  1,9 à 2,0 sur de vraies bougies EUR/USD H1 et D1).
- Mesure sur 5 000 vraies bougies EUR/USD H1 et 200 stratégies avec stop-loss (`tests/realism-check.js`) :

  | Données | Écart de rendement | Écart du nombre de trades | Bon sens (gain/perte) |
  |---|---|---|---|
  | Un prix par bougie (BCE brut) | 87 pts | 19 % | 54 % |
  | Avec mèches estimées | 14 pts | 4 % | 83 % |

- **Le plus fiable : importer les bougies de votre courtier** (MT5 : *Affichage → Symboles → Barres →
  Exporter des barres*). Forexia lit directement ce format, reprend le spread médian et détecte l'unité de
  temps, qui est aussi reprise par l'EA.
- Spread par défaut adapté à chaque paire ; avertissement au-delà du levier 1:30 (plafond européen).
- « Améliorer » revérifie chaque suggestion sur la **période précédente** de même durée, pour écarter les
  améliorations dues au hasard.
- Vérifier le réalisme sur vos propres données : `node tests/realism-check.js export_mt5.csv GBP/USD`.

Restent des écarts inévitables : heure de clôture (14 h 15 BCE contre minuit chez le courtier), swap,
glissement à l'exécution.

## Structure

```
index.html          interface
css/style.css       styles (thème clair / sombre)
js/indicators.js    calcul des indicateurs
js/expr.js          langage de règles (analyse + évaluation)
js/backtest.js      moteur de simulation et statistiques
js/data.js          sources de données (API, CSV, simulation)
js/presets.js       modèles de stratégies
js/french.js        stratégies en français + stratégie aléatoire
js/enhancer.js      styles de trading et suggestions d'amélioration
js/mql5.js          génération de l'Expert Advisor MetaTrader 5
js/broker.js        backtest « courtier » identique à l'EA dans le testeur MT5
js/chart.js         graphiques SVG
js/app.js           contrôleur de l'interface
tests/run-tests.js  tests du moteur : npm test
tests/mql5-check.js signaux de l'EA (compilés en C++) = signaux du backtest
tests/realism-check.js écart entre Forexia et de vraies bougies (export MT5…)
tests/bridge-check.py passerelle MT5 testée avec un faux MetaEditor / terminal
bridge/             passerelle locale Forexia <-> MetaTrader 5
```

> Outil éducatif : les performances passées ne préjugent pas des performances futures.
