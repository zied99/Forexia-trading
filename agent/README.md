# Projet « agent Forexia » pour Claude (cloud)

Ce dossier est le **modèle complet** du projet de l'agent. Copiez son contenu (fichiers cachés compris :
`.mcp.json`, `.gitignore`, `.forexia-agent`) à la racine d'un **nouveau dépôt GitHub**, par exemple `forexia-agent`.

| Fichier | Rôle |
|---|---|
| `CLAUDE.md` | **Les instructions de l'agent** (lues automatiquement à chaque session) : démarrage, outils, méthode, critères, livrables, limites. |
| `.mcp.json` | Déclare le serveur MCP Forexia (`forexia/mcp/forexia-mcp.js`) pour le projet. |
| `setup.sh` | Script d'installation de l'environnement cloud (clone Forexia avant le démarrage de l'agent). |
| `JOURNAL.md` | Mémoire de l'agent d'une session à l'autre. |
| `rapports/`, `strategies/`, `ea/`, `data/` | Livrables de l'agent et historique de ses simulations. |

L'outil lui-même n'est pas copié : l'agent clone `zied99/Forexia-trading` dans `forexia/` au démarrage
(ignoré par git).

## Mise en place (une seule fois)

1. **Forexia à jour sur GitHub.** Le serveur MCP est sur la branche `ccr-c3454898-ixmbff`. Fusionnez-la dans
   `main` (sinon l'agent utilise cette branche directement ; ça marche aussi).
2. **Nouveau dépôt** `forexia-agent` (privé de préférence) avec le contenu de ce dossier, puis poussez-le.
3. **Sur claude.ai/code**, connectez ce dépôt et créez (ou modifiez) son **environnement cloud** — menu de
   l'environnement dans la barre de titre de la session, puis *Edit* :
   - **Network access** : niveau *Limited*, et ajoutez dans *Allowed domains* :
     `api.frankfurter.dev` et `api.frankfurter.app` (cours BCE). Laissez cochée l'option des gestionnaires de paquets.
   - **Setup script** : collez le contenu de `setup.sh` (facultatif : l'agent sait aussi cloner Forexia lui-même,
     mais avec le script le serveur MCP est disponible dès le début de la session).
   - Si le dépôt Forexia est privé, ajoutez-le aussi aux dépôts de l'environnement.
   Documentation : https://code.claude.com/docs/en/cloud-environments
4. **Lancez une session** sur le dépôt `forexia-agent` avec une demande, par exemple :

> Trouve-moi une stratégie robuste sur EUR/USD pour un capital de 10 000 € au levier 1:10. Je veux retirer
> environ 2 % par mois. Horizon : moyen ou long terme. Teste tout ce qui est possible, livre le rapport, la
> stratégie et l'EA, et dis-moi franchement si rien n'est assez solide.

## Ce que l'agent peut faire depuis le cloud

Tout ce que vous faites dans Forexia, par outils (et, si besoin, en pilotant le site dans un navigateur) :
backtests, lots de périodes aléatoires, « Améliorer », section « Améliorations », prolonger / raccourcir /
découper / changer le capital, supports, résistances et lignes de tendance, retirer des conditions, tester
d'autres paires, recommandations, enregistrer les stratégies, générer l'EA MT5.

**Ce qu'il ne peut pas faire depuis le cloud** : utiliser MetaTrader 5 et la passerelle, qui tournent sur votre
PC (données du courtier, déploiement dans MT5, testeur MT5, calendrier économique). Pour cela, lancez l'agent
sur votre PC (Claude Code avec `.mcp.json` et `FOREXIA_BRIDGE_TOKEN`, cf. `mcp/README.md` de Forexia), ou
faites ces étapes vous-même dans le site (bouton « Déployer »).

Les EA livrés dans `ea/` se rechargent dans le site : Stratégie → « Importer un EA Forexia (.mq5) ».
