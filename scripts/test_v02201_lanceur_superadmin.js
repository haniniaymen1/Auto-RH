#!/usr/bin/env node
/**
 * v0.2.201 — PREUVE DÉDIÉE : LANCEUR LINUX/macOS DE CRÉATION DU SUPERADMIN
 * ==========================================================================
 * (Demande utilisateur : « script de creation compte super admin n existe pas
 *  pour linux ». NOUVEAU CREER-SUPERADMIN-LINUX-MAC.sh : équivalent du
 *  CREER-SUPERADMIN-WINDOWS.bat — même menu interactif (état des comptes,
 *  créer un superadministrateur, promouvoir un compte existant), même gardes
 *  (Node présent, ZIP décompressé, projet installé) ; guide mis à jour aux
 *  trois endroits (installation Linux, compte administrateur, compte oubli).)
 *
 * Usage : node scripts/test_v02201_lanceur_superadmin.js
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

const CHEMIN = "CREER-SUPERADMIN-LINUX-MAC.sh";
const lanceur = fs.readFileSync(CHEMIN, "utf8");
const guide = fs.readFileSync("GUIDE-INSTALLATION-LINUX-WINDOWS.txt", "utf8");

console.log("== A — CREER-SUPERADMIN-LINUX-MAC.sh (NOUVEAU) ==");
check("A1 — lanceur présent à la racine, shebang bash, bit exécutable",
  fs.existsSync(CHEMIN) && lanceur.startsWith("#!/usr/bin/env bash") &&
  (fs.statSync(CHEMIN).mode & 0o111) !== 0, "");
check("A2 — syntaxe bash valide (bash -n réel)",
  spawnSync("bash", ["-n", CHEMIN]).status === 0, "");
check("A3 — les TROIS gardes du .bat Windows répliquées (Node / ZIP / installation) + lancement du menu",
  lanceur.includes("command -v node") &&
  lanceur.includes('scripts/creer-superadmin.js') &&
  lanceur.includes("node_modules/@prisma/client") &&
  lanceur.includes("exec node scripts/creer-superadmin.js") &&
  lanceur.includes("bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh"), "");
check("A4 — EXÉCUTION RÉELLE (option 1) : menu ouvert, état des comptes lu dans la base VIERGE",
  (() => {
    const r = spawnSync("bash", [CHEMIN], { input: "1\n", encoding: "utf8", timeout: 60000 });
    const out = String(r.stdout || "") + String(r.stderr || "");
    return r.status === 0 && out.includes("Ouverture du menu") &&
      out.toLowerCase().includes("aucun compte");
  })(), "");
check("A5 — équivalence Windows annoncée + messages d'erreur en ASCII (encodage sûr)",
  lanceur.includes("CREER-SUPERADMIN-WINDOWS.bat") &&
  !/[^\x09\x0A\x20-\x7E]/.test(lanceur), "");

console.log("== B — GUIDE mis à jour (v0.2.201) ==");
check("B1 — guide : lanceur cité aux TROIS endroits (installation Linux, compte admin, compte oubli)",
  (guide.match(/CREER-SUPERADMIN-LINUX-MAC\.sh/g) || []).length >= 3 &&
  guide.includes("(v0.2.201)") && guide.includes("NOUVEAU v0.2.201"), "");
check("B2 — guide : plus d'instruction directe « node scripts/creer-superadmin.js » (le lanceur la remplace)",
  !guide.includes("node scripts/creer-superadmin.js"), "");
check("B3 — guide : menu décrit (état des comptes / CREER / promouvoir / quitter)",
  guide.includes("promouvoir un compte existant") &&
  guide.includes("etat des comptes"), "");
check("B4 — guide : toujours ASCII strict + base VIERGE annoncée",
  !/[^\x09\x0A\x20-\x7E]/.test(guide) && guide.includes("VIERGE : AUCUN compte"), "");

console.log("== C — cohérence ==");
check("C1 — script JS sous-jacent intact (menu 4 options, saisie masquée)",
  fs.readFileSync("scripts/creer-superadmin.js", "utf8").includes("saisirMasque") &&
  fs.readFileSync("scripts/creer-superadmin.js", "utf8").includes("Voir l'état des comptes"), "");
check("C2 — .bat Windows inchangé (menu choix 2 = créer)",
  fs.readFileSync("CREER-SUPERADMIN-WINDOWS.bat", "latin1").includes("CREER un compte superadministrateur"), "");
check("C3 — installeur Linux : création du compte conservée (héritage 199)",
  fs.readFileSync("INSTALLER-ET-DEMARRER-LINUX-MAC.sh", "utf8").includes("read -rs ADMIN_MDP"), "");

setTimeout(() => {
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 300);
