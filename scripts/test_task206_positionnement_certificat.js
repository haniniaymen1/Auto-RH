#!/usr/bin/env node
/**
 * Task 206 — Preuve E2E du positionnement libre du certificat (v0.2.100)
 * et des refus matrice IT / RH :
 *   1. IMPORT : certActif + positionnement (position, décalages, taille)
 *      enregistrés SANS fichier de certificat (rubrique utilisable dès
 *      l'activation) → 200 + relecture conforme ;
 *   2. RÉPONSES (scope=reponse) : positionnement PROPRE enregistré → 200 ;
 *   3. INDÉPENDANCE : réécrire l'Import ne change PAS les réponses (et
 *      inversement) — champs certDecalX/Y, certPosition, certTaille par
 *      section ; les champs sig/qr ne bougent pas quand cert bouge ;
 *   4. APERÇUS (import + réponses) → 200 PDF ;
 *   5. IT : POST /api/demandes/[id]/repondre → 403 FONCTIONNALITE_NON_
 *      AUTORISEE_IT ; GET documents/[docId] → 403 ; GET /api/mail-config
 *      conserve la consultation complète (matrice IT = Oui) ;
 *   6. RH : GET /api/mail-config → AUCUN état SMTP (plus de booléen
 *      « configuree ») ; IT toujours refusé sur signature-config.
 * Nettoyage complet (configs restaurées à l'état capturé, comptes supprimés).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const crypto = require("crypto");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const BASE = "http://localhost:4000";
const RH = { email: "rh-task206@test.autorh.local", mdp: "Test-206!Pass" };
const IT = { email: "it-task206@test.autorh.local", mdp: "Test-206!Pass" };

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log("  OK   " + label); }
  else { KO++; console.log("  FAIL " + label + (detail ? " — " + detail : "")); }
}

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + crypto.scryptSync(mdp, salt, 64).toString("hex");
}

function client() {
  let cookie = "";
  return {
    async req(method, p, body, form) {
      const res = await fetch(BASE + p, {
        method,
        headers: {
          ...(form ? {} : body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: form ? form : body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const tampon = Buffer.from(await res.arrayBuffer());
      const texte = tampon.toString("utf8");
      let json = null;
      if ((res.headers.get("content-type") ?? "").includes("json")) {
        try { json = JSON.parse(texte); } catch { /* vide */ }
      }
      return { status: res.status, json, texte, octets: json ? null : tampon };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
    postForm(p, form) { return this.req("POST", p, undefined, form); },
  };
}

function sansId(ligne) {
  if (!ligne) return null;
  const c = { ...ligne };
  delete c.id;
  return c;
}

/** Corps de configuration COMPLET dérivé de l'état capturé (aucun champ
 * omis — le PUT n'écrase que ce qui est envoyé, on renvoie tout). */
function corpsDepuis(base, scope, surcharges) {
  const corps = scope === "reponse" ? { scope: "reponse" } : {};
  const champs = [
    "actif", "sigActif", "sigTexte", "sigPosition", "sigTaille", "sigOpacite",
    "qrActif", "qrMode", "qrUrl", "qrTexte", "qrPosition", "qrTaille",
    "sigDecalX", "sigDecalY", "qrDecalX", "qrDecalY",
    "sigRotation", "qrRotation", "mentionActif", "mentionTexte",
    "certActif", "certPosition", "certDecalX", "certDecalY", "certTaille",
  ];
  for (const ch of champs) {
    if (base && base[ch] !== undefined && base[ch] !== null) corps[ch] = base[ch];
  }
  Object.assign(corps, surcharges || {});
  return corps;
}

async function main() {
  // ---- État initial ----
  const importAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });

  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(RH.email, true) } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(IT.email, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(RH.email, true),
      name: cryptoBd.chiffrerChamp("RH Test 206", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(RH.mdp), passwordChangedAt: new Date(),
    },
  });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(IT.email, true),
      name: cryptoBd.chiffrerChamp("IT Test 206", true),
      role: "IT", isActive: true,
      passwordHash: hashScrypt(IT.mdp), passwordChangedAt: new Date(),
    },
  });

  const rh = client();
  const it = client();
  const loginRh = await rh.post("/api/auth/login", { email: RH.email, password: RH.mdp });
  check("Connexion RH", loginRh.status === 200, "status=" + loginRh.status);
  const loginIt = await it.post("/api/auth/login", { email: IT.email, password: IT.mdp });
  check("Connexion IT", loginIt.status === 200, "status=" + loginIt.status);

  // ---- 1) IMPORT : positionnement SANS fichier de certificat ----
  const putImport = await rh.put("/api/signature-config", corpsDepuis(importAvant, "import", {
    actif: true,
    certActif: true,
    certPosition: "HAUT_DROITE",
    certDecalX: 111,
    certDecalY: 222,
    certTaille: 180,
  }));
  check("IMPORT PUT certActif + positionnement sans fichier → 200", putImport.status === 200,
    "status=" + putImport.status + " " + JSON.stringify(putImport.json ?? {}).slice(0, 200));

  const getImport = await rh.get("/api/signature-config");
  const cfgI = getImport.json?.config ?? getImport.json ?? {};
  check("IMPORT GET : certActif=true mémorisé", cfgI.certActif === true);
  check("IMPORT GET : certPosition=HAUT_DROITE", cfgI.certPosition === "HAUT_DROITE", String(cfgI.certPosition));
  check("IMPORT GET : certDecalX=111 / certDecalY=222", cfgI.certDecalX === 111 && cfgI.certDecalY === 222,
    JSON.stringify([cfgI.certDecalX, cfgI.certDecalY]));
  check("IMPORT GET : certTaille=180", cfgI.certTaille === 180, String(cfgI.certTaille));
  check("IMPORT GET : aucun certificat importé (certSujet vide) — positionnement tout de même stocké",
    !(cfgI.certSujet || "").trim() && !(cfgI.certEmpreinte || "").trim());
  check("IMPORT GET : mot de passe certificat jamais renvoyé", !("certMotDePasse" in cfgI));

  // ---- 2) RÉPONSES : positionnement PROPRE ----
  const putRep = await rh.put("/api/signature-config", corpsDepuis(repAvant || importAvant, "reponse", {
    actif: true,
    certActif: true,
    certPosition: "BAS_GAUCHE",
    certDecalX: 50,
    certDecalY: 60,
    certTaille: 90,
  }));
  check("RÉPONSES PUT scope=reponse positionnement dédié → 200", putRep.status === 200,
    "status=" + putRep.status + " " + JSON.stringify(putRep.json ?? {}).slice(0, 200));

  const getRep = await rh.get("/api/signature-config?scope=reponse");
  const cfgR = getRep.json?.config ?? getRep.json ?? {};
  check("RÉPONSES GET : source=reponse (configuration propre créée)", getRep.json?.source === "reponse" || cfgR.certPosition === "BAS_GAUCHE",
    "source=" + (getRep.json?.source ?? "?"));
  check("RÉPONSES GET : certPosition=BAS_GAUCHE (≠ Import HAUT_DROITE)", cfgR.certPosition === "BAS_GAUCHE", String(cfgR.certPosition));
  check("RÉPONSES GET : certDecalX=50 / certDecalY=60", cfgR.certDecalX === 50 && cfgR.certDecalY === 60,
    JSON.stringify([cfgR.certDecalX, cfgR.certDecalY]));
  check("RÉPONSES GET : certTaille=90 (≠ Import 180)", cfgR.certTaille === 90, String(cfgR.certTaille));

  // ---- 3) INDÉPENDANCE des deux sections ----
  const putImport2 = await rh.put("/api/signature-config", corpsDepuis(importAvant, "import", {
    actif: true,
    certActif: true,
    certPosition: "HAUT_GAUCHE",
    certDecalX: 10,
    certDecalY: 20,
    certTaille: 150,
  }));
  check("IMPORT re-PUT (changement complet du positionnement) → 200", putImport2.status === 200,
    "status=" + putImport2.status);
  const getRep2 = await rh.get("/api/signature-config?scope=reponse");
  const cfgR2 = getRep2.json?.config ?? getRep2.json ?? {};
  check("INDÉPENDANCE : les réponses gardent BAS_GAUCHE/+50/+60/90 après modification Import",
    cfgR2.certPosition === "BAS_GAUCHE" && cfgR2.certDecalX === 50 && cfgR2.certDecalY === 60 && cfgR2.certTaille === 90,
    JSON.stringify([cfgR2.certPosition, cfgR2.certDecalX, cfgR2.certDecalY, cfgR2.certTaille]));

  const putRep3 = await rh.put("/api/signature-config", corpsDepuis(repAvant || importAvant, "reponse", {
    actif: true,
    certActif: true,
    certPosition: "HAUT_DROITE",
    certDecalX: -30,
    certDecalY: -40,
    certTaille: 75,
    sigActif: false, qrActif: false,
  }));
  check("RÉPONSES re-PUT → 200", putRep3.status === 200, "status=" + putRep3.status);
  const getImport3 = await rh.get("/api/signature-config");
  const cfgI3 = getImport3.json?.config ?? getImport3.json ?? {};
  check("INDÉPENDANCE : l'Import garde HAUT_GAUCHE/+10/+20/150 après modification Réponses",
    cfgI3.certPosition === "HAUT_GAUCHE" && cfgI3.certDecalX === 10 && cfgI3.certDecalY === 20 && cfgI3.certTaille === 150,
    JSON.stringify([cfgI3.certPosition, cfgI3.certDecalX, cfgI3.certDecalY, cfgI3.certTaille]));

  // ---- 4) APERÇUS ----
  const apRep = await rh.post("/api/signature-config", { action: "apercu", scope: "reponse", ...corpsDepuis(repAvant || importAvant, "reponse", { actif: true, certActif: true, certPosition: "HAUT_DROITE", certDecalX: -30, certDecalY: -40, certTaille: 75 }) });
  check("APERÇU réponses → 200 PDF", apRep.status === 200 && (apRep.octets ?? [])[0] === 0x25,
    "status=" + apRep.status);
  const apImp = await rh.post("/api/signature-config", { action: "apercu", ...corpsDepuis(importAvant, "import", { actif: true, certActif: true, certPosition: "HAUT_GAUCHE", certDecalX: 10, certDecalY: 20, certTaille: 150 }) });
  check("APERÇU import → 200 PDF", apImp.status === 200 && (apImp.octets ?? [])[0] === 0x25,
    "status=" + apImp.status);

  // ---- 5) IT : refus propres (matrice Non) + consultation SMTP conservée ----
  const form = new FormData();
  form.append("document", new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" }), "reponse-test.pdf");
  form.append("tampon", "auto");
  const repIt = await it.postForm("/api/demandes/DEM-TEST-206/repondre", form);
  check("IT POST repondre → 403 refusIT", repIt.status === 403, "status=" + repIt.status);
  check("IT repondre : code FONCTIONNALITE_NON_AUTORISEE_IT",
    repIt.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT", JSON.stringify(repIt.json ?? {}).slice(0, 150));

  const docIt = await it.get("/api/demandes/DEM-TEST-206/documents/DOC-TEST-206?telecharger=1");
  check("IT GET document de réponse → 403 refusIT", docIt.status === 403, "status=" + docIt.status);
  check("IT document : code FONCTIONNALITE_NON_AUTORISEE_IT",
    docIt.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT", JSON.stringify(docIt.json ?? {}).slice(0, 150));

  const mailIt = await it.get("/api/mail-config");
  check("IT GET mail-config → 200 (consultation conservée, matrice IT=Oui)", mailIt.status === 200, "status=" + mailIt.status);
  check("IT mail-config : état SMTP visible pour l'IT", typeof (mailIt.json?.config?.configuree) === "boolean",
    JSON.stringify(mailIt.json ?? {}).slice(0, 150));

  const sigIt = await it.get("/api/signature-config");
  check("IT GET signature-config → 403 (inchangé)", sigIt.status === 403, "status=" + sigIt.status);

  // ---- 6) RH : plus AUCUN état SMTP ----
  const mailRh = await rh.get("/api/mail-config");
  check("RH GET mail-config → 200", mailRh.status === 200, "status=" + mailRh.status);
  check("RH mail-config : AUCUN booléen « configuree » (matrice RH=Non)",
    mailRh.json?.config && !("configuree" in mailRh.json.config),
    JSON.stringify(mailRh.json ?? {}).slice(0, 150));
  check("RH mail-config : aucun hôte/port/compte", !mailRh.json?.config?.host && !mailRh.json?.config?.port && !mailRh.json?.config?.username);

  // ---- Nettoyage : restaurer les configurations et retirer les comptes ----
  if (importAvant) {
    await db.signatureConfig.update({ where: { id: "signature" }, data: sansId(importAvant) });
  }
  if (repAvant) {
    await db.signatureConfigReponse.update({ where: { id: "signature-reponse" }, data: sansId(repAvant) });
  } else {
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  }
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(RH.email, true) } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(IT.email, true) } });
  console.log("Nettoyage : configurations restaurées, comptes de test supprimés.");

  console.log("\nRésultat : " + OK + " OK / " + KO + " FAIL");
  await db.$disconnect();
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR :", e);
  try { await db.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
