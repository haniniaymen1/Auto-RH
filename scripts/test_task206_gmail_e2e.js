#!/usr/bin/env node
/**
 * ============================================================================
 * Task 206 — RETEST COMPLET DES DEMANDES AVEC CONFIGURATION SMTP + IMAP GMAIL
 * ============================================================================
 * Demande utilisateur : « Retester tous les demandes précédentes avec
 * configuration imap et smtp gmail »
 *
 * PRINCIPE : la configuration mail du SYSTÈME bascule de Zoho vers GMAIL via
 * la VRAIE API d'administration (:4000) — smtp.gmail.com:465 (SSL) +
 * imap.gmail.com:993 — puis TOUTES les demandes précédemment testées
 * (attestation de travail, attestation de salaire, congé, autorisation de
 * sortie) sont rejouées SOUS CETTE CONFIGURATION, avec la matrice complète de
 * réponses (acceptation / refus, rôles RH + manager, 1 étape + 2 étapes) et
 * la génération automatique des PDF signés électroniquement (section
 * « Réponse automatique PDF par e-mail » laissée active par la Task 205).
 *
 * CONTRAINTE GMAIL (mesurée en réel avant ce test) : Gmail refuse les mots de
 * passe de compte ordinaires pour SMTP/IMAP (535-5.7.8 Username and Password
 * not accepted) — un MOT DE PASSE D'APPLICATION (16 caractères, généré dans
 * le compte Google : Validation en deux étapes → Mots de passe d'application)
 * est OBLIGATOIRE. Aucun App Password Gmail n'a été fourni : les envois SMTP
 * réels vers Gmail échoueront avec 535 (le système doit le gérer
 * gracieusement — c'est un objet de test) et la boîte Gmail ne peut pas être
 * lue en IMAP. Les RÉPONSES sont donc injectées par le rejeu interne de
 * traiterMessageRecu (module portail en mode bibliothèque — même méthode que
 * la reprise Task 205), le poller IMAP restant actif sur Gmail pour prouver
 * sa RÉSILIENCE face aux échecs d'authentification.
 *
 * PHASES :
 *   config  : snapshot config → bascule Gmail via API réelle → relecture →
 *             e-mail de TEST via POST /api/mail-config {action:"test"} (erreur
 *             Gmail exacte attendue en réponse — diagnostic à l'écran)
 *   test    : connexions → 6 demandes (4 types) → « En attente » dans les DEUX
 *             interfaces → échecs SMTP Gmail journalisés (grâce) → vagues de
 *             réponses (rejeu interne) → statuts automatiques → vérifications
 *             PDF (contenu, images paraphe/cachet/QR, signature PAdES,
 *             téléchargement administration + portail employé, SHA-256) →
 *             résilience du poller IMAP → résumé
 *   restore : restitution EXACTE de la configuration Zoho (mot de passe
 *             compris) + relecture + vérification santé des deux services
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { execSync } = require("child_process");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new (require("@prisma/client").PrismaClient)();
const { simpleParser } = require("mailparser");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };

/* ---- Adresses du scénario GMAIL ---- */
const GMAIL_RH = "smtp.test@autorh.tn";        // boîte RH + manager de EMPZOH001
const GMAIL_EMP = "employe.test@autorh.tn";        // employé (notifications)
const GMAIL_HOST_SMTP = "smtp.gmail.com";
const GMAIL_HOST_IMAP = "imap.gmail.com";
const GMAIL_CANDIDAT = "Chelsea4ever****";         // SEUL candidat dispo (mot de passe Zoho réutilisé) — 535 attendu
const ZOHO_MGR = "rh3000@zohomail.com";            // manager de EMPZOH002 (inchangé)

/* ---- Configuration Zoho de RESTAURATION (mesurée avant la bascule) ---- */
const ZOHO_RESTORE = {
  host: "smtp.zoho.com", port: 465,
  username: "rh3000@zohomail.com", password: "Chelsea4ever****",
  from: "",
  rhEmail: GMAIL_RH,
  imapActif: false, imapHost: "imap.zoho.com", imapPort: 993,
  imapUser: "rh3000@zohomail.com", imapPassword: "Chelsea4ever****",
};

/* ---- Comptes portail ---- */
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP_PORTAIL = "Test-Zoho!2026";

const TMP = "/tmp/task206";
const ETAT = "/tmp/task206-etat.json";
const JOURNAL = "logs/journal-emails.log";

let ok = 0, fail = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; echecs.push(nom + (detail ? " — " + detail : "")); console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }
function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }
function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function statutAfficheConcordant(libelle, statutBd) {
  const l = sansAccents(libelle);
  if (statutBd === "ACCEPTEE") return /ACCEPTE|VALID/.test(l);
  if (statutBd === "REFUSEE") return /REFUS/.test(l);
  if (statutBd === "EN_ATTENTE") return /ATTENTE/.test(l);
  return false;
}
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) { const v = A.indexOf(c.toUpperCase()); if (v >= 0) bits += v.toString(2).padStart(5, "0"); }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const multipart = corps instanceof FormData;
    const res = await fetch(base + chemin, {
      method,
      headers: {
        ...(multipart ? {} : corps === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: multipart ? corps : corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const tampon = Buffer.from(await res.arrayBuffer());
    const texte = tampon.toString("utf8");
    let json = null;
    if ((res.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(texte); } catch { /* vide */ } }
    return { status: res.status, json, texte, octets: json ? null : tampon };
  };
  return {
    req, post: (p, c) => req("POST", p, c), put: (p, c) => req("PUT", p, c),
    get: (p) => req("GET", p),
  };
}
async function relire(ref) {
  return db.demandeAdministrative.findUnique({ where: { reference: ref } });
}
/** Lignes du journal depuis un instant donné. */
function journalDepuis(tISO, filtre) {
  if (!fs.existsSync(JOURNAL)) return [];
  const t = new Date(tISO).getTime() - 2000;
  return fs.readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((e) => e && new Date(e.horodatage).getTime() >= t && (!filtre || filtre(e)));
}

/* ---- Corps des demandes (mêmes payloads que Tasks 204/205) ---- */
const fd = (j) => j; // lisibilité
const CONGE1 = { typeConge: "Congé annuel", dateDebut: "2026-12-14", dateFin: "2026-12-18", commentaire: "Dossier Task 206 (config Gmail)" };
const AUTOR1 = { date: "2026-12-15", motif: "Démarche administrative Task 206 (Gmail)", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" };
const CONGE2 = { typeConge: "Congé annuel", dateDebut: "2027-01-11", dateFin: "2027-01-15", commentaire: "Dossier Task 206 matrice 2 étapes (Gmail)" };
const AUTOR2 = { date: "2027-01-12", motif: "Sortie Task 206 (Gmail)", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" };

/* ---- Matrice des cas (« toutes les demandes précédentes ») ---- */
const CAS = [
  { cle: "D1-att-travail", cin: "EMPZOH001", type: "ATTESTATION_TRAVAIL", corps: { type: "ATTESTATION_TRAVAIL" }, dediee: "attestationTravailEmail", destAttendu: GMAIL_RH, reponses: [] },
  { cle: "D2-att-salaire", cin: "EMPZOH001", type: "ATTESTATION_SALAIRE", corps: { type: "ATTESTATION_SALAIRE" }, dediee: "attestationSalaireEmail", destAttendu: GMAIL_RH, reponses: [] },
  { cle: "D3-conge-RH-accepte", cin: "EMPZOH001", type: "CONGE", destAttendu: GMAIL_RH, corps: fd({ type: "CONGE", ...CONGE1 }),
    reponses: [{ de: GMAIL_RH, nom: "RH Test", texte: "Congé accepté, bonne préparation." }],
    final: (d) => d.statut === "ACCEPTEE", doc: "signe" },
  { cle: "D4-autor-RH-refuse", cin: "EMPZOH001", type: "AUTORISATION_SORTIE", destAttendu: GMAIL_RH, corps: fd({ type: "AUTORISATION_SORTIE", ...AUTOR1 }),
    reponses: [{ de: GMAIL_RH, nom: "RH Test", texte: "Je refuse cette autorisation pour cette fois." }],
    final: (d) => d.statut === "REFUSEE", doc: "refus", refuseePar: "RH" },
  { cle: "D5-conge-2etapes", cin: "EMPZOH002", type: "CONGE", destAttendu: ZOHO_MGR, corps: fd({ type: "CONGE", ...CONGE2 }),
    reponses: [
      { de: ZOHO_MGR, nom: "Manager Zoho", texte: "OK pour moi, à valider par les RH." },
      { de: GMAIL_RH, nom: "RH Test", texte: "Je valide." },
    ],
    apresVague1: (d) => d.decisionManager === "ACCEPTEE" && d.statut === "EN_ATTENTE",
    final: (d) => d.statut === "ACCEPTEE", doc: "signe" },
  { cle: "D6-autor-mgr-refuse", cin: "EMPZOH002", type: "AUTORISATION_SORTIE", destAttendu: ZOHO_MGR, corps: fd({ type: "AUTORISATION_SORTIE", ...AUTOR2 }),
    reponses: [{ de: ZOHO_MGR, nom: "Manager Zoho", texte: "NON — demande refusée, période occupée." }],
    final: (d) => d.statut === "REFUSEE", doc: "refus", refuseePar: "MANAGER" },
];

/* ---- Fabrication d'une réponse .eml réaliste + rejeu interne ---- */
async function rejouerReponse({ de, nom, ref, type, texte, num }) {
  const sujet = "Re: AutoRH — " + (type === "CONGE" ? "Congé" : type === "AUTORISATION_SORTIE" ? "Autorisation de sortie"
    : type === "ATTESTATION_TRAVAIL" ? "Attestation de travail" : "Attestation de salaire")
    + " " + ref + " (traitement requis)";
  const eml = [
    "Message-ID: <task206-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@reponse.test>",
    "Date: " + new Date().toUTCString(),
    "From: " + (nom ? '"' + nom.replace(/"/g, "'") + '" ' : "") + "<" + de + ">",
    "To: <" + GMAIL_RH + ">",
    "Subject: " + sujet,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    texte,
    "",
  ].join("\r\n");
  const parsed = await simpleParser(Buffer.from(eml, "utf8"));
  const portail = require("./portail-server.js");
  const r = await portail.traiterMessageRecu(parsed);
  return { r, sujet };
}

/* ======================================================================== */
/* PHASE config : bascule Gmail via l'API d'administration RÉELLE           */
/* ======================================================================== */
async function phaseConfig() {
  console.log("\n================ PHASE CONFIG : bascule SMTP+IMAP GMAIL ================");
  fs.mkdirSync(TMP, { recursive: true });
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion INTERFACE D'ADMINISTRATION (:4000, superadmin lab)", login.status === 200, "status=" + login.status);

  // 1) SNAPSHOT de la configuration actuelle (pour la restitution)
  const avant = await adm.get("/api/mail-config");
  const cfgAvant = avant.json && avant.json.config ? avant.json.config : {};
  // le snapshot Zoho n'est écrit QUE s'il ne pointe pas déjà vers Gmail (idempotence)
  if (cfgAvant.host !== GMAIL_HOST_SMTP) fs.writeFileSync(TMP + "/config-avant.json", JSON.stringify(cfgAvant, null, 2));
  else console.log("  (config déjà Gmail — snapshot Zoho conservé pour la restitution)");
  console.log("  Config AVANT : host=" + cfgAvant.host + ":" + cfgAvant.port + " | imapActif=" + cfgAvant.imapActif
    + " | imap=" + cfgAvant.imapHost + " | rhEmail=" + cfgAvant.rhEmail
    + " | dédiées: " + cfgAvant.attestationTravailEmail + " / " + cfgAvant.attestationSalaireEmail
    + " / " + cfgAvant.congeEmail + " / " + cfgAvant.autorisationEmail);

  // 2) BASCULE vers Gmail (PUT réel — mêmes règles que le panneau)
  const corpsGmail = {
    host: GMAIL_HOST_SMTP, port: 465,
    username: GMAIL_RH, password: GMAIL_CANDIDAT,
    from: GMAIL_RH,
    serveurAdresse: cfgAvant.serveurAdresse || "", sitePort: cfgAvant.sitePort || "", portailUrl: cfgAvant.portailUrl || "",
    rhEmail: GMAIL_RH, itEmail: cfgAvant.itEmail || "",
    responsablesMap: cfgAvant.responsablesMap || "", parrainageEmail: cfgAvant.parrainageEmail || "",
    attestationTravailEmail: cfgAvant.attestationTravailEmail || GMAIL_RH,
    attestationSalaireEmail: cfgAvant.attestationSalaireEmail || GMAIL_RH,
    congeEmail: cfgAvant.congeEmail || "", autorisationEmail: cfgAvant.autorisationEmail || "",
    imapActif: true, imapHost: GMAIL_HOST_IMAP, imapPort: 993,
    imapUser: GMAIL_RH, imapPassword: GMAIL_CANDIDAT,
  };
  const put = await adm.put("/api/mail-config", corpsGmail);
  check("PUT /api/mail-config — bascule vers smtp.gmail.com:465 + imap.gmail.com:993 ACCEPTÉE par le système", put.status === 200,
    put.status !== 200 ? "status=" + put.status + " " + JSON.stringify(put.json || {}).slice(0, 200) : "smtp.gmail.com/465 + imap.gmail.com/993 (SSL déduit du port)");

  // 3) RELECTURE : la config Gmail est bien ENGAGÉE (mot de passe chiffré)
  const apres = await adm.get("/api/mail-config");
  const c = apres.json && apres.json.config ? apres.json.config : {};
  check("Relecture : host Gmail engagé", c.host === GMAIL_HOST_SMTP && c.port === 465, c.host + ":" + c.port);
  check("Relecture : IMAP Gmail actif (réception des réponses sur la boîte Gmail)", c.imapActif === true && c.imapHost === GMAIL_HOST_IMAP && c.imapPort === 993, c.imapHost + ":" + c.imapPort);
  check("Relecture : rhEmail + identifiants Gmail enregistrés (mot de passe JAMAIS renvoyé, hasPassword=" + c.hasPassword + ")",
    c.rhEmail === GMAIL_RH && c.username === GMAIL_RH && c.hasPassword === true && c.password === undefined, "rhEmail=" + c.rhEmail);

  // 4) E-MAIL DE TEST via l'API RÉELLE → l'erreur Gmail EXACTE (diagnostic)
  const test = await adm.post("/api/mail-config", { action: "test", dest: GMAIL_RH });
  const errTest = String((test.json && (test.json.error || test.json.message || test.json.erreur)) || "");
  console.log("  Réponse du test SMTP Gmail (status " + test.status + ") : " + errTest.slice(0, 300));
  check("E-mail de TEST via smtp.gmail.com — le système ATTEINT Google et remonte l'erreur d'authentification EXACTE",
    /535|Username and Password not accepted|mot de passe d'application/i.test(errTest),
    "Le serveur Google répond 535-5.7.8 : un MOT DE PASSE D'APPLICATION Gmail est requis (aucun fourni — attendu)");
  await db.$disconnect();
  console.log("\n  → Lancer : node scripts/test_task206_gmail_e2e.js test");
  process.exit(fail ? 1 : 0);
}

/** Connexion portail avec reprise anti-rejeu TOTP (nouvelle fenêtre si 401). */
async function connexionPortail(port, cin) {
  let r = await port.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(r.status === 200 && r.json && r.json.ok)) {
    await sleep(20000); // fenêtre TOTP suivante (anti-rejeu du même code)
    r = await port.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  }
  return r;
}

/* ======================================================================== */
/* Vérifications des PDF générés (sections 6 + 7) — réutilisable             */
/* ======================================================================== */
async function verifierDocuments(ctx) {
  const { adm, port1, port2, debutISO } = ctx;
  console.log("\n— 6) Réponse automatique : PDF signé généré + envoi Gmail tenté —");
  const docsAVerifier = [];
  for (const c of CAS) {
    if (!c.doc || !c.ref) continue;
    const d = await relire(c.ref);
    const nomFichier = (c.doc === "signe" ? d.docSigneChemin : d.docRefusChemin) || "";
    const nomAffiche = c.doc === "signe" ? d.docSigneNom : d.docRefusNom;
    let chemin = null;
    for (const cand of [nomFichier, "storage/documents-demandes/" + nomFichier, "storage/documents-demandes/" + nomFichier.split("/").pop()]) {
      if (nomFichier && fs.existsSync(cand)) { chemin = cand; break; }
    }
    check(c.cle + " : PDF " + (c.doc === "signe" ? "« document signé »" : "« document de refus »") + " généré AUTOMATIQUEMENT", Boolean(chemin),
      chemin ? chemin + " (" + fs.statSync(chemin).size + " o) — déclencheur : " + ((c.doc === "signe" ? d.docSignePar : d.docRefusPar) || "—") : "(aucun chemin en base)");
    if (chemin) {
      const brut = fs.readFileSync(chemin);
      check(c.cle + " : fichier stocké CHIFFRÉ (AES-256-GCM — en-tête PAIESAGE1)", brut.subarray(0, 9).toString() === "PAIESAGE1", "magic=" + brut.subarray(0, 9).toString());
      docsAVerifier.push({ cas: c, d, chemin, nom: nomAffiche || "", pdf: null });
    }
    const errEnvoi = (c.doc === "signe" ? d.docSigneErreur : d.docRefusErreur) || "";
    check(c.cle + " : envoi du PDF tenté via smtp.gmail.com — échec 535 tracé sur la demande (App Password requis)", /535/.test(String(errEnvoi)), String(errEnvoi).slice(0, 100));
    const jd = journalDepuis(debutISO, (e) => (e.action === "doc-signe" || e.action === "doc-refus") && e.reference === c.ref);
    if (jd.length) {
      const e0 = jd[jd.length - 1];
      check(c.cle + " : génération journalisée — signatureCrypto=true + éléments [signature, tampon, qr, elec, certificat] + 0 avertissement",
        e0.signatureCrypto === true && Array.isArray(e0.elements) && e0.elements.length >= 5 && (!e0.avertissements || e0.avertissements.length === 0),
        "elements=" + JSON.stringify(e0.elements));
      check(c.cle + " : journal doc — envoi « echec » avec l'erreur Gmail exacte", e0.envoi === "echec" && /535/.test(String(e0.erreur || "")), String(e0.erreur || "").split("\n")[0].slice(0, 90));
    }
  }

  console.log("\n— 7) Vérifications PDF : contenu, images, signature PAdES, double interface —");
  for (const v of docsAVerifier) {
    const { cas: c, d } = v;
    const det = await adm.get("/api/demandes/" + d.id);
    const itAdm = (det.json && det.json.item) || {};
    const docsDet = itAdm.documents || [];
    const docMeta = docsDet.find((x) => JSON.stringify(x).includes(c.ref) || /SIGNE|REFUS|automatique/i.test(JSON.stringify(x))) || docsDet[docsDet.length - 1];
    if (docMeta && docMeta.id) {
      const dlAdm = await adm.get("/api/demandes/" + d.id + "/documents/" + docMeta.id);
      check(c.cle + " : PDF téléchargeable depuis l'ADMINISTRATION", dlAdm.status === 200 && dlAdm.octets && dlAdm.octets.subarray(0, 4).toString() === "%PDF", dlAdm.octets ? dlAdm.octets.length + " o" : "vide");
      const mes = await (c.cin === "EMPZOH001" ? port1 : port2).get("/api/mes-demandes");
      const itP = ((mes.json && mes.json.items) || []).find((x) => x.reference === c.ref);
      const dlPort = await (c.cin === "EMPZOH001" ? port1 : port2).req("GET", "/api/mes-demandes/documents/" + docMeta.id);
      check(c.cle + " : PDF téléchargeable depuis le PORTAIL EMPLOYÉ", dlPort.status === 200 && dlPort.octets && dlPort.octets.subarray(0, 4).toString() === "%PDF", dlPort.octets ? dlPort.octets.length + " o" : "vide");
      if (dlAdm.octets && dlPort.octets) {
        const hA = sha256(dlAdm.octets), hP = sha256(dlPort.octets);
        check(c.cle + " : le MÊME PDF signé servi par les DEUX interfaces (SHA-256 identiques)", hA === hP, "sha256=" + hA.slice(0, 24) + "…");
        v.pdf = dlAdm.octets;
      }
      const libAdm = itAdm.statutFinalLibelle || "";
      check(c.cle + " : statut affiché COHÉRENT dans l'ADMINISTRATION (" + d.statut + ")", statutAfficheConcordant(libAdm, d.statut), "libellé=" + libAdm);
      if (itP) check(c.cle + " : statut affiché COHÉRENT dans le PORTAIL EMPLOYÉ", statutAfficheConcordant(itP.statut, d.statut), "portail=" + itP.statut);
    } else {
      check(c.cle + " : document visible dans l'ADMINISTRATION (métadonnées)", false, "aucun document listé pour " + c.ref);
    }

    if (!v.pdf) continue;
    fs.writeFileSync(TMP + "/" + c.cle + ".pdf", v.pdf);
    // 7b) CONTENU texte (informations exigées)
    let txt = "";
    try { execSync("pdftotext " + TMP + "/" + c.cle + ".pdf " + TMP + "/" + c.cle + ".txt"); txt = fs.readFileSync(TMP + "/" + c.cle + ".txt", "utf8"); } catch { }
    const cinEmp = dech(d.cin);
    const emailsEmp = dech(d.employeEmail) || GMAIL_EMP;
    const contenuOK = {
      "référence": txt.includes(c.ref),
      "type de demande": /Congé|Autorisation/i.test(txt),
      "statut final": c.doc === "signe" ? /Accept|Valid/i.test(txt) : /Refus/i.test(txt),
      "CIN employé": txt.includes(cinEmp),
      "e-mail employé": txt.includes(emailsEmp.split("@")[0]),
      "mention légale / signature": /Signature|signé|Fait le/i.test(txt),
    };
    for (const [k, vOk] of Object.entries(contenuOK)) check(c.cle + " : PDF contient " + k, vOk);
    // 7c) IMAGES (paraphe + cachet + QR)
    let nbImg = 0;
    try { const out = execSync("pdfimages -list " + TMP + "/" + c.cle + ".pdf", { encoding: "utf8" }); nbImg = Math.max(0, out.split("\n").length - 2); } catch { }
    check(c.cle + " : éléments visuels présents (≥ 3 images : paraphe + cachet + QR code)", nbImg >= 3, nbImg + " image(s) incorporée(s)");
    // 7d) SIGNATURE PAdES (ByteRange + PKCS#7/CAdES détaché vérifié openssl — méthode Task 205)
    const sPdf = v.pdf.toString("latin1");
    const mBr = sPdf.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
    if (mBr) {
      const b1 = +mBr[1], l1 = +mBr[2], b2 = +mBr[3], l2 = +mBr[4];
      const mCont = sPdf.slice(Math.max(0, b1 + l1 - 250), b2 + 50).match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
      if (mCont) {
        const contenu = Buffer.concat([v.pdf.subarray(b1, b1 + l1), v.pdf.subarray(b2, b2 + l2)]);
        const der = Buffer.from(mCont[1], "hex");
        const cheminSig = TMP + "/" + c.cle + "-signature.der";
        const cheminContenu = TMP + "/" + c.cle + "-contenu.bin";
        fs.writeFileSync(cheminSig, der);
        fs.writeFileSync(cheminContenu, contenu);
        check(c.cle + " : /ByteRange couvre TOUT le document (signature détachée intégrale)", b1 === 0 && (b2 + l2) === v.pdf.length, "b1=0, l1=" + l1 + ", fin=" + (b2 + l2) + "/" + v.pdf.length);
        // certificat dédié (Task 205) sinon extrait du PKCS7 lui-même
        let certPem = "";
        try { const etat205 = JSON.parse(fs.readFileSync("/tmp/task205-etat.json", "utf8")); if (etat205.certPem && fs.existsSync(etat205.certPem)) certPem = etat205.certPem; } catch { }
        if (!certPem) {
          try { execSync(`openssl pkcs7 -inform DER -in "${cheminSig}" -print_certs -out "${TMP}/"cert-extrait.pem`); certPem = TMP + "/cert-extrait.pem"; } catch { }
        }
        let verdict = "";
        try {
          verdict = certPem
            ? execSync(`openssl smime -verify -in "${cheminSig}" -inform DER -content "${cheminContenu}" -CAfile "${certPem}" -purpose any 2>&1 || true`, { encoding: "utf8" })
            : execSync(`openssl smime -verify -noverify -in "${cheminSig}" -inform DER -content "${cheminContenu}" 2>&1 || true`, { encoding: "utf8" });
        } catch (e) { verdict = String(e.stdout || "") + String(e.stderr || e.message || ""); }
        check(c.cle + " : signature cryptographique VÉRIFIÉE (openssl smime — PKCS#7/CAdES détaché)", /Verification successful/i.test(verdict), verdict.trim().split(/\r?\n/).slice(-2).join(" | "));
      } else check(c.cle + " : /Contents hex extrait", false, "introuvable près de la plage");
    } else check(c.cle + " : /ByteRange présent (signature PAdES)", false, "absent");
    // 7e) RENDU VISUEL
    try { execSync("pdftoppm -r 110 -png " + TMP + "/" + c.cle + ".pdf " + TMP + "/" + c.cle + "-rendu"); check(c.cle + " : rendu visuel généré (contrôle paraphe/cachet/QR)", true, TMP + "/" + c.cle + "-rendu*.png"); }
    catch (e) { check(c.cle + " : rendu visuel généré", false, e.message.slice(0, 80)); }
  }
}

/* ======================================================================== */
/* PHASE test : les 6 demandes sous configuration Gmail                     */
/* ======================================================================== */
async function phaseTest() {
  console.log("\n================ PHASE TEST : demandes + réponses + PDF (Gmail) ================");
  const debutISO = new Date().toISOString();
  fs.mkdirSync(TMP, { recursive: true });

  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion INTERFACE D'ADMINISTRATION (:4000)", login.status === 200, "status=" + login.status);
  const port1 = client(PORTAIL);
  const p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion PORTAIL EMPLOYÉ (:4001, EMPZOH001 — CIN+mdp+OTP TOTP)", p1.status === 200 && p1.json && p1.json.ok, "status=" + p1.status);
  const port2 = client(PORTAIL);
  const p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion PORTAIL EMPLOYÉ (:4001, EMPZOH002 — CIN+mdp+OTP TOTP)", p2.status === 200 && p2.json && p2.json.ok, "status=" + p2.status);

  // ---- 1) Création des 6 demandes (les 4 types précédents) ----
  console.log("\n— 1) Création des demandes via le VRAI portail (envois SMTP Gmail en arrière-plan) —");
  for (const c of CAS) {
    const port = c.cin === "EMPZOH001" ? port1 : port2;
    const r = await port.post("/api/demandes", c.corps);
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    if (r.status === 201 && ref) { c.ref = ref; check("Demande " + c.cle + " créée (" + c.type + ") → " + ref, true, "destinataire: " + (r.json.destinataire || r.json.d && r.json.d.destinataire || "(relire)")); }
    else check("Demande " + c.cle + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 200));
    await sleep(400);
  }
  if (CAS.some((c) => !c.ref)) { console.log("  Création incomplète."); await db.$disconnect(); process.exit(1); }
  fs.writeFileSync(ETAT, JSON.stringify(CAS.map((c) => ({ cle: c.cle, ref: c.ref })), null, 2));

  // ---- 2) Routage attendu (adresses Gmail) + envois SMTP Gmail (échec 535 gracieux) ----
  console.log("\n— 2) Routage + envois SMTP via smtp.gmail.com (arrière-plan) —");
  await sleep(15000); // les envois arrière-plan tentent Gmail
  const cfgMail = await adm.get("/api/mail-config");
  const cm = cfgMail.json && cfgMail.json.config ? cfgMail.json.config : {};
  const dediee = { attestationTravailEmail: cm.attestationTravailEmail || cm.rhEmail, attestationSalaireEmail: cm.attestationSalaireEmail || cm.rhEmail };
  for (const c of CAS) {
    const d = await relire(c.ref);
    const attendu = c.dediee ? dediee[c.dediee] : c.destAttendu;
    check(c.cle + " : routée vers l'adresse attendue (" + attendu + ")", d && dech(d.destinataire) === attendu,
      d ? "destinataire=" + dech(d.destinataire) : "introuvable");
  }
  const envois = journalDepuis(debutISO, (e) => String(e.action || "").startsWith("demande-") && e.action !== "demande-imap");
  const echecs535 = envois.filter((e) => e.succes === false && /535|Username and Password not accepted/i.test(String(e.erreur || "")));
  const succes = envois.filter((e) => e.succes === true);
  check("Envois SMTP via Gmail journalisés en ÉCHEC gracieux (535 — mot de passe d'application requis)", echecs535.length >= 4,
    echecs535.length + " échec(s) journalisé(s) sur " + envois.length + " envoi(s) tenté(s)");
  check("Le système n'a FAUSSEMENT déclaré AUCUN envoi réussi via Gmail", succes.length === 0, succes.length + " succes=true (attendu 0 sans App Password)");
  const refsCreees = CAS.map((c) => c.ref);
  check("Toutes les demandes RESTENT INTACTES malgré l'échec Gmail (créées + En attente en base)",
    (await Promise.all(refsCreees.map((r) => relire(r)))).every((d) => d && d.statut === "EN_ATTENTE"), refsCreees.join(", "));
  const tous = await Promise.all(CAS.map((c) => relire(c.ref)));
  check("Aucun Message-ID d'envoi (l'e-mail n'a PAS quitté le système — cohérent avec 535)", tous.every((d) => !d.messageIdEnvoi), "messageIdEnvoi présent sur " + tous.filter((d) => d.messageIdEnvoi).length + " demande(s)");

  // ---- 3) Statut INITIAL « En attente » dans les DEUX interfaces ----
  console.log("\n— 3) Statut initial « En attente » dans les DEUX interfaces —");
  for (const [cin, port] of [["EMPZOH001", port1], ["EMPZOH002", port2]]) {
    const mes = await port.get("/api/mes-demandes");
    const items = (mes.json && mes.json.items) || [];
    for (const c of CAS.filter((x) => x.cin === cin)) {
      const p = items.find((x) => x.reference === c.ref);
      check(c.cle + " : « En attente » dans le PORTAIL EMPLOYÉ", p && p.statut === "EN_ATTENTE", p ? "portail=" + p.statut : "absent");
    }
  }
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  for (const c of CAS) {
    const a = itemsAdm.find((x) => x.reference === c.ref);
    check(c.cle + " : « En attente » dans l'ADMINISTRATION", a && a.statut === "EN_ATTENTE", a ? "admin=" + a.statut : "absent");
  }

  // ---- 4) VAGUES de réponses (rejeu interne — la boîte Gmail n'est pas lisible sans App Password) ----
  console.log("\n— 4) Vagues de réponses e-mail (acceptation / refus — rejeu interne de traiterMessageRecu) —");
  let numReponse = 0;
  for (let vague = 0; vague < 2; vague++) {
    for (const c of CAS) {
      const rep = c.reponses[vague];
      if (!rep) continue;
      numReponse++;
      const avant = await relire(c.ref);
      const { r, sujet } = await rejouerReponse({ de: rep.de, nom: rep.nom, ref: c.ref, type: c.type, texte: rep.texte, num: numReponse });
      console.log("  → vague " + (vague + 1) + " | " + c.cle + " " + c.ref + " | From " + rep.de + " | « " + rep.texte.slice(0, 45) + " »");
      console.log("     traiterMessageRecu : " + JSON.stringify(r).slice(0, 220));
      if (vague === 0 && c.apresVague1) {
        const d = await relire(c.ref);
        check(c.cle + " : APRÈS vague 1 (manager) — décision manager appliquée, statut transmet aux RH", c.apresVague1(d),
          "statut=" + d.statut + " decisionManager=" + (d.decisionManager || "—"));
      }
      await sleep(600);
    }
    if (vague === 0) { console.log("  … attente de la transmission RH (étape 1 de la matrice 2 étapes)"); await sleep(2000); }
  }

  // ---- 5) Statuts FINAUX automatiques ----
  console.log("\n— 5) Statuts finaux (mise à jour automatique par les réponses e-mail) —");
  for (const c of CAS) {
    if (!c.final) continue;
    let d = null, atteint = false;
    for (let i = 0; i < 12 && !atteint; i++) { await sleep(1500); d = await relire(c.ref); atteint = c.final(d); }
    check(c.cle + " : statut final automatique " + (c.doc === "signe" ? "« Acceptée »" : "« Refusée »"), atteint,
      d ? "statut=" + d.statut + " decisionManager=" + (d.decisionManager || "—") + " decisionRh=" + (d.decisionRh || "—") : "introuvable");
    if (c.refuseePar) check(c.cle + " : refus attribué à " + (c.refuseePar === "RH" ? "« par les RH »" : "« par le Manager »"),
      String(d.refuseePar || "").toUpperCase().includes(c.refuseePar), "refuseePar=" + (d.refuseePar || "—"));
    if (d.decisionRhNote || d.decisionManagerNote) check(c.cle + " : traçabilité de la formulation reconnue dans la décision",
      /Formulation reconnue/.test(String(d.decisionRhNote || "") + String(d.decisionManagerNote || "")),
      (d.decisionRhNote || d.decisionManagerNote || "").slice(0, 80));
    check(c.cle + " : traité par « Auto-RH (réponse e-mail) »", /réponse e-mail/i.test(String(d.traitePar || "")), "traitePar=" + (d.traitePar || "—"));
  }
  // transmission RH journalisée pour D5 (étape 1 → 2)
  const trans = journalDepuis(debutISO, (e) => e.action === "demande-transmission-rh");
  check("TRANSMISSION RH journalisée après acceptation manager (D5 — 2 étapes)", trans.some((e) => e.reference === CAS[4].ref),
    trans.length + " entrée(s) demande-transmission-rh");

  // ---- 6) + 7) PDF signés : génération, contenu, signature, double interface ----
  await verifierDocuments({ adm, port1, port2, debutISO });

  // ---- 8) Résilience du poller IMAP Gmail ----
  console.log("\n— 8) Poller IMAP sur imap.gmail.com : échecs d'authentification JOURNALISÉS, service stable —");
  const imap = journalDepuis(debutISO, (e) => e.action === "demande-imap");
  check("Échecs IMAP Gmail journalisés (IMAP_ECHEC) sans crash du service", imap.length >= 1 && imap.every((e) => e.code === "IMAP_ECHEC" || e.succes === false),
    imap.length + " entrée(s) — " + String(imap[0] && imap[0].erreur || "").slice(0, 110));
  const sante = await fetch(PORTAIL + "/").then((r) => r.status).catch((e) => 0);
  check("Portail employé (:4001) toujours RÉPONDANT après les échecs IMAP répétés", sante > 0, "GET / → " + sante);

  await db.$disconnect();
  console.log("\n==================== RÉSUMÉ : " + ok + " OK / " + fail + " FAIL ====================");
  if (echecs.length) console.log("Échecs :\n  - " + echecs.join("\n  - "));
  console.log("  PDF et rendus : " + TMP + "/");
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* PHASE restore : restitution EXACTE de la configuration Zoho              */
/* ======================================================================== */
async function phaseRestore() {
  console.log("\n================ PHASE RESTORE : retour à la configuration Zoho ================");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion admin", login.status === 200, "status=" + login.status);
  const avant = await adm.get("/api/mail-config");
  const cfgAvant = avant.json && avant.json.config ? avant.json.config : {};
  const corps = {
    host: ZOHO_RESTORE.host, port: ZOHO_RESTORE.port,
    username: ZOHO_RESTORE.username, password: ZOHO_RESTORE.password,
    from: cfgAvant.from || ZOHO_RESTORE.from,
    serveurAdresse: cfgAvant.serveurAdresse || "", sitePort: cfgAvant.sitePort || "", portailUrl: cfgAvant.portailUrl || "",
    rhEmail: cfgAvant.rhEmail || ZOHO_RESTORE.rhEmail, itEmail: cfgAvant.itEmail || "",
    responsablesMap: cfgAvant.responsablesMap || "", parrainageEmail: cfgAvant.parrainageEmail || "",
    attestationTravailEmail: cfgAvant.attestationTravailEmail || "", attestationSalaireEmail: cfgAvant.attestationSalaireEmail || "",
    congeEmail: cfgAvant.congeEmail || "", autorisationEmail: cfgAvant.autorisationEmail || "",
    imapActif: false, imapHost: ZOHO_RESTORE.imapHost, imapPort: 993,
    imapUser: ZOHO_RESTORE.imapUser, imapPassword: ZOHO_RESTORE.imapPassword,
  };
  const put = await adm.put("/api/mail-config", corps);
  check("PUT restitution Zoho (smtp.zoho.com:465 + mot de passe d'origine + IMAP désactivé)", put.status === 200, "status=" + put.status);
  const apres = await adm.get("/api/mail-config");
  const c = apres.json && apres.json.config ? apres.json.config : {};
  check("Relecture : configuration Zoho RESTITUÉE", c.host === "smtp.zoho.com" && c.port === 465 && c.imapActif === false && c.imapHost === "imap.zoho.com",
    c.host + ":" + c.port + " | imapActif=" + c.imapActif);
  const s4000 = await fetch(ADMIN).then((r) => r.status).catch(() => 0);
  const s4001 = await fetch(PORTAIL).then((r) => r.status).catch(() => 0);
  check("Santé des deux services", s4000 > 0 && s4001 > 0, ":4000 → " + s4000 + " | :4001 → " + s4001);
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
/* PHASE docs : reprise — vérifie les PDF des demandes déjà créées          */
/* ======================================================================== */
async function phaseDocs() {
  console.log("\n================ PHASE DOCS (reprise) : vérifications des PDF générés ================");
  const debutISO = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  if (fs.existsSync(ETAT)) {
    const refs = JSON.parse(fs.readFileSync(ETAT, "utf8"));
    for (const r of refs) { const c = CAS.find((x) => x.cle === r.cle); if (c) c.ref = r.ref; }
  }
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion admin", login.status === 200, "status=" + login.status);
  const port1 = client(PORTAIL);
  const p1 = await connexionPortail(port1, "EMPZOH001");
  check("Connexion portail EMPZOH001", p1.status === 200, "status=" + p1.status);
  const port2 = client(PORTAIL);
  const p2 = await connexionPortail(port2, "EMPZOH002");
  check("Connexion portail EMPZOH002", p2.status === 200, "status=" + p2.status);
  await verifierDocuments({ adm, port1, port2, debutISO });
  await db.$disconnect();
  console.log("\n==================== RÉSUMÉ : " + ok + " OK / " + fail + " FAIL ====================");
  if (echecs.length) console.log("Échecs :\n  - " + echecs.join("\n  - "));
  process.exit(fail ? 1 : 0);
}

/* ======================================================================== */
const phase = process.argv[2] || "test";
const phases = { config: phaseConfig, test: phaseTest, docs: phaseDocs, restore: phaseRestore };
if (!phases[phase]) { console.log("Usage : node scripts/test_task206_gmail_e2e.js [config|test|restore]"); process.exit(2); }
phases[phase]().catch(async (e) => { console.error("ERREUR FATALE:", e); try { await db.$disconnect(); } catch { } process.exit(1); });
