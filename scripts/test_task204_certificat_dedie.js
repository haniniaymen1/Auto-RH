#!/usr/bin/env node
/**
 * Task 204 — PREUVE E2E « Certificat de signature électronique TOTALEMENT
 * DÉDIÉ aux Demandes / Réponses » (v0.2.99).
 *
 * Demande : « la configuration du certificat de signature électronique doit
 * être totalement séparée de celle utilisée pour l'Import… Le certificat, son
 * mot de passe ainsi que ses paramètres de positionnement doivent être gérés
 * séparément pour chaque section. »
 *
 * Vérifié contre l'administration réelle (port 4000) :
 *   1. Import d'un coffre PKCS#12 DANS L'IMPORT (mot de passe propre) →
 *      métadonnées enregistrées, mot de passe stocké chiffré (booléen seul,
 *      jamais la valeur en clair dans aucune réponse) ;
 *   2. Import d'un AUTRE coffre DANS LES RÉPONSES (autre mot de passe) →
 *      métadonnées DÉDIÉES enregistrées dans SignatureConfigReponse ;
 *   3. INDÉPENDANCE Import → Réponses : réimport + repositionnement dans
 *      l'Import ne changent AUCUN champ des réponses ;
 *   4. INDÉPENDANCE Réponses → Import : retrait du certificat dédié des
 *      réponses laisse l'Import INTACT ;
 *   5. Positionnement indépendant dans les deux sens (certDecalX/certPosition) ;
 *   6. APERÇU (POST action=apercu scope=reponse) : le bloc certificat du PDF
 *      porte le TITULAIRE des réponses, pas celui de l'Import ;
 *   7. TAMPON RÉEL (repondre, mode aperçu, tampon auto) : même preuve sur le
 *      document final ;
 *   8. CONTINUITÉ une seule fois : ligne réponses venue de la v0.2.98
 *      (certActif ON sans certificat dédié) → premier accès = copie unique
 *      des métadonnées « Import » (marqueur certHeriteImport), second accès =
 *      aucune nouvelle copie ;
 *   9. Mauvais mot de passe PKCS#12 sur l'import dédié → 400.
 *
 * Aucune donnée persistante : configurations sauvegardées/restaurées, demande
 * et compte RH de test supprimés, fichiers temporaires supprimés.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const BASE = "http://localhost:4000";
const EMAIL = "rh-task204cert@test.autorh.local";
const MDP_COMPTE = "Test-204Cert!Pass";
const TMP = "/tmp/task204cert";

let OK = 0, KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(mdp, salt, 64).toString("hex")}`;
}

function client() {
  let cookie = "";
  return {
    async req(method, p, body, brut) {
      const multipart = body instanceof FormData;
      const res = await fetch(BASE + p, {
        method,
        headers: {
          ...(multipart ? {} : brut ? { "Content-Type": brut.mime } : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: multipart ? body : brut ? brut.corps : body === undefined ? undefined : JSON.stringify(body),
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
  };
}

/** Génère un coffre PKCS#12 moderne (openssl 3.5, PBES2) avec CN distinct. */
function genererP12(nom, cn, motDePasse) {
  const cle = `${TMP}/${nom}.key`;
  const crt = `${TMP}/${nom}.crt`;
  const p12 = `${TMP}/${nom}.p12`;
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${cle}" -out "${crt}" -days 30 -subj "/CN=${cn}/O=Auto-RH Test" 2>/dev/null`);
  execSync(`openssl pkcs12 -export -inkey "${cle}" -in "${crt}" -name "${cn}" -out "${p12}" -passout pass:${motDePasse} 2>/dev/null`);
  return p12;
}

function textePdf(octets, nomBase) {
  fs.mkdirSync(TMP, { recursive: true });
  const chemin = `${TMP}/${nomBase}.pdf`;
  fs.writeFileSync(chemin, octets);
  return execSync(`pdftotext "${chemin}" - 2>/dev/null`).toString();
}

async function main() {
  const pdfTest = fs.readFileSync("test-data/payslips/Fiche_Paie_01_2025_EMP002.pdf");
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  // ---- sauvegardes pour restauration finale -----------------------------
  const importAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const repAvant = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });

  // ---- coffres de test (CN et mots de passe DISTINCTS par section) ------
  const p12Import = genererP12("import204", "Certificat Import 204", "MdpImport204");
  const p12Reponses = genererP12("reponses204", "Certificat Reponses 204", "MdpReponses204");
  const b64 = (f) => fs.readFileSync(f).toString("base64");

  // ---- compte RH temporaire + demande de test ---------------------------
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Task204Cert", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE), passwordChangedAt: new Date(),
    },
  });
  const reference = "DEM-TEST-204CERT";
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  const demande = await db.demandeAdministrative.create({
    data: {
      reference,
      type: "ATTESTATION_TRAVAIL",
      cin: cryptoBd.chiffrerChamp("12345678", true),
      statut: "EN_ATTENTE",
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ prenom: "Yosra", nom: "BEN SALAH" })),
    },
  });

  const c = client();
  const login = await c.post("/api/auth/login", { email: EMAIL, password: MDP_COMPTE });
  check("Connexion RH", login.status === 200, "status=" + login.status);

  // ---- 1) CERTIFICAT DE L'IMPORT (coffre + mot de passe PROPRE) ---------
  const putImport = await c.put("/api/signature-config", {
    actif: true, certActif: true, certPosition: "BAS_CENTRE", certTaille: 100,
    certFichier: b64(p12Import), certFichierNom: "import204.p12",
    certMotDePasse: "MdpImport204",
  });
  check("PUT Import (coffre + mot de passe) → 200", putImport.status === 200,
    `status=${putImport.status} erreur=${JSON.stringify(putImport.json?.error ?? "")}`);
  check("Import : titulaire = Certificat Import 204",
    String(putImport.json?.config?.certSujet ?? "").includes("Certificat Import 204"),
    JSON.stringify(putImport.json?.config?.certSujet ?? ""));
  check("Import : certMotDePasseEnregistre = true",
    putImport.json?.config?.certMotDePasseEnregistre === true,
    JSON.stringify(putImport.json?.config?.certMotDePasseEnregistre));
  check("Import : le mot de passe n'apparaît JAMAIS en clair",
    !putImport.texte.includes("MdpImport204"), "");

  const getImport1 = await c.get("/api/signature-config");
  check("GET Import : métadonnées + booléen seulement",
    getImport1.json?.config?.certMotDePasseEnregistre === true &&
    getImport1.json?.config?.certMotDePasse === undefined &&
    !getImport1.texte.includes("MdpImport204"), "");

  // ---- 2) CERTIFICAT DÉDIÉ DES RÉPONSES (autre coffre, autre mdp) -------
  const putRep = await c.put("/api/signature-config", {
    scope: "reponse", actif: true, sigActif: false, qrActif: false,
    mentionActif: true, certActif: true,
    certFichier: b64(p12Reponses), certFichierNom: "reponses204.p12",
    certMotDePasse: "MdpReponses204",
  });
  check("PUT réponses (coffre DÉDIÉ + mot de passe) → 200", putRep.status === 200,
    `status=${putRep.status} erreur=${JSON.stringify(putRep.json?.error ?? "")}`);
  check("Réponses : titulaire DÉDIÉ = Certificat Reponses 204",
    String(putRep.json?.config?.certSujet ?? "").includes("Certificat Reponses 204"),
    JSON.stringify(putRep.json?.config?.certSujet ?? ""));
  check("Réponses : certMotDePasseEnregistre = true",
    putRep.json?.config?.certMotDePasseEnregistre === true, "");
  check("Réponses : le mot de passe n'apparaît JAMAIS en clair",
    !putRep.texte.includes("MdpReponses204"), "");

  const getRep1 = await c.get("/api/signature-config?scope=reponse");
  check("GET réponses : certificat DÉDIÉ (Reponses 204) + mot de passe masqué",
    getRep1.json?.source === "reponse" &&
    String(getRep1.json?.config?.certSujet ?? "").includes("Certificat Reponses 204") &&
    getRep1.json?.config?.certMotDePasseEnregistre === true &&
    !getRep1.texte.includes("MdpReponses204"), "");

  // ---- 3) INDÉPENDANCE Import → Réponses --------------------------------
  const p12Import2 = genererP12("import204b", "Certificat Import 204 v2", "MdpImport204");
  const putImport2 = await c.put("/api/signature-config", {
    actif: true, certActif: true, certPosition: "HAUT_DROITE", certTaille: 150, certDecalX: 222,
    certFichier: b64(p12Import2), certFichierNom: "import204b.p12",
    certMotDePasse: "MdpImport204",
  });
  check("Réimport Import v2 + repositionnement → 200", putImport2.status === 200, "status=" + putImport2.status);
  const getRep2 = await c.get("/api/signature-config?scope=reponse");
  check("INDÉPENDANCE Import→Réponses : titulaire des réponses inchangé",
    String(getRep2.json?.config?.certSujet ?? "").includes("Certificat Reponses 204"),
    JSON.stringify(getRep2.json?.config?.certSujet ?? ""));
  check("INDÉPENDANCE Import→Réponses : fichier dédié inchangé",
    getRep2.json?.config?.certFichierNom === "reponses204.p12",
    JSON.stringify(getRep2.json?.config?.certFichierNom));
  check("INDÉPENDANCE Import→Réponses : mot de passe dédié inchangé (booléen)",
    getRep2.json?.config?.certMotDePasseEnregistre === true, "");

  // ---- 4) INDÉPENDANCE Réponses → Import (retrait dédié) ----------------
  const putRetrait = await c.put("/api/signature-config", {
    scope: "reponse", actif: true, certActif: true, certFichier: "", certFichierNom: "",
  });
  check("Retrait du certificat DÉDIÉ des réponses → 200", putRetrait.status === 200, "status=" + putRetrait.status);
  const getImport3 = await c.get("/api/signature-config");
  check("INDÉPENDANCE Réponses→Import : l'Import garde son certificat v2",
    String(getImport3.json?.config?.certSujet ?? "").includes("Certificat Import 204 v2") &&
    getImport3.json?.config?.certFichierNom === "import204b.p12",
    JSON.stringify(getImport3.json?.config?.certSujet ?? ""));
  check("INDÉPENDANCE Réponses→Import : mot de passe Import toujours enregistré",
    getImport3.json?.config?.certMotDePasseEnregistre === true, "");
  const getRep3 = await c.get("/api/signature-config?scope=reponse");
  check("Réponses sans certificat dédié : métadonnées vidées",
    getRep3.json?.config?.certFormat === "" && getRep3.json?.config?.certEmpreinte === "" &&
    getRep3.json?.config?.certMotDePasseEnregistre === false, "");

  // ---- restauration du certificat dédié des réponses --------------------
  const putRepBis = await c.put("/api/signature-config", {
    scope: "reponse", actif: true, certActif: true,
    certFichier: b64(p12Reponses), certFichierNom: "reponses204.p12",
    certMotDePasse: "MdpReponses204",
  });
  check("Réimport du certificat dédié des réponses → 200", putRepBis.status === 200, "status=" + putRepBis.status);

  // ---- 5) POSITIONNEMENT indépendant dans les deux sens -----------------
  await c.put("/api/signature-config", {
    scope: "reponse", actif: true, certActif: true,
    certDecalX: 111, certPosition: "HAUT_GAUCHE", certTaille: 130,
  });
  await c.put("/api/signature-config", { actif: true, certActif: true, certDecalX: 222, certPosition: "HAUT_DROITE" });
  const getRep4 = await c.get("/api/signature-config?scope=reponse");
  const getImport4 = await c.get("/api/signature-config");
  check("Positionnement : réponses = +111 / HAUT_GAUCHE",
    getRep4.json?.config?.certDecalX === 111 && getRep4.json?.config?.certPosition === "HAUT_GAUCHE",
    `decalX=${getRep4.json?.config?.certDecalX} position=${getRep4.json?.config?.certPosition}`);
  check("Positionnement : Import = +222 / HAUT_DROITE",
    getImport4.json?.config?.certDecalX === 222 && getImport4.json?.config?.certPosition === "HAUT_DROITE",
    `decalX=${getImport4.json?.config?.certDecalX} position=${getImport4.json?.config?.certPosition}`);

  // ---- 6) APERÇU : le bloc certificat porte le titulaire DÉDIÉ ----------
  const ap = await c.post("/api/signature-config", {
    action: "apercu", scope: "reponse",
    actif: true, sigActif: false, qrActif: false, mentionActif: true,
    certActif: true, certPosition: "BAS_CENTRE", certTaille: 100,
  });
  check("Aperçu réponses → 200 PDF", ap.status === 200 &&
    Buffer.isBuffer(ap.octets) && ap.octets.subarray(0, 4).toString() === "%PDF", "status=" + ap.status);
  const tApercu = textePdf(ap.octets ?? Buffer.alloc(0), "apercu204");
  check("APERÇU : bloc certificat = titulaire DÉDIÉ (Reponses 204)",
    tApercu.includes("Certificat Reponses 204"), "");
  check("APERÇU : aucun titulaire de l'Import dans le bloc",
    !tApercu.includes("Certificat Import 204"), "");

  // ---- 7) TAMPON RÉEL (repondre, auto) : même preuve --------------------
  const form = new FormData();
  form.append("document", new Blob([pdfTest], { type: "application/pdf" }), "reponse.pdf");
  form.append("mode", "apercu");
  form.append("tampon", "auto");
  const rep = await c.post(`/api/demandes/${demande.id}/repondre`, form);
  check("repondre (aperçu, auto) → 200 PDF", rep.status === 200 &&
    Buffer.isBuffer(rep.octets) && rep.octets.subarray(0, 4).toString() === "%PDF", "status=" + rep.status);
  const tReel = textePdf(rep.octets ?? Buffer.alloc(0), "reel204");
  check("TAMPON RÉEL : bloc certificat = titulaire DÉDIÉ (Reponses 204)",
    tReel.includes("Certificat Reponses 204"), "");
  check("TAMPON RÉEL : aucun titulaire de l'Import",
    !tReel.includes("Certificat Import 204"), "");

  // ---- 8) CONTINUITÉ (une seule fois) : ligne venue de la v0.2.98 -------
  // Simulation : certificat dédié retiré + marqueur non posé (état v0.2.98),
  // l'Import possède un certificat → le premier accès copie les métadonnées.
  await db.signatureConfigReponse.update({
    where: { id: "signature-reponse" },
    data: {
      certFormat: "", certFichierNom: "", certChemin: "", certSujet: "",
      certEmetteur: "", certSerie: "", certValideDu: null, certValideAu: null,
      certEmpreinte: "", certImportLe: null, certMotDePasse: "",
      certHeriteImport: false, certActif: true,
    },
  });
  const getRep5 = await c.get("/api/signature-config?scope=reponse");
  check("CONTINUITÉ : premier accès = copie des métadonnées « Import »",
    String(getRep5.json?.config?.certSujet ?? "").includes("Certificat Import 204 v2") &&
    getRep5.json?.config?.certHeriteImport === true, "");
  const apresCopie = await db.signatureConfigReponse.findUnique({ where: { id: "signature-reponse" } });
  await c.put("/api/signature-config", {
    actif: true, certActif: true, certFichier: b64(genererP12("import204c", "Certificat Import 204 v3", "x")),
    certFichierNom: "import204c.p12",
  });
  const getRep6 = await c.get("/api/signature-config?scope=reponse");
  check("CONTINUITÉ : copie UNIQUE (un changement Import ultérieur ne coule pas)",
    String(getRep6.json?.config?.certSujet ?? "").includes("Certificat Import 204 v2") &&
    getRep6.json?.config?.certHeriteImport === true,
    JSON.stringify(getRep6.json?.config?.certSujet ?? ""));

  // ---- 9) Mauvais mot de passe PKCS#12 sur l'import dédié ---------------
  const putMauvais = await c.put("/api/signature-config", {
    scope: "reponse", actif: true, certActif: true,
    certFichier: b64(p12Reponses), certFichierNom: "reponses204.p12",
    certMotDePasse: "MAUVAIS-mot-de-passe",
  });
  check("Réponses : mauvais mot de passe PKCS#12 → 400",
    putMauvais.status === 400, `status=${putMauvais.status} ${JSON.stringify(putMauvais.json?.error ?? "")}`);

  // ---- restauration complète de l'état initial ---------------------------
  if (importAvant) {
    const { id, updatedAt, ...champs } = importAvant;
    await db.signatureConfig.update({ where: { id: "signature" }, data: champs });
  } else {
    await db.signatureConfig.deleteMany({ where: { id: "signature" } });
  }
  if (repAvant) {
    const { id, updatedAt, ...champs } = repAvant;
    await db.signatureConfigReponse.update({ where: { id: "signature-reponse" }, data: champs });
  } else {
    await db.signatureConfigReponse.deleteMany({ where: { id: "signature-reponse" } });
  }
  await db.demandeAdministrative.deleteMany({ where: { reference } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("(nettoyage : configurations restaurées, demande, compte et fichiers de test supprimés)");

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  await db.$disconnect();
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try {
    await db.demandeAdministrative.deleteMany({ where: { reference: "DEM-TEST-204CERT" } });
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  } catch {}
  await db.$disconnect();
  process.exit(1);
});
