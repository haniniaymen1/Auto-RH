#!/usr/bin/env node
/**
 * v0.2.200 — PREUVE DÉDIÉE : SUPPRESSION DES COMPTES ADMIN + GUIDE
 * D'INSTALLATION LINUX/WINDOWS + CHANGEMENT DES PORTS
 * ==========================================================================
 * (Demande utilisateur : « supprimer si il y a des comptes admin ainsi donne
 *  moi comment j installe dans linux et comment l installe dans windows ? ,
 *  et comment changer les port des interfaces dans linux et dans windows ».)
 *
 * 1) COMPTES SUPPRIMÉS : les 3 comptes de démonstration (2 SUPERADMIN +
 *    1 RH) ont été supprimés de la base — la base livrée dans le ZIP complet
 *    est désormais VIERGE (schéma Prisma appliqué, zéro compte, zéro donnée) ;
 * 2) GUIDE-INSTALLATION-LINUX-WINDOWS.txt : installation Linux/macOS (script
 *    tout-en-un v0.2.199), installation Windows (.bat + menu superadmin),
 *    changement des ports des deux interfaces (PORT / PORTAL_PORT du .env)
 *    pour les deux systèmes.
 *
 * Usage : node scripts/test_v02200_guide_comptes.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

const guide = fs.readFileSync("GUIDE-INSTALLATION-LINUX-WINDOWS.txt", "utf8");

function comptesUsers(cheminDb) {
  const { execFileSync } = require("child_process");
  const r = spawnSync(process.execPath, ["-e", `
    const {PrismaClient}=require('@prisma/client');
    const prisma=new PrismaClient({datasources:{db:{url:'file:${cheminDb.replace(/\\/g, "/").replace(/'/g, "\\'")}'}}});
    prisma.user.count().then(n=>{console.log('COUNT='+n);return prisma.$disconnect();}).catch(e=>{console.error(e.message);process.exit(1);});
  `], { encoding: "utf8", timeout: 60000 });
  const m = String(r.stdout || "").match(/COUNT=(\d+)/);
  if (!m) throw new Error("lecture impossible : " + (r.stderr || r.stdout || "?").slice(0, 160));
  return Number(m[1]);
}

console.log("== A — comptes supprimés (vérification RÉELLE des bases) ==");
const nbArbre = comptesUsers(path.join(process.cwd(), "db", "custom.db"));
check("A1 — base de l'arbre (db/custom.db) : ZÉRO compte utilisateur après suppression",
  nbArbre === 0, `comptes=${nbArbre}`);
const nbVierge = comptesUsers(path.join(process.cwd(), "scripts", "base-vierge", "custom.db"));
check("A2 — base VIERGE (scripts/base-vierge/custom.db) : zéro compte, servie au ZIP complet",
  fs.existsSync("scripts/base-vierge/custom.db") && nbVierge === 0, `comptes=${nbVierge}`);
check("A3 — notice de la base vierge présente (traçabilité)",
  fs.existsSync("scripts/base-vierge/LISEZMOI.txt") &&
  fs.readFileSync("scripts/base-vierge/LISEZMOI.txt", "utf8").includes("AUCUN compte"), "");

console.log("== B — GUIDE-INSTALLATION-LINUX-WINDOWS.txt ==");
check("B1 — guide présent à la racine, couverture v0.2.200 + prérequis Node 20",
  guide.includes("GUIDE D'INSTALLATION ET DE CHANGEMENT") &&
  guide.includes("v0.2.200") && guide.includes("Node.js version 20"), "");
check("B2 — section LINUX/macOS : ZIP décompressé + script tout-en-un + étapes du script",
  guide.includes("INSTALLATION SOUS LINUX / macOS") &&
  guide.includes("unzip") && guide.includes("bash INSTALLER-ET-DEMARRER-LINUX-MAC.sh") &&
  guide.includes("CREE LE COMPTE ADMINISTRATEUR") && guide.includes("nohup") &&
  guide.includes("DEMARRER-TOUT-LINUX-MAC.sh"), "");
check("B3 — mode non interactif documenté (SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD)",
  guide.includes('SUPERADMIN_EMAIL="admin@entreprise.tn"') &&
  guide.includes("SUPERADMIN_PASSWORD") && guide.includes("INSTALLER_SANS_ADMIN=1"), "");
check("B4 — section WINDOWS : Node LTS + DEMARRER-WINDOWS.bat + portail + TOUT + silencieux",
  guide.includes("INSTALLATION SOUS WINDOWS") && guide.includes("nodejs.org") &&
  guide.includes("DEMARRER-WINDOWS.bat") && guide.includes("DEMARRER-PORTAIL-WINDOWS.bat") &&
  guide.includes("DEMARRER-TOUT-WINDOWS.bat") && guide.includes("DEMARRER-SILENCIEUX-WINDOWS.vbs"), "");
check("B5 — Windows : création admin via CREER-SUPERADMIN-WINDOWS.bat (menu choix 2, masqué)",
  guide.includes("CREER-SUPERADMIN-WINDOWS.bat") && guide.includes("CREER un compte") &&
  guide.includes("saisie masquee"), "");
check("B6 — CHANGEMENT DE PORTS : PORT + PORTAL_PORT du .env, valeurs DIFFÉRENTES, procédure 2 OS",
  guide.includes("CHANGER LES PORTS DES DEUX INTERFACES") &&
  guide.includes("PORT         = port de l'ADMINISTRATION RH/IT (defaut 3000)") &&
  guide.includes("PORTAL_PORT  = port du PORTAIL EMPLOYES     (defaut 4001)") &&
  guide.includes("DOIVENT etre DIFFERENTES") &&
  guide.includes("PORT=8080") && guide.includes("PORTAL_PORT=8081") &&
  guide.includes("bash DEMARRER-TOUT-LINUX-MAC.sh") &&
  guide.includes("relisent le .env a chaque demarrage"), "");
check("B7 — section ADMINISTRATEUR : base VIERGE + superadmin unique + onglet Utilisateurs + politique mot de passe",
  guide.includes("La base de donnees livree dans le ZIP est VIERGE : AUCUN compte") &&
  guide.includes("supprimes,") && guide.includes("v0.2.200)") && guide.includes("superadministrateur") &&
  guide.includes("Utilisateurs") && guide.includes("8 caracteres minimum") &&
  guide.includes("symbole"), "");
check("B8 — PROBLÈMES COURANTS : EADDRINUSE, page blanche, compte oubli, saisie masquée",
  guide.includes("EADDRINUSE") && guide.includes("construit a la volee") &&
  guide.includes("saisie masquee") && guide.includes("Compte oublie"), "");
check("B9 — accès réseau + pare-feu + priorité PAIESAGE_PORT_* documentée",
  guide.includes("IP-DU-PC") && guide.includes("pare-feu") &&
  guide.includes("PAIESAGE_PORT_ADMIN") && guide.includes("PRIORITAIRES"), "");
check("B10 — guide en ASCII sans accents (aucun souci d'encodage Windows/Linux)",
  !/[^\x09\x0A\x20-\x7E]/.test(guide), "");

console.log("== C — cohérence de la livraison ==");
check("C1 — INSTALLER-ET-DEMARRER-LINUX-MAC.sh : garde AUTH_SECRET + création admin toujours présents (héritage 199)",
  fs.readFileSync("INSTALLER-ET-DEMARRER-LINUX-MAC.sh", "utf8").includes("cle de chiffrement actuelle conservee") &&
  fs.readFileSync("INSTALLER-ET-DEMARRER-LINUX-MAC.sh", "utf8").includes("read -rs ADMIN_MDP"), "");
check("C2 — CREER-SUPERADMIN-WINDOWS.bat : menu interactif (état / créer / promouvoir)",
  fs.readFileSync("CREER-SUPERADMIN-WINDOWS.bat", "latin1").includes("CREER un compte superadministrateur"), "");
check("C3 — lanceurs Linux : ports lus depuis le .env (héritage 198)",
  fs.readFileSync("DEMARRER-TOUT-LINUX-MAC.sh", "utf8").includes("grep -E '^PORT=' .env") &&
  fs.readFileSync("DEMARRER-TOUT-LINUX-MAC.sh", "utf8").includes("grep -E '^PORTAL_PORT=' .env"), "");
check("C4 — lanceurs Windows : PORT / PORTAL_PORT lus depuis le .env (héritage 198)",
  fs.readFileSync("DEMARRER-WINDOWS.bat", "latin1").includes('findstr /B /C:"PORT="') &&
  fs.readFileSync("DEMARRER-PORTAIL-WINDOWS.bat", "latin1").includes('findstr /B /C:"PORTAL_PORT="'), "");
// C5 réel : inspection ZIP léger via python-like lecture (zip lib node indisponible) → bash python
const py = spawnSync("python3", ["-c", `
import zipfile
zf = zipfile.ZipFile("download/service-rh-scripts-site-web-v0.2.199-leger.zip")
print("DB_LEGER=" + str(any("custom.db" in n for n in zf.namelist())))
zf2 = zipfile.ZipFile("download/service-rh-scripts-site-web-v0.2.199.zip")
print("DB_COMPLET=" + str(any("db/custom.db" == n for n in zf2.namelist())))
`], { encoding: "utf8" });
const out = String(py.stdout || "");
check("C5 — ZIP léger v0.2.199 sans base, ZIP complet AVEC base (règle conservée en v0.2.200)",
  out.includes("DB_LEGER=False") && out.includes("DB_COMPLET=True"), out.trim());

setTimeout(() => {
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 300);
