#!/usr/bin/env node
/**
 * v0.2.199 — PREUVE DÉDIÉE : SCRIPT D'INSTALLATION + DÉMARRAGE + COMPTE
 * ADMINISTRATEUR POUR LINUX/macOS
 * ==========================================================================
 * (Demande utilisateur : « ajouter le script installation et demarrage les
 *  2 portails et creation administarteur pour linux ».)
 *
 * NOUVEAU (v0.2.199) : INSTALLER-ET-DEMARRER-LINUX-MAC.sh — UN SEUL script
 * qui fait tout : vérifie Node.js, prépare le .env (base, secret, dossiers,
 * PORT / PORTAL_PORT des deux interfaces), sécurise les dossiers sensibles,
 * installe les dépendances, crée la base SQLite, construit le site si
 * nécessaire, CRÉE le compte ADMINISTRATEUR (superadministrateur — interactif
 * ou non interactif via SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD), puis
 * démarre les DEUX interfaces (administration RH/IT + portail employés).
 *
 * Le test vérifie le CODE RÉEL du script (sections, ordre des étapes,
 * conventions Task 89/92 sans npx, ports v0.2.198, création admin, démarrage
 * nohup) + la syntaxe bash.
 *
 * Usage : node scripts/test_v02199_installeur_linux.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const { spawnSync } = require("child_process");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

const src = fs.readFileSync("INSTALLER-ET-DEMARRER-LINUX-MAC.sh", "utf8");
function section(marqueur, fin = "\n# ----------") {
  const i0 = src.indexOf(marqueur);
  if (i0 < 0) throw new Error("Marqueur introuvable : " + marqueur);
  let i1 = src.indexOf(fin, i0 + marqueur.length);
  if (i1 < 0) i1 = src.length;
  return src.slice(i0, i1);
}
const envSec = section("touch .env");
const adminSec = section("# ---------- 7) Creer le compte ADMINISTRATEUR", "# ---------- 8)");
const startSec = section("# ---------- 8) Demarrer les DEUX interfaces");

console.log("== A — structure : Node + .env (base, secret, ports) ==");
check("A1 — shebang bash + exécution depuis le dossier du script",
  src.startsWith("#!/usr/bin/env bash") &&
  src.includes('cd "$(cd "$(dirname "$0")" && pwd)" || exit 1'), "");
check("A2 — Node vérifié + aides d'installation (Debian/Ubuntu + macOS)",
  src.includes("Node.js n'est pas installe") &&
  src.includes("setup_20.x") && src.includes("brew install node"), "");
check("A3 — .env : DATABASE_URL absolu réécrit, AUTH_SECRET créé UNE fois (base absente), CONSERVÉ si base existante (garde données)",
  envSec.includes("grep -v '^DATABASE_URL=' .env") &&
  envSec.includes("printf 'DATABASE_URL=file:%s/db/custom.db\\n'") &&
  envSec.includes("grep -q '^AUTH_SECRET=' .env.tmp") &&
  envSec.includes("node scripts/gen-secret.js") &&
  envSec.includes('if [ -f "${PROJECT_DIR}/db/custom.db" ]') &&
  envSec.includes("base existante, cle de chiffrement actuelle conservee") &&
  envSec.includes("scripts/chiffrer-base.js"), "");
check("A4 — lignes PORT=3000 / PORTAL_PORT=4001 AJOUTÉES seulement si absentes (v0.2.198)",
  envSec.includes("grep -q '^PORT=' .env.tmp") &&
  envSec.includes("printf 'PORT=3000\\n'") &&
  envSec.includes("grep -q '^PORTAL_PORT=' .env.tmp") &&
  envSec.includes("printf 'PORTAL_PORT=4001\\n'") &&
  envSec.includes("ligne PORT=3000 ajoutee") &&
  envSec.includes("ligne PORTAL_PORT=4001 ajoutee"), "");
check("A5 — exports : DATABASE_URL + PAIESAGE_STORAGE_DIR + AUTH_SECRET, dossiers créés",
  envSec.includes('export DATABASE_URL="file:${PROJECT_DIR}/db/custom.db"') &&
  envSec.includes('export PAIESAGE_STORAGE_DIR="${PROJECT_DIR}/storage/payslips"') &&
  envSec.includes("export AUTH_SECRET=") &&
  envSec.includes('mkdir -p "${PROJECT_DIR}/db" "${PROJECT_DIR}/storage/payslips"'), "");
check("A6 — ports lus depuis le .env (défauts 3000/4001) + consigne valeurs DIFFÉRENTES",
  src.includes('PORT="$(grep -E \'^PORT=\' .env') &&
  src.includes('PORTAL_PORT="$(grep -E \'^PORTAL_PORT=\' .env') &&
  src.includes('PORT="${PORT:-3000}"') && src.includes('PORTAL_PORT="${PORTAL_PORT:-4001}"') &&
  src.includes("valeurs DIFFERENTES"), "");

console.log("== B — sécurité + dépendances + base + build ==");
check("B1 — securiser-auto.js lancé silencieusement (ne bloque jamais)",
  src.includes("node scripts/securiser-auto.js >/dev/null 2>&1 || true"), "");
check("B2 — dépendances : contrôles prisma CLI + next + nodemailer (Task 89/92) + npm install",
  src.includes("node_modules/prisma/build/index.js") &&
  src.includes("node_modules/next/dist/bin/next") &&
  src.includes("node_modules/nodemailer/package.json") &&
  src.includes("npm install --no-audit --no-fund"), "");
check("B3 — AUCUN appel npx en commande (CLI locaux uniquement, aucun prompt)",
  !/^(\s*)npx\b/m.test(src) && !/(&&|\|\|)\s*npx\b/.test(src) &&
  !/^\s*npx /m.test(src.split("\n").filter(l => !/^\s*#/.test(l)).join("\n")), "");
check("B4 — prisma generate via le CLI LOCAL si @prisma/client absent",
  src.includes("node node_modules/prisma/build/index.js generate"), "");
check("B5 — base SQLite créée/mise à jour via le CLI LOCAL (db push)",
  src.includes("node node_modules/prisma/build/index.js db push"), "");
check("B6 — build conditionnel : verifier-build-a-jour.js + next build + copie des ressources",
  src.includes("node scripts/verifier-build-a-jour.js") &&
  src.includes("node node_modules/next/dist/bin/next build") &&
  src.includes("node scripts/copy-standalone-assets.js"), "");

console.log("== C — création du compte ADMINISTRATEUR ==");
check("C1 — INSTALLER_SANS_ADMIN=1 passe l'étape proprement",
  adminSec.includes('[ "${INSTALLER_SANS_ADMIN:-0}" = "1" ]') &&
  adminSec.includes("Creation de l'administrateur PASSEE"), "");
check("C2 — mode NON interactif : SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD → --creer",
  adminSec.includes('[ -n "${SUPERADMIN_EMAIL:-}" ] && [ -n "${SUPERADMIN_PASSWORD:-}" ]') &&
  adminSec.includes("--email \"${SUPERADMIN_EMAIL}\"") &&
  adminSec.includes('--nom "${SUPERADMIN_NOM:-Administrateur}"') &&
  adminSec.includes("--password \"${SUPERADMIN_PASSWORD}\""), "");
check("C3 — mode interactif : réservé à un vrai terminal ([ -t 0 ]), mot de passe masqué",
  adminSec.includes("if [ -t 0 ]; then") &&
  adminSec.includes("read -rs ADMIN_MDP") &&
  adminSec.includes("saisie masquee"), "");
check("C4 — interactive : e-mail/mot de passe vides → compte NON créé + commande de rattrapage",
  adminSec.includes("compte NON cree") &&
  adminSec.includes("node scripts/creer-superadmin.js"), "");
check("C5 — terminal non interactif SANS variables → création passée avec le mode d'emploi",
  adminSec.includes("[7/7] Terminal non interactif") &&
  adminSec.includes("SUPERADMIN_EMAIL=... SUPERADMIN_PASSWORD=... (relance)"), "");
check("C6 — échec de création = arrêt explicite (fail)",
  adminSec.includes('|| fail "La creation du compte administrateur a echoue'), "");
check("C7 — rôle : le compte créé est le SUPERADMINISTRATEUR (défaut du script creer-superadmin)",
  adminSec.includes("superadministrateur") || adminSec.includes("ADMINISTRATEUR (superadministrateur)"), "");

console.log("== D — démarrage des DEUX interfaces ==");
check("D1 — administration via scripts/start-prod.js + portail via scripts/portail-server.js (nohup)",
  startSec.includes("nohup node scripts/start-prod.js      > paiesage-admin.log   2>&1 &") &&
  startSec.includes("nohup node scripts/portail-server.js  > paiesage-portail.log 2>&1 &"), "");
check("D2 — PID capturés + commande d'arrêt affichée (kill)",
  startSec.includes("ADMIN_PID=$!") && startSec.includes("PORTAL_PID=$!") &&
  src.includes("kill $ADMIN_PID $PORTAL_PID"), "");
check("D3 — URLs sur les ports du .env, plus AUCUNE URL codée en dur",
  src.includes("http://localhost:${PORT}") && src.includes("http://localhost:${PORTAL_PORT}") &&
  src.includes("http://${LAN_IP}:${PORT}") &&
  !src.includes("http://localhost:3000") && !src.includes("http://localhost:4001"), "");
check("D4 — IP réseau local détectée (hostname -I / ipconfig en0)",
  src.includes("hostname -I | awk '{print $1}'") &&
  src.includes("ipconfig getifaddr en0"), "");
check("D5 — navigateur ouvert si disponible, tolérant à son absence (xdg-open / open)",
  src.includes('command -v xdg-open >/dev/null 2>&1') &&
  src.includes('command -v open >/dev/null 2>&1'), "");
check("D6 — rôles annoncés (login / sans login) + journaux + délai de première page",
  src.includes("(login, PID $ADMIN_PID)") && src.includes("(sans login, PID $PORTAL_PID)") &&
  src.includes("paiesage-admin.log") && src.includes("paiesage-portail.log") &&
  src.includes("construction a la volee"), "");

console.log("== E — syntaxe et portabilité réelles ==");
check("E1 — bash -n INSTALLER-ET-DEMARRER-LINUX-MAC.sh",
  spawnSync("bash", ["-n", "INSTALLER-ET-DEMARRER-LINUX-MAC.sh"]).status === 0, "");
check("E2 — fins de ligne LF (pas de CRLF, requis pour bash)",
  !/\r/.test(src), "");
check("E3 — CLI locaux appelés par chemin absolu node_modules (aucun téléchargement caché)",
  (src.match(/node node_modules\//g) || []).length >= 3, "");

setTimeout(() => {
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 200);
