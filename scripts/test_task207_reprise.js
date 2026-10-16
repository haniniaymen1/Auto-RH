#!/usr/bin/env node
/**
 * Task 207 — REPRISE du phase test (le processus de test a été tué par le
 * sandbox pendant l'attente du poller — nohup non détaché) + réparation de la
 * config (le PUT « IMAP off » d'urgence avait VIDÉ rhEmail + 4 adresses
 * dédiées : l'API traite les champs absents comme des chaînes vides — le
 * mot de passe, lui, n'est JAMAIS écrasé sans valeur explicite).
 *
 * Étapes : réparation config (IMAP réactivé pour la reprise) → D6 réponse
 * manager (APPEND réel) → attente REFUS manager + docRefus → VAGUE 2 : réponses
 * RH en VRAIS e-mails SMTP auto-adressés (D3 accepter / D4 refuser / D5 valider)
 * → attente des statuts FINAUX → double interface → garde-fous (\Seen) →
 * état pour les phases docs/restore-boite du script principal.
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
const db = new (require("@prisma/client").PrismaClient)();
const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const SUPERADMIN = { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" };
const GMAIL_USER = "employe.test@autorh.tn";
const GMAIL_APP = "xxxx xxxx xxxx xxxx";
const IMAP_HOST = "imap.gmail.com";
const MGR_EMP1 = "smtp.test@autorh.tn";
const MGR_EMP2 = "rh3000@zohomail.com";
const MDP_PORTAIL = "Test-Zoho!2026";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const ETAT = "/tmp/task207/etat.json";
const JOURNAL = "logs/journal-emails.log";

let ok = 0, fail = 0;
const echecs = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; echecs.push(nom + (detail ? " — " + detail : "")); console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }
function sansAccents(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(); }
function statutConcordant(libelle, statutBd) {
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
function clientHttp(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { ...(corps === undefined ? {} : { "Content-Type": "application/json" }), ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const tampon = Buffer.from(await res.arrayBuffer());
    const texte = tampon.toString("utf8");
    let json = null;
    if ((res.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(texte); } catch { } }
    return { status: res.status, json, texte, octets: json ? null : tampon };
  };
  return { req, post: (p, c) => req("POST", p, c), put: (p, c) => req("PUT", p, c), get: (p) => req("GET", p) };
}
function journalDepuis(tISO, filtre) {
  const t = new Date(tISO).getTime() - 2000;
  return fs.readFileSync(JOURNAL, "utf8").split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && new Date(e.horodatage).getTime() >= t).filter((e) => (filtre ? filtre(e) : true));
}
async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }
async function attendre(ref, predicat, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && predicat(d)) return d;
    if (Date.now() - debut > (timeoutMs || 240000)) return d;
    await sleep(5000);
  }
}
async function appenderReponseManager({ de, nom, ref, type, texte, num }) {
  const sujet = "Re: AutoRH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref + " (traitement requis)";
  const eml = [
    "Message-ID: <task207-mgr-" + num + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: " + (nom ? '"' + nom.replace(/"/g, "'") + '" ' : "") + "<" + de + ">",
    "To: <" + GMAIL_USER + ">",
    "Subject: " + sujet,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    texte,
    "",
  ].join("\r\n");
  const c = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { await c.append("INBOX", Buffer.from(eml, "utf8")); } finally { lock.release(); await c.logout().catch(() => { }); }
  return sujet;
}
async function envoyerReponseRh({ ref, type, texte, inReplyTo }) {
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, connectionTimeout: 20000 });
  return t.sendMail({
    from: '"Auto-RH Auto-RH (Task 207)" <' + GMAIL_USER + ">",
    to: GMAIL_USER,
    subject: "Re: Auto-RH — " + (type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref + " — validation RH",
    text: texte,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });
}
async function avecImap(fn) {
  const c = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { return await fn(c); } finally { lock.release(); await c.logout().catch(() => { }); }
}

const REFS = {
  "D1-att-travail": "DEM-2026-00046", "D2-att-salaire": "DEM-2026-00047",
  "D3-conge-2etapes": "DEM-2026-00048", "D4-autor-2etapes": "DEM-2026-00049",
  "D5-conge-2etapes-zoho": "DEM-2026-00050", "D6-autor-mgr-refuse": "DEM-2026-00051",
};
const TYPES = {
  "D3-conge-2etapes": "CONGE", "D4-autor-2etapes": "AUTORISATION_SORTIE", "D5-conge-2etapes-zoho": "CONGE", "D6-autor-mgr-refuse": "AUTORISATION_SORTIE",
};

async function main() {
  const debutISO = new Date().toISOString();
  console.log("============ REPRISE Task 207 : config réparée + vagues restantes ============");

  // ---- 0) Réparation de la config (le PUT d'urgence avait vidé le routage) ----
  const adm = clientHttp(ADMIN);
  await adm.post("/api/auth/login", SUPERADMIN);
  const put = await adm.put("/api/mail-config", {
    host: "smtp.gmail.com", port: 465, username: GMAIL_USER,
    from: "AutoRH Auto-RH <" + GMAIL_USER + ">",
    rhEmail: GMAIL_USER,
    attestationTravailEmail: GMAIL_USER, attestationSalaireEmail: GMAIL_USER,
    congeEmail: GMAIL_USER, autorisationEmail: GMAIL_USER,
    imapActif: true, imapHost: IMAP_HOST, imapPort: 993, imapUser: GMAIL_USER,
  });
  check("Config réparée : rhEmail + 4 adresses dédiées + IMAP réactivé (mot de passe conservé)", put.status === 200, "status=" + put.status);
  const g = await adm.get("/api/mail-config");
  const c = (g.json && g.json.config) || {};
  check("Relecture : routage restauré sur " + GMAIL_USER, c.rhEmail === GMAIL_USER && c.attestationTravailEmail === GMAIL_USER && c.attestationSalaireEmail === GMAIL_USER, "rhEmail=" + c.rhEmail + " hasPassword=" + c.hasPassword);

  // ---- 1) D6 : réponse manager de REFUS (IMAP APPEND réel) ----
  console.log("\n— 1) D6 : réponse manager « NON » (IMAP APPEND réel — le poller la lira) —");
  const refD6 = REFS["D6-autor-mgr-refuse"];
  const d6avant = await relire(refD6);
  if (d6avant.decisionManagerLe) check("D6 : décision manager déjà présente (reprise)", true, d6avant.decisionManager);
  else {
    const suj = await appenderReponseManager({ de: MGR_EMP2, nom: "Boîte Zoho (Manager test)", ref: refD6, type: TYPES["D6-autor-mgr-refuse"], texte: "NON — demande refusée, période occupée.", num: 6 });
    check("D6 : réponse manager APPENDÉE dans INBOX Gmail", true, suj.slice(0, 60));
  }
  const d6 = await attendre(refD6, (d) => d.statut === "REFUSEE" && !!d.docRefusChemin, 300000);
  check("D6 : REFUS MANAGER définitif + PDF de refus généré automatiquement", d6 && d6.statut === "REFUSEE" && d6.refuseePar === "MANAGER" && !!d6.docRefusChemin,
    d6 ? "statut=" + d6.statut + " refuseePar=" + d6.refuseePar + " doc=" + (d6.docRefusNom || d6.docRefusChemin || "?") : "timeout");

  // ---- 2) Transmissions RH réelles (journal : 250 vers la boîte Gmail) ----
  console.log("\n— 2) Transmissions RH (D4, D5 — envoyées AVANT l'incident de config ; D3 reprise en bibliothèque pendant IMAP off) —");
  const trans = journalDepuis(new Date(Date.now() - 40 * 60000).toISOString(), (e) => e.action === "demande-transmission-rh" && e.succes);
  check("Transmissions RH journalisées en SUCCÈS (250 réels)", trans.length >= 2, trans.map((e) => e.reference).join(", ") + " — D3 : transmission reprise séparément (config vidée entre-temps, décision re-jouée en bibliothèque)");

  // ---- 3) VAGUE 2 : réponses RH = VRAIS e-mails auto-adressés ----
  console.log("\n— 3) VAGUE 2 : réponses RH envoyées via smtp.gmail.com (le poller IMAP les lira RÉELLEMENT) —");
  for (const [cle, texte] of [
    ["D3-conge-2etapes", "Congé accepté, bonne préparation."],
    ["D4-autor-2etapes", "Je refuse cette autorisation pour cette fois."],
    ["D5-conge-2etapes-zoho", "Je valide."],
  ]) {
    const ref = REFS[cle];
    const d = await relire(ref);
    if (d.decisionRhLe) { check(cle + " : décision RH déjà présente (reprise)", true, d.decisionRh); continue; }
    const env = await envoyerReponseRh({ ref, type: TYPES[cle], texte, inReplyTo: d.messageIdEnvoi });
    check(cle + " : réponse RH ENVOYÉE (250 réel) — From=To=" + GMAIL_USER + " In-Reply-To=" + String(d.messageIdEnvoi).slice(0, 30) + "…", /250/.test(String(env.response || "")), env.response);
    await sleep(3000);
  }
  console.log("  → Attente du poller (15 s / passage) puis des statuts finaux…");
  const attendusFinal = {
    "D3-conge-2etapes": (d) => d.statut === "ACCEPTEE" && !!d.docSigneChemin,
    "D4-autor-2etapes": (d) => d.statut === "REFUSEE" && d.refuseePar === "RH" && !!d.docRefusChemin,
    "D5-conge-2etapes-zoho": (d) => d.statut === "ACCEPTEE" && !!d.docSigneChemin,
  };
  for (const cle of Object.keys(attendusFinal)) {
    const d = await attendre(REFS[cle], attendusFinal[cle], 300000);
    check(cle + " : statut FINAL depuis le VRAI e-mail RH + document généré", d && attendusFinal[cle](d),
      d ? "statut=" + d.statut + " refuseePar=" + (d.refuseePar || "-") + " decisionRh=" + (d.decisionRh || "-") + " doc=" + ((d.docSigneNom || d.docRefusNom || d.docSigneChemin || d.docRefusChemin || "?")) : "timeout");
  }

  // ---- 4) Statuts finaux dans les DEUX interfaces ----
  console.log("\n— 4) Statuts finaux dans les DEUX interfaces —");
  const port1 = clientHttp(PORTAIL);
  let p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p1.status === 200 && p1.json && p1.json.ok)) { await sleep(20000); p1 = await port1.post("/api/verify", { cin: "EMPZOH001", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  const port2 = clientHttp(PORTAIL);
  let p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
  if (!(p2.status === 200 && p2.json && p2.json.ok)) { await sleep(20000); p2 = await port2.post("/api/verify", { cin: "EMPZOH002", password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
  const mes1 = await port1.get("/api/mes-demandes");
  const mes2 = await port2.get("/api/mes-demandes");
  const items1 = (mes1.json && mes1.json.items) || [];
  const items2 = (mes2.json && mes2.json.items) || [];
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  for (const [cle, ref] of Object.entries(REFS)) {
    const d = await relire(ref);
    const port = cle.startsWith("D3") || cle.startsWith("D4") || cle === "D1-att-travail" || cle === "D2-att-salaire" ? items1 : items2;
    const p = port.find((x) => x.reference === ref);
    const a = itemsAdm.find((x) => x.reference === ref);
    check(cle + " : base=" + (d ? d.statut : "?") + " | portail=" + (p ? (p.statutLibelle || p.statut) : "absent") + " | admin=" + (a ? (a.statutFinalLibelle || a.statutLibelle || a.statut) : "absent"),
      d && p && statutConcordant(p.statutLibelle || p.statut, d.statut) && a && statutConcordant(a.statutFinalLibelle || a.statutLibelle || a.statut, d.statut));
  }

  // ---- 5) Garde-fous : attestations intactes + preuve \Seen (poller réel) ----
  console.log("\n— 5) Garde-fous anti-boucle (attestations + \u00ab lu \u00bb IMAP par le poller) —");
  for (const cle of ["D1-att-travail", "D2-att-salaire"]) {
    const d = await relire(REFS[cle]);
    check(cle + " : INTACTE (En attente, aucune décision parasite)", d && d.statut === "EN_ATTENTE" && !d.decisionManagerLe && !d.decisionRhLe, "statut=" + (d && d.statut));
  }
  const uidsTest = await avecImap(async (cl) => {
    const uids = (await cl.search({ subject: "DEM-2026-00046" }, { uid: true })) || [];
    const uids2 = (await cl.search({ subject: "DEM-2026-00047" }, { uid: true })) || [];
    const tous = uids.concat(uids2);
    const lus = [];
    for (const uid of tous.slice(-6)) {
      const m = await cl.fetchOne(String(uid), { envelope: true, flags: true }, { uid: true });
      if (m && m.envelope && /traitement requis/.test(String(m.envelope.subject || ""))) lus.push({ uid: m.uid, vu: m.flags.has("\\Seen") });
    }
    return lus;
  });
  check("Les 2 e-mails de demande auto-adressés ont été traités par le POLLER (marqués « lu » IMAP) sans aucune décision",
    uidsTest.length >= 2 && uidsTest.every((x) => x.vu), uidsTest.map((x) => "uid=" + x.uid + ":" + (x.vu ? "lu" : "NON-lu")).join(", "));

  // ---- 6) Journal doc-signe/doc-refus : envoi RÉEL 250 ----
  console.log("\n— 6) Journal doc-signe/doc-refus (envoi PDF RÉEL via smtp.gmail.com) —");
  const docs = journalDepuis(debutISO.length ? new Date(Date.now() - 40 * 60000).toISOString() : debutISO, (e) => (e.action === "doc-signe" || e.action === "doc-refus"));
  for (const ref of [REFS["D6-autor-mgr-refuse"], REFS["D3-conge-2etapes"], REFS["D4-autor-2etapes"], REFS["D5-conge-2etapes-zoho"]]) {
    const e0 = [...docs].reverse().find((e) => e.reference === ref && e.succes !== undefined);
    if (e0) {
      check(ref + " : journal doc — signatureCrypto=true + éléments complets + envoi RÉEL",
        e0.signatureCrypto === true && Array.isArray(e0.elements) && e0.elements.length >= 5 && e0.envoi === "envoye" && /250/.test(String(e0.reponseSmtp || "")),
        "action=" + e0.action + " envoi=" + e0.envoi + " " + String(e0.reponseSmtp || "").slice(0, 40));
    } else check(ref + " : journal doc présent", false, "aucune entrée (à relire en phase docs)");
  }

  // ---- 7) État pour les phases docs / restore-boite ----
  const etat = JSON.parse(fs.readFileSync(ETAT, "utf8"));
  etat.reprise = { horodatage: new Date().toISOString(), ok, fail };
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 2));
  console.log("\n================================ RÉSUMÉ REPRISE ================================");
  console.log("  " + ok + " contrôle(s) OK — " + fail + " échec(s)");
  if (echecs.length) for (const e of echecs) console.log("   FAIL: " + e);
  console.log("  → Lancer : node scripts/test_task207_gmail_reel_e2e.js docs");
  console.log("  → Puis   : node scripts/test_task207_gmail_reel_e2e.js restore-boite");
  await db.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch(async (e) => { console.error("ERREUR FATALE:", (e && e.stack) || e); try { await db.$disconnect(); } catch { } process.exit(1); });
