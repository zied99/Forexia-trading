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
   Les stratégies enregistrées sont dans Modèle → *Mes stratégies* (stockées dans ce navigateur).
   L'enregistrement garde aussi la configuration (paire, levier, capital, exposition, spread, période ou dates,
   source des données) et le résultat du dernier backtest ; recharger la stratégie remet tout en place.
2. **Marché et capital** : paire de devises, levier (1:1 à 1:500), capital, exposition, spread,
   période : **6 mois, 1 an, 2 ans**, ou **Dates** pour choisir librement le début et la fin du test
   (raccourcis 3 / 5 / 10 ans, année dernière, depuis janvier). Les cours BCE remontent à janvier 1999.
3. **Données** :
   - *Cours réels en ligne* : taux de référence journaliers de la BCE via l'API gratuite
     [Frankfurter](https://frankfurter.dev) (sans clé). En cas d'échec, la page bascule sur des données
     simulées et l'indique clairement.
   - *Fichier CSV* : vos propres cotations OHLC (export MT4/MT5, etc.), toute unité de temps.
     Colonnes `date, open, high, low, close` (en-tête facultatif, séparateur `,` `;` ou tabulation).
     La période est comptée à partir de la dernière date du fichier.
   - *Données simulées* : marche aléatoire reproductible, pour tester hors ligne.

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
js/chart.js         graphiques SVG
js/app.js           contrôleur de l'interface
tests/run-tests.js  tests du moteur : npm test
```

> Outil éducatif : les performances passées ne préjugent pas des performances futures.
