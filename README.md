# Forexia 1.2 — Backtest de stratégies Forex

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
**Ma propre amélioration** (en haut de la fenêtre) : une idée écrite en français (« Acheter seulement si le RSI 14 est au-dessus
de 50. Vendre dans le cas inverse. », « Stop loss 40 pips »…), appliquée comme condition supplémentaire (ET), alternative (OU)
ou en remplacement de la règle ; elle est testée comme les suggestions (résultat seule, période précédente) puis combinée.

**Déployer** : génère un **Expert Advisor MetaTrader 5** (fichier `.mq5`) qui applique la stratégie sur votre compte.
Les indicateurs y sont recalculés avec exactement les mêmes formules que le backtest (vérifié par `npm run test:mql5`,
qui compile le calcul des signaux en C++ et le compare au moteur JavaScript). Réglages : unité de temps, taille des
positions (comme le backtest, lots fixes ou % de risque), plafond de lots, spread maximum. La fenêtre détaille
l'installation : copie dans `MQL5\Experts`, compilation dans MetaEditor, backtest dans le testeur de MT5, puis compte démo.

**Retrouver une stratégie** : « Importer un EA Forexia (.mq5) » relit un EA généré par Forexia (fichier téléchargé,
ou EA installé dans MT5 via la passerelle) et remet règles, texte, stop-loss, take-profit, paire, levier, période et
taille des positions dans le formulaire. La dernière simulation est aussi gardée automatiquement (Modèle →
*Récupération*), et chaque ligne du tableau d'évaluation peut être rechargée.

## Compte en ligne (Supabase)

Connexion par identifiant et mot de passe (« zied » devient `zied@forexia.app` pour Supabase) : stratégies, simulations
(avec leurs trades), évaluation, journal et dernière simulation sont enregistrés en ligne et retrouvés sur tout appareil.
Chaque compte ne voit que ses propres données (Row Level Security). « Continuer sans compte » garde les données dans le
navigateur ; elles sont versées dans le compte à la première connexion. La déconnexion retire les données de l'appareil.

Mise en place (une fois) : dans Supabase, *SQL Editor* → coller `supabase/schema.sql` → *Run* ; dans *Authentication →
Sign In / Providers*, désactiver « Confirm email ». L'adresse du projet et la clé publique sont dans `js/cloud.js`.

**Base de données** (bouton en haut de page) : avec la passerelle (1.4+), tout est enregistré dans une base SQLite
sur votre PC (`%APPDATA%\Forexia\forexia.db`) : stratégies, simulations (avec la liste de leurs trades) et un
journal de toutes les actions (enregistrements, imports, améliorations, stratégies aléatoires, EA téléchargés,
compilations, tests MT5 et comparaisons Forexia / MT5). Le navigateur garde une copie ; à chaque connexion, les deux
sont fusionnés. La fenêtre affiche le journal (filtrable) et permet d'exporter toute la base en JSON.

**Retrait fictif des gains** (section Marché et capital) : quand le compte atteint « capital × (1 + seuil %) », une part
du gain (100 % par défaut) est retirée et mise à l'abri, soit **dès que le seuil est atteint** (la position est clôturée à ce
niveau, par défaut), soit **à la clôture du trade** (le gain peut alors dépasser le seuil) ; le compte repart plus petit, les positions
suivantes aussi. Résultat, drawdown et gain moyen portent sur « compte + retraits » ; le graphique montre les deux courbes
et chaque retrait. Disponible dans les deux moteurs (standard et courtier MT5).

**Rentabilité mensuelle** (indicateur en haut, « Voir les détails » ouvre la fenêtre). Avec le retrait fictif, « Profit retiré » est
la somme retirée et la rentabilité mensuelle le montant retiré en moyenne par mois ; le résultat global (avec le capital restant)
reste indiqué. Fenêtre de détail : ce que la stratégie rapporte en moyenne par mois (en € et en % du
capital, rapporté à la durée réelle de la période), le montant retiré en moyenne par mois, les mois gagnants, le meilleur
et le pire mois, un graphique en barres mois par mois (étoile jaune les mois avec retrait) et le détail par mois. Le gain
d'un mois est la variation de « compte + retraits » sur ce mois. L'évaluation a une colonne « Par mois ».

**Annuler / rétablir** : Ctrl+Z annule la dernière action (changement de réglage, modèle chargé, stratégie aléatoire,
améliorations, import, enregistrement ou suppression de stratégie, suppression de simulations), Ctrl+Y ou Ctrl+Maj+Z la
rétablit. Dans une zone de texte, Ctrl+Z annule la frappe. Les annulations sont reportées dans la base du PC et le compte.

**Évaluation** (bouton en haut de page) : s'ouvre sur les simulations de la **stratégie en cours** (onglet « Stratégie en cours »,
compteur du bouton) ; l'onglet « Historique complet » contient toutes les simulations lancées (stratégie, paire, période,
données, levier, capital, résultat, gain moyen, trades, % gagnants, drawdown), **filtrable** par stratégie, recherche,
paire, source de données et résultat, avec une ligne de moyenne calculée sur les lignes affichées
(dont la **moyenne des gains moyens**) ; lignes supprimables, export CSV. Le **gain moyen** est l'écart entre le
capital moyen sur la période (ligne pointillée orange du graphique du capital) et le capital de départ.

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
- **Risque** : stop loss N pips, take profit / objectif N pips ; (1.2) « stop loss 2 ATR », « stop suiveur 30 pips » ou « 2 ATR »,
  « stop au prix d'entrée après 1 ATR », « fermer après 10 bougies », « pause de 5 bougies après 3 pertes de suite ».
- **(1.2)** ADX, +DI / -DI, SAR parabolique, SuperTrend, Donchian haut / bas, Keltner, point pivot, R1 / S1, Tenkan / Kijun,
  Heikin Ashi, englobante haussière / baissière, marteau, étoile filante, divergence haussière du RSI, « la pente de la moyenne
  mobile 50 est positive », et une unité de temps après un indicateur : « la moyenne mobile 50 en H4 », « le prix en hebdomadaire ».

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
| Outils | `CROSS_UP(a,b)`, `CROSS_DOWN(a,b)`, `PREV(x,n)`, `HIGHEST(x,n)`, `LOWEST(x,n)`, `SLOPE(x,n)` (pente sur n bougies) |
| Tendance (1.2) | `ADX(n)`, `PLUS_DI(n)`, `MINUS_DI(n)`, `PSAR(pas,max)`, `SUPERTREND(n,mult)`, `SUPERTREND_DIR(n,mult)` (1 / −1) |
| Ichimoku (1.2) | `TENKAN(9)`, `KIJUN(26)`, `SENKOU_A(9,26)`, `SENKOU_B(52,26)` (nuage décalé, sans regarder le futur) |
| Canaux (1.2) | `DONCHIAN_UPPER/MIDDLE/LOWER(n)`, `KELTNER_UPPER/MIDDLE/LOWER(n,mult,atr)` |
| Pivots (1.2) | `PIVOT`, `PIVOT_R1`, `PIVOT_R2`, `PIVOT_S1`, `PIVOT_S2` (journée précédente) |
| Bougies (1.2) | `HA_OPEN/HIGH/LOW/CLOSE` (Heikin-Ashi), `BULL_ENGULF`, `BEAR_ENGULF`, `HAMMER`, `SHOOTING_STAR` (1 si la figure apparaît) |
| Divergences (1.2) | `BULL_DIV(RSI(14), 14)`, `BEAR_DIV(osc, n)` |
| Temps (1.2) | `HOUR`, `MINUTE`, `WEEKDAY` (1 = lundi … 7), `DAY`, `MONTH` |
| Unité de temps supérieure (1.2) | `X@H4`, `EMA(50)@D1`, `CLOSE@W1` : calcul sur les bougies H4 / D1 / W1 **closes** (pas de biais d'anticipation) |
| Seuils relatifs (1.2) | `CLOSE - PREV(CLOSE, 1) > 1.5 * ATR(14)` |
| Opérateurs | `> < >= <= == != + - * /`, `AND` `OR` `NOT` (ou `ET` `OU` `NON`) |

## Hypothèses de simulation

- Signal calculé à la clôture d'une bougie, exécuté à l'**ouverture de la suivante** (pas de biais d'anticipation).
- Une position à la fois ; un signal d'entrée inverse ferme la position et la retourne.
- Taille de position : `capital × exposition % × levier` (les gains sont réinvestis), ou (1.2) lots fixes, ou % du capital risqué jusqu'au stop.
- **Gestion des trades (1.2)** : stop-loss / take-profit en pips ou en multiples d'ATR (ATR de la bougie qui précède l'entrée),
  stop suiveur et passage à l'équilibre mis à jour avec le meilleur prix de chaque bougie (de chaque bougie M1 avec les données
  du courtier ; à chaque tick dans l'EA), fermeture après N bougies, pause après N pertes consécutives, commission par lot.
- **Retrait fictif** : quand le gain atteint un seuil, ou **régulier** (chaque mois ou tous les X jours, 15 minimum) :
  un % du compte, une somme fixe, ou une part de l'excédent sur le capital de départ. Seule la marge libre est retirée :
  si une position bloque la marge, le retrait attend sa clôture. Chaque retrait est une étoile jaune sur les courbes.
- **Calendrier économique (1.2)** : entrées bloquées (ou positions fermées) de X minutes avant à Y minutes après une annonce
  à fort impact d'une des deux devises de la paire.
- Stop-loss / take-profit testés sur le plus haut / plus bas de la bougie ; si les deux sont touchés, le stop est retenu.
- **Margin call** : clôture forcée quand les fonds propres tombent sous 50 % de la marge utilisée (règle ESMA).
- Spread payé à chaque ouverture. Pas de swap / frais de financement overnight.
- Le P&L est calculé en rendement relatif du notionnel (approximation de la conversion de devise du compte).
- Les données BCE n'ont qu'un cours par jour : ouverture = clôture de la veille, pas de mèches.
  Pour un test plus fin des stops, importez un CSV OHLC.

## Améliorer (1.2)

Chaque suggestion est backtestée avant d'être proposée, puis contrôlée sur **jusqu'à 3 périodes précédentes** de même durée
qui n'ont pas servi à la choisir (contrôle « walk-forward ») ; elle est « confirmée » si elle gagne sur la majorité d'entre elles.

- **Note** : rendement − ½ drawdown, + régularité (part des mois gagnants), + facteur de profit, − pénalité sous 10 trades.
- **Tendance** : prix au-dessus d'une moyenne, pente de la moyenne, alignement EMA 20 > 50 > 200, force (ADX, DMI),
  régime sans tendance (ADX bas) pour les stratégies de retour à la moyenne, tendance de l'unité de temps supérieure.
- **Croisements de moyennes** : comme entrée supplémentaire, prix / moyenne, et comme confirmation avec une **grille de périodes**
  choisie de façon robuste (la moins bonne note entre la période testée et la précédente).
- **Gestion des trades** : stops en ATR, stop suiveur, passage à l'équilibre, durée maximale, filtre de volatilité,
  jours et heures, pause après des pertes, taille au risque, annonces économiques (si le calendrier MT5 est disponible).
- **Combinaison recommandée** : les suggestions confirmées cumulées une par une, gardées seulement si elles progressent ensemble.
- **Robustesse** : la stratégie (avec les améliorations cochées) testée sur 8 grandes paires, même période.

## Graphique : indicateurs et repères dessinés

- **+ Indicateur** (au-dessus du graphique des cours) : RSI, MACD, stochastique, ADX, ATR… s'affichent chacun dans un panneau
  sous la courbe ; moyennes, Bollinger, SuperTrend… se superposent aux cours. Le × retire un indicateur. « Autre (formule) » accepte
  toute expression (`RSI(9)`, `ATR(14) / CLOSE * 100`…).
- **Ligne de tendance** (2 clics) et **support / résistance** (1 clic) : les repères sont gardés par paire. Pour chacun, choisissez
  un rôle (acheter sur rebond, vendre sur rejet, cassure, filtre au-dessus / en dessous, objectif, stop), comparez le résultat
  affiché, puis **Ajouter à la stratégie** : la règle devient `CROSS_UP(CLOSE, 1.0850)`, `CLOSE > LINE(t1, prix1, t2, prix2)`…
  (`LINE` = la droite qui passe par les deux points, prolongée vers la droite), reprise telle quelle par l'EA MT5.

## Calendrier économique (1.2)

Le calendrier vient de **MetaTrader 5** : la passerelle (1.5 ou plus) compile et lance un petit script MQL5 (`ForexiaCalendar`)
qui l'exporte dans `…\MetaQuotes\Terminal\Common\Files\Forexia\calendar.csv` (heure du serveur ; devise ; importance ; nom).
Bouton **« Mettre à jour le calendrier depuis MT5 »** sous la case « Éviter les annonces économiques » (MT5 est fermé puis relancé brièvement).

- Forexia lit ce fichier pour ses simulations ; l'EA aussi **dans le testeur de stratégie** (qui n'a pas accès au calendrier).
- En compte démo ou réel, l'EA interroge directement le calendrier de MT5 (`CalendarValueHistory`).
- Avec des bougies journalières, une annonce bloque toute la journée.

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
et réessaient jusqu'à la fin de la bougie ; le détail intra-bougie est en **M1**, comme le mode « 1 minute OHLC » du testeur (données envoyées en colonnes et compressées). Le rapport de test MT5
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
js/trade.js         gestion des trades commune aux moteurs (ATR, stop suiveur, pause, annonces)
js/data.js          sources de données (API, CSV, simulation)
js/presets.js       modèles de stratégies
js/french.js        stratégies en français + stratégie aléatoire
js/enhancer.js      styles de trading et suggestions d'amélioration
js/mql5.js          génération de l'Expert Advisor MetaTrader 5
js/broker.js        backtest « courtier » identique à l'EA dans le testeur MT5
js/cloud.js         comptes et données en ligne (Supabase)
supabase/schema.sql tables et règles de sécurité à créer dans Supabase
js/chart.js         graphiques SVG
js/app.js           contrôleur de l'interface
tests/run-tests.js  tests du moteur : npm test
tests/mql5-check.js signaux de l'EA (compilés en C++) = signaux du backtest
tests/realism-check.js écart entre Forexia et de vraies bougies (export MT5…)
tests/bridge-check.py passerelle MT5 testée avec un faux MetaEditor / terminal
bridge/             passerelle locale Forexia <-> MetaTrader 5
```

> Outil éducatif : les performances passées ne préjugent pas des performances futures.

## Historique des versions

### 1.2 (novembre 2026)
- Indicateurs : ADX / DMI, SAR parabolique, SuperTrend, Ichimoku, Donchian, Keltner, pivots, Heikin-Ashi, figures de bougies,
  divergences, pente, variables de temps, règles multi-unités de temps (`X@H4`), seuils relatifs à l'ATR.
- Gestion des trades : stops / objectifs en ATR, stop suiveur, passage à l'équilibre, durée maximale, pause après des pertes,
  commission par lot, taille au risque ou en lots fixes dans le moteur standard — identiques dans l'EA MT5.
- Calendrier économique de MT5 (via la passerelle 1.5) : bloquer les entrées ou fermer les positions autour des annonces.
- Améliorer : tendance (pente, alignement, ADX, unité supérieure), croisements de moyennes (entrée, confirmation, grille robuste),
  gestion des trades, régime de marché, note fondée sur la régularité, combinaison recommandée, contrôle sur 3 périodes,
  test sur d'autres paires.
- 3 nouveaux modèles : SuperTrend + ADX, cassure de Donchian, Ichimoku Tenkan / Kijun.
- Retraits réguliers : chaque mois ou tous les X jours, en %, en somme fixe ou sur l'excédent.
