# Forexia — consignes pour Claude

## Recherche de stratégie ou de FX avec les outils « forexia » (serveur MCP)

Dès que l'utilisateur demande de chercher, tester, améliorer une stratégie ou de trouver un FX (plan
d'investissement), même sans taper `/fx` :

1. Appelle d'abord l'outil `fx_method` et suis sa démarche, phase par phase (texte complet dans
   [`.claude/commands/fx.md`](.claude/commands/fx.md)) : reprendre l'existant, choisir la stratégie, affiner par
   constats successifs, régler levier / durée / budget, retraits selon l'analyse temporelle, FX.
2. Une seule variable à la fois, toujours comparée sur les mêmes périodes (`sameAs`, `vary_batch`), et confirmée
   sur des périodes neuves avant d'être gardée.
3. Note chaque déduction (`note_add`) et fais un point d'étape en fin de phase.
4. Tu choisis librement chaque essai, mais il doit partir d'un constat chiffré (sortie d'un outil). Ne saute une
   phase que si l'utilisateur le demande, et dis-le.

Pour une question ponctuelle (un backtest, une explication, une liste), réponds directement sans dérouler la démarche.

## Développement du site

Site statique (`index.html`, `js/`, `css/`), moteur partagé avec le serveur MCP (`js/*.js`, `mcp/`). Tests :
`npm test`. Les réponses à l'utilisateur sont en français.
