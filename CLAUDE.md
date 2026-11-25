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

Pour une question ponctuelle (un backtest, une explication, une liste), réponds directement.

## Développement du site

Site statique (`index.html`, `js/`, `css/`), moteur partagé avec le serveur MCP (`js/*.js`, `mcp/`). Tests :
`npm test`. Les réponses à l'utilisateur sont en français.
