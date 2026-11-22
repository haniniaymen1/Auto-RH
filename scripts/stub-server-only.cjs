/**
 * Stub de contournement : permet aux scripts Node/tsx de charger le module
 * « server-only » (qui normalement refuse l'import hors React Server
 * Component). Utilisé UNIQUEMENT par les scripts de maintenance/E2E :
 *   NODE_OPTIONS="--require scripts/stub-server-only.cjs" npx tsx <script>
 */
const Module = require("module");
const fs = require("fs");
const path = require("path");
const vide = path.join(__dirname, "stub-vide.cjs");
if (!fs.existsSync(vide)) fs.writeFileSync(vide, "// stub vide\n");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "server-only") return vide;
  return originalResolve.call(this, request, ...args);
};
