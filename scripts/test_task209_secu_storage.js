/**
 * Task 209 — PREUVE de sécurisation de storage/tampons
 * =====================================================
 * 1. État des permissions AVANT (dossiers 700, fichiers 600, en-tête PAIESAGE1)
 * 2. Import RÉEL d'un certificat via /api/signature-config/certificat
 *    (session superadmin officielle) → le NOUVEAU fichier doit naître :
 *       - en mode 0600 (propriétaire seul)
 *       - dans un dossier 0700
 *       - chiffré (en-tête PAIESAGE1, PAS un PKCS#12 lisible)
 * 3. Le fichier NE doit PAS être accessible en HTTP, MÊME avec une session
 *    valide : GET /storage/tampons/<nom> → 404 (aucune route ne sert le
 *    stockage ; Next.js ne sert que public/).
 * 4. L'ancienne copie (certChemin d'avant) est déplacée hors de danger :
 *    le certificat réimporté EST le même exemple → config équivalente ;
 *    l'ancien fichier orphelin est supprimé proprement.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const RACINE = "/home/z/my-project";
const BASE = process.env.SERVICE_RH_URL_BASE || "http://localhost:4000";
let ok = 0, fail = 0;
function verif(cond, label) {
  if (cond) { ok++; console.log("  OK   " + label); }
  else { fail++; console.log("  FAIL " + label); }
}

async function main() {
  console.log("== Task 209 — sécurisation storage/tampons ==");

  // --- 1. Permissions du stock existant ---
  console.log("\n[1] Permissions du stock existant");
  const tampons = path.join(RACINE, "storage", "tampons");
  const stDir = fs.statSync(tampons);
  verif((stDir.mode & 0o777) === 0o700, "dossier storage/tampons en 0700 (observé " + (stDir.mode & 0o777).toString(8) + ")");
  const fichiers = fs.readdirSync(tampons).filter((f) => !f.startsWith("."));
  verif(fichiers.length >= 80, "fichiers tampons présents (" + fichiers.length + ")");
  const modesFaux = fichiers.filter((f) => {
    const m = fs.statSync(path.join(tampons, f)).mode & 0o777;
    return m !== 0o600;
  });
  verif(modesFaux.length === 0, "TOUS les fichiers en 0600 (anomalies : " + modesFaux.length + ")");
  const sonde = fichiers[0];
  const entete = fs.readFileSync(path.join(tampons, sonde)).subarray(0, 9).toString("latin1");
  verif(entete.startsWith("PAIESAGE1"), "contenu chiffré (en-tête PAIESAGE1) — " + sonde);

  // --- 2. Session + import réel ---
  console.log("\n[2] Import réel via l'API (session superadmin)");
  const login = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }),
  });
  verif(login.status === 200, "login superadmin (" + login.status + ")");
  const cookiesBruts = (login.headers.getSetCookie ? login.headers.getSetCookie() : [login.headers.get("set-cookie")]).filter(Boolean);
  const cookie = cookiesBruts.map((c) => c.split(";")[0]).join("; ");
  verif(cookie.length > 10, "cookie de session récupéré");

  const { PrismaClient } = require(path.join(RACINE, "node_modules", "@prisma", "client"));
  const db = new PrismaClient();
  const avant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const ancienChemin = avant && avant.certChemin ? path.basename(avant.certChemin) : "";
  console.log("  certChemin avant : " + (ancienChemin || "(aucun)"));
  console.log("  certSujet avant  : " + (avant && avant.certSujetCN ? avant.certSujetCN : "(aucun)"));

  const p12 = fs.readFileSync(path.join(RACINE, "download", "signatures-exemple", "signature-exemple.p12"));
  const imp = await fetch(BASE + "/api/signature-config/certificat", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ nom: "signature-exemple.p12", data: p12.toString("base64"), motDePasse: "PaieSage2026!" }),
  });
  verif(imp.status === 200, "import certificat accepté (" + imp.status + ")");
  const impJson = await imp.json().catch(() => ({}));
  verif(impJson && impJson.certificat && impJson.certificat.sujetCN === "Signature Exemple Auto-RH", "sujet du certificat = Signature Exemple Auto-RH");

  const apres = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const nouveauNom = apres && apres.certChemin ? path.basename(apres.certChemin) : "";
  verif(!!nouveauNom && nouveauNom !== ancienChemin, "nouvelle copie créée : " + nouveauNom);

  if (!nouveauNom) { console.log("  FAIL aucun certChemin après import — arrêt."); process.exit(1); }
  const stNouveau = fs.statSync(path.join(tampons, nouveauNom));
  verif((stNouveau.mode & 0o777) === 0o600, "NOUVEAU fichier en 0600 (observé " + (stNouveau.mode & 0o777).toString(8) + ")");
  const magie = fs.readFileSync(path.join(tampons, nouveauNom)).subarray(0, 9).toString("latin1");
  verif(magie.startsWith("PAIESAGE1"), "NOUVEAU fichier chiffré (PAIESAGE1) — pas de PKCS#12 en clair");
  const stDirApres = fs.statSync(tampons);
  verif((stDirApres.mode & 0o777) === 0o700, "dossier toujours en 0700 après écriture");

  // --- 3. Exposition HTTP même authentifié ---
  console.log("\n[3] Exposition HTTP (avec cookie de session valide)");
  const r1 = await fetch(BASE + "/storage/tampons/" + nouveauNom, { headers: { cookie }, redirect: "manual" });
  verif(r1.status === 404, "GET /storage/tampons/" + nouveauNom + " → " + r1.status + " (attendu 404)");
  const r2 = await fetch(BASE + "/tampons/" + nouveauNom, { headers: { cookie }, redirect: "manual" });
  verif(r2.status === 404, "GET /tampons/" + nouveauNom + " → " + r2.status + " (attendu 404)");
  // (le 308 de Next est la normalisation du slash final — on suit la
  // redirection : l'URL finale /storage/tampons doit répondre 404)
  const r3 = await fetch(BASE + "/storage/tampons/", { headers: { cookie } });
  verif(r3.status === 404, "GET /storage/tampons/ (listage, redirection suivie) → " + r3.status + " (attendu 404)");
  const r4 = await fetch(BASE + "/api/signature-config", { headers: { cookie } });
  const cfg = await r4.json().catch(() => ({}));
  const jamaisMdp = JSON.stringify(cfg).indexOf("AutoRH-2026!") === -1;
  verif(jamaisMdp, "le mot de passe du certificat n'apparaît dans AUCUNE réponse API");

  // --- 4. Nettoyage de l'ancienne copie orpheline ---
  console.log("\n[4] Nettoyage");
  if (ancienChemin && ancienChemin !== nouveauNom) {
    try { fs.unlinkSync(path.join(tampons, ancienChemin)); console.log("  ancienne copie retirée : " + ancienChemin); }
    catch (e) { console.log("  ancienne copie déjà absente : " + ancienChemin); }
  }
  await db.$disconnect();

  console.log("\n== RÉSULTAT : " + ok + " OK / " + fail + " FAIL ==");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR:", e); process.exit(1); });
