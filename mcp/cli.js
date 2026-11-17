#!/usr/bin/env node
/* Forexia en ligne de commande : les mêmes outils que le serveur MCP, sans client MCP.
 *   node mcp/cli.js list                                  liste des outils
 *   node mcp/cli.js help <outil>                          description et paramètres
 *   node mcp/cli.js <outil> '<arguments JSON>'            exécute (ex. run_backtest '{"strategy":{"preset":"macd"}}')
 *   node mcp/cli.js <outil> @fichier.json                 arguments lus dans un fichier
 * Sortie : JSON sur la sortie standard ; code de sortie 1 en cas d'erreur. */
'use strict';
const fs = require('fs');
const { TOOLS } = require('./forexia-mcp.js');

(async () => {
  const [name, raw] = process.argv.slice(2);
  if (!name || name === 'list') {
    console.log(JSON.stringify(TOOLS.map((t) => ({ name: t.name, description: t.description })), null, 1));
    return;
  }
  if (name === 'help') {
    const t = TOOLS.find((x) => x.name === raw);
    if (!t) { console.error('Outil inconnu : ' + raw); process.exit(1); }
    console.log(JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }, null, 1));
    return;
  }
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) { console.error('Outil inconnu : ' + name + ' (node mcp/cli.js list)'); process.exit(1); }
  let args = {};
  try { args = raw ? JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw) : {}; }
  catch (e) { console.error('Arguments JSON invalides : ' + e.message); process.exit(1); }
  try {
    console.log(JSON.stringify(await tool.handler(args), null, 1));
  } catch (e) {
    console.error('Erreur : ' + e.message);
    process.exit(1);
  }
})();
