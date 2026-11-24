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

**Base de données** (bouton en haut de page) : avec la passerelle (1.6+), tout est enregistré dans une base SQLite
sur votre PC (`%APPDATA%\Forexia\forexia.db`) : stratégies, simulations (avec la liste de leurs trades) et un
journal de toutes les actions (enregistrements, imports, améliorations, stratégies aléatoires, EA téléchargés,
compilations, tests MT5 et comparaisons Forexia / MT5). Le navigateur garde une copie ; à chaque connexion, les deux
sont fusionnés. La fenêtre affiche le journal (filtrable) et permet d'exporter toute la base en JSON.
Depuis la passerelle 1.6, **toutes les autres données** sont aussi enregistrées dans la base (table `kv`, une ligne par
type de donnée) et dans le compte en ligne : FX, batchs, époques, événements de marché ajoutés ou détectés, mécaniques
de retrait et leurs résultats, tracés sur les graphiques, dernière simulation. Chaque changement est envoyé dans la
seconde ; à la connexion, la version la plus récente l'emporte (et, sur un appareil jamais synchronisé, les listes
sont réunies).

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

## Batchs

Un **batch** est un lot de simulations enregistré ensemble, par exemple un lot de tests aléatoires.
- Chaque **lot de tests aléatoires crée automatiquement son batch** (rempli test après test) et l'évaluation s'ouvre
  dessus (« Voir toutes les simulations » pour revenir à l'ensemble). Bouton « 💾 Enregistrer un batch »
  dans la fenêtre Évaluation (enregistre les simulations affichées).
- Onglet **Batchs** de la fenêtre Évaluation : devise, période des simulations (« entre 6 mois et 1 an »), nombre de
  simulations, rendement moyen, probabilité de gain (le pourcentage du cercle), capital moyen final, drawdown moyen.
- **Recharger** remet la stratégie dans le formulaire et n'affiche que les simulations du batch (tableau, graphiques,
  recommandations) ; « Mettre à jour le batch » y enregistre leur état après prolongation ou amélioration.
- Renommer ✏️ et supprimer 🗑. Les batchs sont gardés dans ce navigateur.

## Resimuler avec un retrait

Dans la fenêtre Évaluation, à côté de « Recommandations », **💸 Resimuler avec un retrait** relance les simulations
affichées (mêmes dates, mêmes réglages) une fois sans retrait et une fois avec un retrait fictif des gains (au seuil,
ou régulier : chaque mois / tous les X jours, % du compte, somme fixe ou % de l'excédent). Elle montre :
- les barres de chaque simulation (pleine : sans retrait ; pointillé : avec retrait, compte + sommes retirées) avec la
  somme retirée au-dessus ;
- les indicateurs (total retiré, retrait moyen par mois, simulations avec retrait, résultat et drawdown moyens avant /
  après, capital de départ préservé) et un tableau par simulation ;
- la somme retirée par simulation et l'évolution moyenne mois par mois (compte et retraits cumulés) ;
- un verdict (effet sur les intérêts composés, rythme de retrait trop élevé…) ;
- **clic sur une barre** (ou sur une ligne du tableau) : détail de cette simulation — indicateurs, courbes mois par mois
  (compte avec et sans retrait, retraits cumulés) et retrait de chaque mois ; glisser sur plusieurs barres : moyenne de la
  sélection ; « Revenir à l'ensemble » ;
- une seule simulation choisie : le bas de la fenêtre passe à ses **mois** (somme retirée chaque mois, compte en fin
  de mois, part du compte retirée, résultat de chaque mois avec / sans retrait ; meilleur et pire mois, plus gros
  retrait, compte le plus bas…) ;
- « Sur l'ensemble » (ou la sélection) : somme retirée médiane, rente annuelle moyenne, mois avec un retrait, délai avant le premier
  retrait, extrêmes ; graphiques du compte final en % du capital, de la rente annuelle et du délai avant le premier retrait.
**Appliquer à** : liste des simulations affichées — clic : une seule ; glisser la souris : plusieurs à la suite ;
Maj (ou Ctrl) + clic : en ajouter ou retirer une à une ; « Tout le batch » / « Aucune » ; le bouton
« 💸 Resimuler avec un retrait » du panneau d'une barre ouvre la fenêtre sur cette simulation. Les résultats sont gardés
par mécanique et par simulation : rechoisir une mécanique enregistrée réaffiche directement ses graphiques, sans rien relancer ;
« Resimuler » ne calcule que les simulations qui n'ont pas encore de résultat.
**⚖️ Comparer** : choisit deux mécaniques enregistrées (A et B) et les compare sur les simulations choisies (celles
jamais calculées avec une mécanique sont relancées une fois) : verdict « meilleure méthode de retrait pour cette
stratégie » (équilibre entre le gain total compte + retraits, le risque et la préservation du capital), tableau de
critères avec le meilleur coché (total retiré, rente annuelle, résultat, gain après 1 an, compte final, capital préservé,
comptes sous 50 %, drawdown…), graphiques A (plein) / B (pointillé) par simulation, évolution moyenne mois par mois, et
la meilleure mécanique pour chaque simulation.
Les simulations du tableau ne sont pas modifiées. **💾 Enregistrer cette mécanique** la garde sous un nom : elle est
ensuite proposée dans la fenêtre et dans « Retrait fictif des gains » du formulaire (« Mécanique enregistrée »).

## FX : plans d'investissement

Un **FX** est un plan d'investissement à présenter à un client qui ne connaît pas le trading. Il s'enregistre depuis la
comparaison de deux mécaniques de retrait (« 💸 Resimuler avec un retrait » › « ⚖️ Comparer » › **💼 Enregistrer un FX**),
avec la mécanique gagnante. Le bouton **💼 FX** en haut de la page affiche les FX en cartes (nom modifiable sur la carte,
« Charger », 🗑). Montants calculés pour le **capital investi**, modifiable sur la carte (jamais sous le capital du plan, montant
minimum testé ; les montants sont proportionnels). Un **point blanc à glisser** sur la barre des scénarios
choisit un scénario (du pire au meilleur cas testé) : le gain au bout d'un an et le revenu mensuel suivent.

| Rubrique | Ce que ça représente | Calcul |
|---|---|---|
| Le principe | ce que fait la stratégie, en une phrase | type de stratégie (tendance, rebonds, mixte) et paire |
| Capital minimum | la somme à investir | capital des simulations |
| Durée recommandée | combien de temps rester investi | durée testée qui réussit le mieux (et plage testée) |
| Capital au bout d'un an | ce que le client a après 12 mois, en € et en %, avec retrait (compte + revenus touchés) et sans retrait | compte + revenus touchés à la fin du 12e mois ; « estimé » (annualisé) si les périodes testées durent moins d'un an |
| Revenu régulier | ce que le client touche par mois | mécanique de retrait gagnante de la comparaison |
| Chances de gain | sur 10 cas, combien finissent gagnants | part des simulations gagnantes (pictogramme) |
| Scénarios | « Au pire » (plus mauvais essai), « Si ça se passe mal » (1 essai sur 10 a fait moins bien), « Le plus souvent » (la moitié a fait mieux), « Si ça se passe bien » (1 essai sur 10 a fait mieux) | compte final + retraits |
| Évolution typique | trajectoire de 10 000 mois par mois | médiane, fourchette 1 cas sur 10 et revenus déjà touchés |
| Risque (1 à 7) | niveau de risque en un chiffre | pertes du scénario défavorable et du pire cas, baisses en cours de route |
| Pire moment en cours de route | baisse à supporter avant la fin | drawdown médian et maximal |
| Score de confiance | à quel point on peut se fier aux chiffres (explication au survol) | moyenne géométrique de trois probabilités : ratio de Sharpe « dégonflé » (Bailey et López de Prado) sur les rendements mensuels, test de Student sur le capital à un an (simulations indépendantes seulement), cohérence entre époques (Laplace) ; × 0,4 sur données simulées — voir `js/confidence.js` |
| Conditions | levier, spread, commission, données, sortie | réglages des simulations |
| Avertissement | mention de prudence | texte fixe |

Un FX construit sur des données simulées est signalé (« à refaire avec les cours réels MT5 avant de le présenter »).

## Chercheur de FX

Dans la fenêtre **💼 FX**, **⛏️ Chercheur de FX** : vous indiquez le budget, le risque maximum (1 à 7), la confiance
minimum, la durée du placement, le revenu souhaité (facultatif), le levier maximum et les manières de retirer
acceptées (excédent, somme fixe, % du compte, sans retrait). Le chercheur essaie **toutes les combinaisons** stratégies
(modèles + vos stratégies enregistrées) × leviers × manières de retirer, chacune sur les mêmes périodes passées tirées au
hasard (12, 20 ou 40 selon la recherche) de la durée choisie, sur la paire et la source de données de la page
d'accueil. Pour chaque combinaison il construit un FX complet (scénarios, risque, score de confiance — corrigé du
nombre de combinaisons essayées —, revenu) et le compare aux critères. Il propose les plans conformes, sinon les plus
proches avec les critères non atteints ; chacun peut être affiché en entier (« Voir le FX complet ») et enregistré.
**🧪 Création de stratégies** (option cochée par défaut) : avant la recherche, le chercheur crée des variantes de
chaque stratégie (filtre ADX, filtre EMA 200, pente EMA 50, filtres de volatilité, achats ou ventes seulement, stop
2 ATR, stop suiveur) et les teste sur les mêmes périodes ; les 8 meilleures, celles qui font mieux que leur modèle,
entrent dans la recherche. Une proposition qui utilise une stratégie créée l'indique (« 🧪 Stratégie créée par le
chercheur ») et propose « 💾 Enregistrer la stratégie » ; enregistrer le FX propose aussi d'enregistrer la stratégie.
Toutes les variantes testées comptent dans le nombre d'essais du score de confiance.
**Paire et levier** : la paire se choisit dans le chercheur (par défaut celle de la page d'accueil), ou « Toutes
les paires » pour chercher sur chacune (plus long). Le levier maximum va jusqu'à 1:500 ; au-delà de 1:30, un
avertissement rappelle la limite européenne pour les particuliers. **Durée** : en mois, n'importe quel nombre de 1 à
120 (raccourcis 3, 6, 12, 18, 24, 36).

## Événements de marché

Forexia connaît les grands événements du marché des changes depuis 1971 (Bretton Woods, accords du Plaza, mercredi
noir, lancement de l'euro, Lehman Brothers, crise de la dette, fin du plancher EUR/CHF, Brexit, Covid, hausses de taux
de 2022…), avec les devises concernées et leur effet. Ils apparaissent :
- sur le graphique des cours (losanges violets ◆, bouton « ◆ Événements » pour les masquer) ;
- dans le panneau « 📰 Événements pendant la période » des résultats ;
- sur la frise de l'analyse temporelle (numéros violets), dans « Ce qui s'est passé dans chaque époque » et dans
  l'analyseur d'époque.

**Détection automatique** : à chaque simulation sur des cours réels (MT5, BCE, CSV), Forexia cherche les mouvements
exceptionnels (une bougie quotidienne au moins 6 fois plus forte que d'habitude) et les ajoute aux événements
(« détecté »), rapprochés de l'événement connu le plus proche s'il y en a un. Les nouveaux sont signalés (🆕).
**« Tous les événements »** : filtrer par paire et par origine, renommer et expliquer un mouvement détecté, modifier ou
masquer un événement, ajouter les vôtres ; avec la passerelle MT5, les prochaines annonces à fort impact (14 jours).

## Analyse temporelle

Dans « Évaluation › Graphiques » (et pour chaque batch rechargé), la section **📅 Analyse temporelle** montre si la
stratégie marche mieux à certaines époques :
- frise : chaque simulation est un trait de sa date de début à sa date de fin, à la hauteur de son résultat ;
- résultat médian et part de gagnantes **par année** (année du milieu de la période) et **par époque**
  (avant 2000, 2000–2007, 2008–2012, 2013–2019, depuis 2020) ;
- verdict : **rupture** la plus nette (« marche nettement mieux depuis 2020 »), tendance avec les années,
  meilleure et pire époque, années sans simulation ;
- boutons pour **vérifier une époque** : lot de 10 tests sur l'époque faible ou forte, ou entre deux années au choix,
  et analyse de la pire simulation de l'époque faible.

**Époques** : par défaut, coupures en 2000 (arrivée de l'euro), 2008 (crise financière), 2013 (taux zéro et rachats
d'actifs) et 2020 (Covid, inflation, hausse des taux) ; une simulation compte dans l'époque du milieu de sa période.
Les années de coupure se modifient sous le graphique « Par époque » (ou « Couper à la rupture »).

**Vos époques** : glissez la souris sur la frise de l'analyse temporelle pour sélectionner une plage (arrondie au
mois), donnez-lui un nom, ou ajoutez une époque à la main (nom, du, au ; date vide = début ou aujourd'hui). Elles
s'affichent en bandes colorées sur la frise, se modifient (✏️) ou se suppriment (🗑), et remplacent les époques par
défaut dans les graphiques et l'analyseur d'époque (avec aussi « Tout sauf « … » » pour comparer une époque au reste).
« Découper par années » crée des époques à partir d'années de coupure ; « Revenir aux époques par défaut » les efface.

**🔬 Analyseur d'époque** : analyse toutes les époques affichées sous « Par époque » (vos époques, sinon celles par
défaut). Les simulations de chaque époque sont rechargées (8 par époque, réglable) pour mesurer le marché (direction du
prix par an, temps au-dessus de l'EMA 200, ADX, temps en tendance, netteté du mouvement, retour à la moyenne,
volatilité, chocs) et les trades (achats, ventes, en tendance ou non, en pips) de chaque époque. Il compare les époques
perdantes aux gagnantes pour classer « ce qui a fait la différence », montre les événements de chaque époque, et teste
des corrections (filtres ADX, EMA 200, pente, volatilité, un seul sens, stops) sur toutes les époques : « recommandée »
si elle améliore les époques perdantes sans dégrader les gagnantes ; une correction qui supprime presque tous les
trades est écartée. « Appliquer » relance les simulations, puis propose de l'ajouter à la stratégie.

**Plage du lot** : à côté de « Lot de tests aléatoires », « Plage : de … à … » limite les périodes tirées à ces années
(ex. 1997 à 2005). Vide : tout l'historique (MT5 : depuis 2015 par défaut ; BCE : depuis 1999). L'onglet Batchs montre
aussi chaque batch « dans le temps » (un point par simulation, même échelle pour tous).

## Analyseur

Le bouton **🔍 Analyseur** (à côté d'« Améliorer ») explique une simulation :
- **la plus forte baisse** (dates, trades en cause, plus gros trade perdant) et **pourquoi** : appel de marge,
  absence de stop, choc de volatilité, stratégie de tendance dans un marché sans tendance (ADX < 20) ou de retour
  à la moyenne dans une forte tendance (ADX ≥ 25), trade contre la tendance de fond (EMA 200), gain rendu au marché ;
- le **risque** : levier effectif (levier × exposition) et mouvement de prix qui vide le compte ;
- le **type de stratégie** et où elle gagne et perd (régime de marché, sens, tendance de fond, volatilité, durée) ;
- des **propositions testées** sur la même période (réduire le levier, stop ATR, filtre ADX, filtre EMA 200, un seul
  sens, filtre de volatilité, stop suiveur, stop au prix d'entrée, durée maximale, pause) avec « Appliquer », et la
  **meilleure combinaison**.

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

- **Unités de temps** (comme MT4 / MT5) : M1 … H4, D1, W1, MN au-dessus du graphique des cours. Avec les données du courtier,
  chaque unité est demandée directement à MT5 ; avec les cours BCE (journaliers), D1, W1 et MN sont regroupés à partir des jours.
- **Historique** : période testée, 1 an, 3 ans, 10 ans ou tout (depuis 1999 en BCE) ; la période testée reste grisée.
  Molette : zoom ; glisser : défiler ; ⟲ : revenir à l'historique choisi. Pratique pour tracer des tendances de long terme :
  un repère dessiné en W1 se retrouve au même endroit en D1 ou H4.
- **+ Indicateur** (au-dessus du graphique des cours) : RSI, MACD, stochastique, ADX, ATR… s'affichent chacun dans un panneau
  sous la courbe ; moyennes, Bollinger, SuperTrend… se superposent aux cours. Le × retire un indicateur. « Autre (formule) » accepte
  toute expression (`RSI(9)`, `ATR(14) / CLOSE * 100`…).
- **Ligne de tendance** (2 clics) et **support / résistance** (1 clic) : les repères sont gardés par paire. Pour chacun, choisissez
  un rôle (acheter sur rebond, vendre sur rejet, cassure, filtre au-dessus / en dessous, objectif, stop), comparez le résultat
  affiché, puis **Ajouter à la stratégie** : la règle devient `CROSS_UP(CLOSE, 1.0850)`, `CLOSE > LINE(t1, prix1, t2, prix2)`…
  (`LINE` = la droite qui passe par les deux points, prolongée vers la droite), reprise telle quelle par l'EA MT5.

## Évaluation : graphiques, recommandations et lots de tests

- **Lot de tests aléatoires** (section « Période de backtesting ») : N backtests de la stratégie, chacun sur une période tirée
  au hasard (avec la contrainte « au moins / au plus » choisie), tous enregistrés dans « Évaluation ». Bouton « Arrêter » en cours de lot.
- **Graphiques** : résultat de chaque simulation, puis résultat **médian** par stratégie, paire, durée de période, retrait,
  levier et source de données (la médiane n'est pas faussée par un résultat extrême ; la moyenne est dans l'info-bulle).
- **Long terme ? / Court terme ?** (onglet Graphiques) : « Prolonger » modifie les simulations rouges (ou vertes, ou toutes) — même ligne, même numéro —
  avec la même date de début et une fin repoussée de 3 mois, 6 mois, 1 an, 2 ans ou x mois ; « Découper » relance chaque
  simulation en tranches de 1, 2, 3, 6 ou x mois. Un rapport dit si les pertes se rattrapent avec le temps (long terme) ou si la
  stratégie gagne sur la plupart des tranches (court terme). « Budget ? » relance les simulations avec un autre capital de
  départ (montant fixe ou +x %), modifiées sur place comme « Prolonger ».
- **Recommandations** : meilleure stratégie, meilleure paire, court ou long terme, quel retrait (au seuil, régulier, aucun),
  quel levier, avec un niveau de confiance selon le nombre de simulations. Calcul local et transparent (médiane, part de
  simulations gagnantes, drawdown, moins de poids aux groupes peu testés), pas un modèle d'IA externe ni une garantie.
  Bouton « Réinitialiser les évaluations ».

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

## Serveur MCP (agents IA)

`mcp/forexia-mcp.js` donne à un agent IA (Claude Code, Claude Desktop…) l'accès à tout le moteur : backtests, lots
aléatoires, Améliorer, robustesse, recommandations, EA MT5, passerelle MT5. Installation et outils : [mcp/README.md](mcp/README.md).

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
