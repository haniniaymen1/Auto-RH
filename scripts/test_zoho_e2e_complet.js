#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E COMPLET — ZOHO SMTP + IMAP (demande utilisateur, trace 1a11cbaba)
 * « essaye avec imap et smtp de zoho par rh3000@zohomail.com … tous les
 *   demandes et tous les réponses par mail. Utilisé adresse mail RH
 *   smtp.test@autorh.tn et manager smtp.test@autorh.tn et pour
 *   employé employe.test@autorh.tn »
 *
 * SCÉNARIO 1 — LES 4 DEMANDES (adresses réelles de l'utilisateur) :
 *   employé CIN EMPZOH001 (employe.test@autorh.tn, manager affecté
 *   smtp.test@autorh.tn) crée les 4 types via le VRAI portail :
 *     - Attestation de travail   → adresse dédiée → smtp.test@autorh.tn
 *     - Attestation de salaire   → adresse dédiée → smtp.test@autorh.tn
 *     - Congé                    → manager responsable → smtp.test@autorh.tn
 *     - Autorisation de sortie   → manager responsable → smtp.test@autorh.tn
 *   Envois RÉELS via smtp.zoho.com:465 (compte rh3000@zohomail.com) +
 *   confirmations automatiques à employe.test@autorh.tn.
 *
 * SCÉNARIO 2 — LES RÉPONSES (boucle complète via Zoho) :
 *   le sandbox ne peut pas envoyer DEPUIS Gmail (pas d'identifiants) : les
 *   réponses légitimes viendront de smtp.test@autorh.tn quand
 *   l'utilisateur répondra depuis sa boîte. Pour prouver la boucle ICI, un
 *   2e couple employé/manager est créé avec le MANAGER = la boîte ZOHO
 *   (rh3000@zohomail.com) : la demande lui part (auto-livraison dans INBOX),
 *   puis 2 réponses RÉELLES sont envoyées via smtp.zoho.com avec les en-têtes
 *   In-Reply-To/References :
 *     - congé EMPZOH002  : « j'accepte la demande » → étape manager OK →
 *                          transmission RH RÉELLE vers smtp.test@autorh.tn
 *                          (l'étape RH pourra être jouée EN DIRECT par
 *                          l'utilisateur depuis sa boîte Gmail) ;
 *     - autorisation E2  : « je refuse cette demande » → Refusée (définitive).
 *   Le poller IMAP du service 4001 (toutes les 120 s, relance directe de
 *   secours via verifierBoiteDemandes) traite les réponses.
 *
 * Le script NE SUPPRIME RIEN après coup : la configuration Zoho reste
 * active et les demandes restent visibles (l'utilisateur poursuit le test
 * en répondant depuis smtp.test@autorh.tn).
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const nodemailer = require("nodemailer");

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const EMAIL_RH = "smtp.test@autorh.tn";       // RH + manager (demande utilisateur)
const EMAIL_EMPLOYE = "employe.test@autorh.tn";   // employé (demande utilisateur)
const CIN_MGR1 = "MGRZOH001";
const CIN_EMP1 = "EMPZOH001";
const CIN_MGR2 = "MGRZOH002";
const CIN_EMP2 = "EMPZOH002";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP = "Test-Zoho!2026";
const JOURNAL = "logs/journal-emails.log";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** TOTP RFC 6238 (6 chiffres, 30 s, SHA1) — même algorithme que le portail. */
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) {
    const v = A.indexOf(c.toUpperCase());
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/** Client HTTP avec cookie persistant. */
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null;
    try { json = JSON.parse(texte); } catch { /* html */ }
    return { status: res.status, json, texte };
  };
  return { req, post: (p, c) => req("POST", p, c), get: (p) => req("GET", p), put: (p, c) => req("PUT", p, c) };
}

async function lignesJournal(references) {
  let brut = "";
  try { brut = fs.readFileSync(JOURNAL, "utf8"); } catch { return []; }
  const sortie = [];
  for (const l of brut.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (references.some((r) => (j.reference || "").includes(r))) sortie.push(j);
    } catch { /* ligne partielle */ }
  }
  return sortie;
}

async function attendreMessageId(idDemande, secondes) {
  const fin = Date.now() + secondes * 1000;
  while (Date.now() < fin) {
    const d = await db.demandeAdministrative.findUnique({ where: { id: idDemande } });
    if (d && d.messageIdEnvoi) return d;
    await sleep(1500);
  }
  return db.demandeAdministrative.findUnique({ where: { id: idDemande } });
}

async function attendreCondition(description, sondage, secondes) {
  const fin = Date.now() + secondes * 1000;
  let dernier = null;
  while (Date.now() < fin) {
    dernier = await sondage();
    if (dernier.cond) return dernier;
    await sleep(5000);
  }
  return dernier;
}

async function creerAcces({ cin, nomPrenom, email, managerId }) {
  await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(cin, true) } });
  return db.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(cin, true),
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP)),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      nomPrenom: cryptoBd.chiffrerChamp(nomPrenom),
      email: cryptoBd.chiffrerChamp(email),
      mailEnvoyeA: cryptoBd.chiffrerChamp(email),
      mailEnvoyeLe: new Date(Date.now() - 3600000),
      ...(managerId ? { managerId } : {}),
    },
  });
}

async function main() {
  console.log("== TEST E2E ZOHO — demandes + réponses par e-mail (RÉEL) ==");
  console.log("   SMTP/IMAP : " + ZOHO_USER + " (smtp.zoho.com:465 / imap.zoho.com:993)");
  console.log("   RH + Manager : " + EMAIL_RH + " — Employé : " + EMAIL_EMPLOYE);

  const adm = client(ADMIN);
  // (indépendance de l'environnement — comme Task 231+) compte de test
  // temporaire créé en base (les identifiants superadmin réels ne sont pas
  // connus des harnesses) : lab226/creer-compte-e2e-116.cjs → /tmp/lab116-compte.json
  const { execFileSync } = require("child_process");
  try { execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  let COMPTE_E2E = null;
  try { COMPTE_E2E = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8")); } catch {}
  const login = await adm.post("/api/auth/login", {
    email: (COMPTE_E2E && COMPTE_E2E.email) || "superadmin@autorh.local",
    password: (COMPTE_E2E && COMPTE_E2E.password) || "AutoRH-2026!Verif#1",
  });
  check("Connexion administration (compte de test)", login.status === 200, "status=" + login.status);
  if (login.status !== 200) { console.log("Arrêt : connexion impossible."); return resume({ congE2: null }); }

  // ------------------------------------------------------------------
  // A) CONFIGURATION ZOHO RÉELLE (SMTP + IMAP + routage par type)
  // ------------------------------------------------------------------
  console.log("\n— A) Configuration Zoho (SMTP + IMAP + adresses de routage) —");
  const avant = await adm.get("/api/mail-config");
  try { fs.writeFileSync("/tmp/mail-config-avant-zoho.json", JSON.stringify(avant.json, null, 2)); } catch {}
  const cfgZoho = {
    host: "smtp.zoho.com", port: 465, username: ZOHO_USER, password: ZOHO_PASS, from: "",
    rhEmail: EMAIL_RH,
    attestationTravailEmail: EMAIL_RH,
    attestationSalaireEmail: EMAIL_RH,
    congeEmail: EMAIL_RH,
    autorisationEmail: EMAIL_RH,
    imapActif: true, imapHost: "imap.zoho.com", imapPort: 993, imapUser: "", imapPassword: "",
  };
  const put = await adm.put("/api/mail-config", cfgZoho);
  check("PUT /api/mail-config (Zoho) accepté", put.status === 200, "status=" + put.status + (put.json && put.json.error ? " " + put.json.error : ""));
  const relit = await adm.get("/api/mail-config");
  const cfg2 = relit.json || {};
  check("rhEmail = smtp.test@autorh.tn enregistré", cfg2.rhEmail === EMAIL_RH, "rhEmail=" + cfg2.rhEmail);
  check("4 adresses dédiées enregistrées (travail/salaire/congé/autorisation)",
    cfg2.attestationTravailEmail === EMAIL_RH && cfg2.attestationSalaireEmail === EMAIL_RH &&
    cfg2.congeEmail === EMAIL_RH && cfg2.autorisationEmail === EMAIL_RH,
    "travail=" + cfg2.attestationTravailEmail + " salaire=" + cfg2.attestationSalaireEmail +
    " congé=" + cfg2.congeEmail + " autorisation=" + cfg2.autorisationEmail);
  check("IMAP actif : imap.zoho.com:993 (identifiants = SMTP)", Boolean(cfg2.imapActif) && cfg2.imapHost === "imap.zoho.com",
    "imapActif=" + cfg2.imapActif + " imapHost=" + cfg2.imapHost + " port=" + cfg2.imapPort);

  // ------------------------------------------------------------------
  // B) SÉMÉ — comptes portail (adresses réelles de l'utilisateur)
  // ------------------------------------------------------------------
  console.log("\n— B) Comptes portail de test (adresses réelles) —");
  const mgr1 = await creerAcces({ cin: CIN_MGR1, nomPrenom: "RH Test (Manager)", email: EMAIL_RH });
  const emp1 = await creerAcces({ cin: CIN_EMP1, nomPrenom: "Employe Test", email: EMAIL_EMPLOYE, managerId: mgr1.id });
  const mgr2 = await creerAcces({ cin: CIN_MGR2, nomPrenom: "Boîte Zoho (Manager test réponses)", email: ZOHO_USER });
  const emp2 = await creerAcces({ cin: CIN_EMP2, nomPrenom: "Employe Test (boucle réponses)", email: EMAIL_EMPLOYE, managerId: mgr2.id });
  check("4 comptes créés : " + CIN_MGR1 + "/" + CIN_EMP1 + " (scénario 1), " + CIN_MGR2 + "/" + CIN_EMP2 + " (scénario 2)",
    Boolean(mgr1 && emp1 && mgr2 && emp2), "manager1=" + EMAIL_RH + ", manager2=" + ZOHO_USER);

  // ------------------------------------------------------------------
  // C) SCÉNARIO 1 — LES 4 DEMANDES via le VRAI portail
  // ------------------------------------------------------------------
  console.log("\n— C) Scénario 1 : les 4 demandes de " + EMAIL_EMPLOYE + " (envois RÉELS via Zoho) —");
  const port = client(PORTAIL);
  const verif1 = await port.post("/api/verify", { cin: CIN_EMP1, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion portail employé (" + CIN_EMP1 + " + mot de passe + OTP)", verif1.status === 200 && verif1.json?.ok, "status=" + verif1.status);

  const aujourdhui = new Date();
  const dateAut = aujourdhui.toISOString().slice(0, 10);
  const demandes = [
    { corps: { type: "ATTESTATION_TRAVAIL" }, attendu: EMAIL_RH, motif: "Adresse dédiée attestation de travail" },
    { corps: { type: "ATTESTATION_SALAIRE" }, attendu: EMAIL_RH, motif: "Adresse dédiée attestation de salaire" },
    { corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18", commentaire: "Test Zoho — toutes demandes/réponses par e-mail" }, attendu: EMAIL_RH, motif: "Manager responsable (affecté : " + EMAIL_RH + ")" },
    { corps: { type: "AUTORISATION_SORTIE", date: dateAut, motif: "Rendez-vous administratif (test Zoho)", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00", compensation: "NON" }, attendu: EMAIL_RH, motif: "Manager responsable + copie RH" },
  ];
  const creees1 = [];
  for (const d of demandes) {
    const r = await port.post("/api/demandes", d.corps);
    const ref = r.json && r.json.d && r.json.d.reference;
    check("POST demande " + d.corps.type + " → 201", r.status === 201, "status=" + r.status + " ref=" + ref);
    if (ref) creees1.push({ ref, type: d.corps.type, attendu: d.attendu, id: r.json.d.id });
    await sleep(500);
  }

  console.log("  Attente des envois SMTP réels (arrière-plan)…");
  for (const c of creees1) {
    const d = await attendreMessageId(c.id, 40);
    const dest = d && d.destinataire ? cryptoBd.dechiffrerChamp(d.destinataire) : "";
    check("[" + c.type + " " + c.ref + "] envoyée via Zoho → destinataire " + c.attendu,
      Boolean(d && d.messageIdEnvoi) && dest === c.attendu,
      "dest=" + dest + " messageId=" + (d && d.messageIdEnvoi ? "mémorisé ✓" : "ABSENT"));
  }

  // ------------------------------------------------------------------
  // D) SCÉNARIO 2 — demandes adressées à la BOÎTE ZOHO (boucle réponses)
  // ------------------------------------------------------------------
  console.log("\n— D) Scénario 2 : congé + autorisation adressés à la boîte Zoho —");
  const verif2 = await port.post("/api/verify", { cin: CIN_EMP2, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexion portail employé (" + CIN_EMP2 + ")", verif2.status === 200 && verif2.json?.ok, "status=" + verif2.status);
  const creees2 = [];
  for (const d of [
    { corps: { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-10", commentaire: "Boucle réponses — acceptation attendue" }, type: "CONGE" },
    { corps: { type: "AUTORISATION_SORTIE", date: dateAut, motif: "Boucle réponses — refus attendu", nombreHeures: "1", heureSortie: "14:00", heureRetour: "15:00", compensation: "OUI" }, type: "AUTORISATION_SORTIE" },
  ]) {
    const r = await port.post("/api/demandes", d.corps);
    const ref = r.json && r.json.d && r.json.d.reference;
    check("POST demande " + d.type + " → 201", r.status === 201, "status=" + r.status + " ref=" + ref);
    if (ref) creees2.push({ ref, type: d.type, id: r.json.d.id });
    await sleep(500);
  }
  for (const c of creees2) {
    const d = await attendreMessageId(c.id, 40);
    const dest = d && d.destinataire ? cryptoBd.dechiffrerChamp(d.destinataire) : "";
    check("[" + c.type + " " + c.ref + "] envoyée vers la boîte Zoho (auto-livraison INBOX)",
      Boolean(d && d.messageIdEnvoi) && dest === ZOHO_USER, "dest=" + dest);
  }

  const refs2 = creees2.map((c) => c.ref);
  const congE2 = creees2.find((c) => c.type === "CONGE") || { ref: "(inconnu)", id: null };
  const autE2 = creees2.find((c) => c.type === "AUTORISATION_SORTIE") || { ref: "(inconnu)", id: null };

  // ------------------------------------------------------------------
  // E) LES RÉPONSES RÉELLES (envoi via smtp.zoho.com + poller IMAP 4001)
  // ------------------------------------------------------------------
  console.log("\n— E) Réponses RÉELLES envoyées via smtp.zoho.com (In-Reply-To) —");
  const transport = nodemailer.createTransport({
    host: "smtp.zoho.com", port: 465, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS }, tls: { rejectUnauthorized: false },
  });
  async function repondre(demandeId, sujetOriginal, texte) {
    const d = await db.demandeAdministrative.findUnique({ where: { id: demandeId } });
    const info = await transport.sendMail({
      from: ZOHO_USER, to: ZOHO_USER,
      subject: "RE: " + sujetOriginal,
      text: texte,
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      references: "<" + d.messageIdEnvoi + ">",
    });
    return info;
  }
  try {
    const r1 = await repondre(congE2.id, "AutoRH — Demande de congé " + congE2.ref + " (traitement requis)", "Bonjour, j'accepte la demande de congé. Cordialement.");
    check("Réponse 1 envoyée via Zoho (« j'accepte la demande » pour " + congE2.ref + ")", Boolean(r1 && r1.messageId), "250 " + (r1.response || ""));
    const r2 = await repondre(autE2.id, "AutoRH — Autorisation de sortie " + autE2.ref + " (traitement requis)", "Bonjour, je refuse cette autorisation de sortie. Cordialement.");
    check("Réponse 2 envoyée via Zoho (« je refuse » pour " + autE2.ref + ")", Boolean(r2 && r2.messageId), "250 " + (r2.response || ""));
  } catch (e) {
    check("Envoi des réponses via Zoho", false, (e && e.message) || String(e));
  }

  console.log("  Attente du traitement IMAP (poller 4001 toutes les 120 s — secours direct à 45 s)…");
  let secours = false;
  const resConge = await attendreCondition("congé accepté par manager", async () => {
    const d = await db.demandeAdministrative.findUnique({ where: { id: congE2.id } });
    const fait = d && d.decisionManager === "ACCEPTEE";
    if (!fait && !secours && Date.now() % 1 === 0) { /* déclenché après le premier timeout ci-dessous */ }
    return { cond: fait, d };
  }, 45);
  if (!resConge.cond) {
    secours = true;
    try { await portail.verifierBoiteDemandes(); } catch (e) { console.log("  (secours IMAP : " + (e.message || e) + ")"); }
  }
  const finalConge = await attendreCondition("congé : étape manager enregistrée", async () => {
    const d = await db.demandeAdministrative.findUnique({ where: { id: congE2.id } });
    return { cond: d && d.decisionManager === "ACCEPTEE", d };
  }, 120);
  check("[" + congE2.ref + "] réponse « j'accepte » → décision MANAGER = Acceptée",
    Boolean(finalConge.d && finalConge.d.decisionManager === "ACCEPTEE"),
    "decisionManager=" + (finalConge.d && finalConge.d.decisionManager) + ", statut=" + (finalConge.d && finalConge.d.statut) + " (en attente RH — normal, matrice 2 étapes)");

  const finalAut = await attendreCondition("autorisation refusée", async () => {
    const d = await db.demandeAdministrative.findUnique({ where: { id: autE2.id } });
    return { cond: d && d.statut === "REFUSEE", d };
  }, 60);
  check("[" + autE2.ref + "] réponse « je refuse » → REFUSÉE par le Manager (définitive)",
    Boolean(finalAut.d && finalAut.d.statut === "REFUSEE"),
    "statut=" + (finalAut.d && finalAut.d.statut) + ", refuseePar=" + (finalAut.d && finalAut.d.refuseePar));

  // ------------------------------------------------------------------
  // F) PREUVES JOURNAL + RÉCAPITULATIF
  // ------------------------------------------------------------------
  console.log("\n— F) Journal des e-mails (extraits réels) —");
  const toutes = [...creees1.map((c) => c.ref), ...refs2];
  const lignes = await lignesJournal(toutes);
  const envoisOk = lignes.filter((j) => j.succes && (j.action || "").indexOf("demande-creation") === 0);
  check("Journal : " + envoisOk.length + " envoi(s) de demandes confirmés (succès, smtp.zoho.com:465)",
    envoisOk.length >= 6, "succès=" + envoisOk.length);
  const transmission = lignes.find((j) => j.succes && (j.action || "").indexOf("validation-n1") >= 0 && j.dest === EMAIL_RH) ||
    lignes.find((j) => j.succes && (j.dest === EMAIL_RH) && (j.action || "").indexOf("demande-creation") < 0);
  check("Transmission RH après acceptation manager : e-mail RÉEL parti à " + EMAIL_RH, Boolean(transmission),
    transmission ? "action=" + transmission.action + " ref=" + transmission.reference : "(à vérifier : réponse RH jouable EN DIRECT)");

  return resume({ congE2, autE2 });

  function resume(ctx) {
    const congE2 = (ctx && ctx.congE2) || { ref: "(inconnu)" };
    console.log("\n== RÉCAPITULATIF ==" + (fail ? " (" + fail + " échec(s))" : ""));
    console.log("E-mails RÉELS envoyés via Zoho vers VOS boîtes :");
    console.log("  • " + EMAIL_RH + " : 2 attestations + congé + autorisation (scénario 1) + transmission RH + copies");
    console.log("  • " + EMAIL_EMPLOYE + " : confirmations automatiques de chaque demande + décisions");
    console.log("  • " + ZOHO_USER + " (INBOX) : congé/autorisation scénario 2 + VOS réponses de test");
    console.log("\nPOUR CONTINUER EN DIRECT (boucle réponses complète) :");
    console.log("  1. Ouvrez " + EMAIL_RH + " (vérifiez les INDÉSIRABLES si besoin) :");
    console.log("     vous y verrez « AutoRH — Attestation de travail/salaire DEM-… » etc.");
    console.log("  2. RÉPONDEZ à l'un de ces e-mails depuis ce compte Gmail en écrivant");
    console.log("     « Acceptée » ou « Refusée » (ou « J'accepte » / « Je refuse »).");
    console.log("  3. Le portail relève imap.zoho.com:993 toutes les 120 s : la décision");
    console.log("     s'enregistre TOUTE SEULE (matrice : manager puis RH pour congé/autorisation).");
    console.log("  4. Le congé " + (congE2 ? congE2.ref : "") + " est « Accepté par le Manager — en attente RH » :");
    console.log("     répondez « Acceptée » à l'e-mail de transmission reçu sur " + EMAIL_RH + ".");
    console.log("     Votre réponse achèvera la validation (étape 2) en direct.");
    return { ok, fail };
  }
}

main()
  .then(async (r) => {
    console.log("\nBilan : " + r.ok + " OK / " + r.fail + " FAIL");
    await db.$disconnect?.();
    process.exit(r.fail ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("ERREUR FATALE:", e && (e.stack || e.message || e));
    await db.$disconnect?.();
    process.exit(2);
  });
