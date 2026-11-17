#!/bin/bash
# Script d'installation de l'environnement cloud (Claude) pour l'agent Forexia.
# Il s'exécute dans le dossier qui contient les dépôts de la session : on cherche le dépôt de l'agent
# (celui qui contient le fichier .forexia-agent) et on y clone l'outil Forexia, pour que le serveur MCP
# déclaré dans .mcp.json soit disponible dès le démarrage.
for d in */; do
  if [ -f "$d/.forexia-agent" ] && [ ! -d "$d/forexia/.git" ]; then
    git clone --depth 1 -b main https://github.com/zied99/Forexia-trading "$d/forexia" \
      || git clone --depth 1 -b ccr-c3454898-ixmbff https://github.com/zied99/Forexia-trading "$d/forexia" || true
  fi
done
