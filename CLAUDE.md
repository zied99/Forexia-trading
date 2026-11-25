# Forexia — consignes pour Claude

## Recherche de stratégie ou de FX avec les outils « forexia » (serveur MCP)

Dès que l'utilisateur demande de chercher, tester, améliorer une stratégie ou de trouver un FX (plan
d'investissement), même sans taper `/fx` :

1. Appelle d'abord l'outil `fx_method`. Il indique le **guide de recherche choisi par l'utilisateur** dans la page
   Forexia (bouton « 🧭 Guide agent ») :
   - un guide est choisi (le sien ou la « Démarche Forexia ») : suis-le étape par étape, en choisissant toi-même
     chaque essai dans ce cadre ; ne t'en écarte que si l'utilisateur le demande, et dis-le ;
   - « liberté de l'agent » (par défaut) : cherche avec ta propre méthode et ton jugement.
2. Dans tous les cas : n'invente aucun chiffre (cite les sorties des outils), note tes déductions (`note_add`), fais
   des points d'étape, et privilégie ce qui gagne dans la plupart des époques à un gros résultat isolé.
3. Si l'utilisateur demande dans la conversation d'appliquer un autre guide : `agent_guide` (`select`).

4. Ce que l'utilisateur a mis en place (rappelé par `fx_method`, rubrique `notions`) :
   - seul le **résultat actuel** d'une simulation compte (une simulation modifiée garde son résultat d'origine pour
     comparaison) ;
   - chaque amélioration crée une **version** de la stratégie (`strategy_versions`, `revert_strategy`) ; vérifier une
     amélioration sur tout le batch (`resimulate_batch`) ;
   - avant un FX, si des simulations utilisent une ancienne version (`strategyOutdated`), **demander** avant de les mettre
     à jour ; l'EA d'un FX suit la dernière version (`fx_ea`, signaler `changesSinceFx`) ;
   - **risque** : compte aussi les baisses en cours de route ; **confiance** : si l'utilisateur a choisi une seule
     époque (ex. depuis 2020), la régularité se mesure année par année dans cette période — respecter ce choix ;
   - FX depuis un batch avec les mêmes filtres que la page (`era`, `yearFrom`, `yearTo`, `indexes`…).

Pour une question ponctuelle (un backtest, une explication, une liste), réponds directement.

## Développement du site

Site statique (`index.html`, `js/`, `css/`), moteur partagé avec le serveur MCP (`js/*.js`, `mcp/`). Tests :
`npm test`. Les réponses à l'utilisateur sont en français.
