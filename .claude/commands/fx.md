---
description: Chercher un FX (plan d'investissement) avec les outils Forexia, selon le guide choisi dans la page
argument-hint: "[capital, risque max, durée, revenu souhaité, paire, levier max…]"
---

Cherche un FX (plan d'investissement) avec les outils MCP « forexia ».

Critères de l'utilisateur : $ARGUMENTS
(Ce qui n'est pas précisé : capital 10 000 €, risque 4/7 au plus, confiance ≥ 50, durée 12 mois, levier ≤ 1:30,
cours réels `online`.)

1. Appelle d'abord l'outil `fx_method` : il indique le **guide de recherche choisi par l'utilisateur** dans la page
   Forexia (bouton « 🧭 Guide agent »).
   - Un guide est choisi : suis-le, étape par étape.
   - « Liberté de l'agent » (par défaut) : cherche avec ta propre méthode et ton jugement.
2. Dans tous les cas : n'invente aucun chiffre (cite les outils), note tes déductions (`note_add`), fais un point
   d'étape régulier, et termine par un tableau des FX retenus (montants en €, revenu, risque, confiance, époques) avec
   ce qui a été rejeté et pourquoi.
