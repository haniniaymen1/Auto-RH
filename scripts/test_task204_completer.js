#!/usr/bin/env node
/**
 * Task 204 — COMPLÉTION : ré-injection des réponses volées par le poller du
 * déploiement réel de l'utilisateur (même boîte Zoho), avec RETRIES, puis
 * vérification finale complète (2 interfaces + journal + récapitulatif).
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
const { ImapFlow } = require("imapflow");

const PORTAIL = "http://localhost:4001";
const ADMIN = "http://localhost:4000";
const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const EMAIL_RH = "smtp.test@autorh.tn";
const CIN_EMP1 = "EMPZOH001";
const CIN_EMP2 = "EMPZOH002";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP = "Test-Zoho!2026";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function dech(v) { try { return cryptoBd.dechiffrerChamp(v) || ""; } catch { return ""; } }
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) { const v = A.indexOf(c.toUpperCase()); if (v < 0) continue; bits += v.toString(2).padStart(5, "0"); }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  return String(((((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6)).padStart(6, "0");
}
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps), redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null; try { json = JSON.parse(texte); } catch { /* html */ }
    return { status: res.status, json };
  };
  return { req, post: (p, c) => req("POST", p, c), get: (p) => req("GET", p) };
}

async function appenderReponse({ de, sujet, inReplyTo, texte, msgId }) {
  const entetes = [
    "From: " + de, "To: AutoRH <" + ZOHO_USER + ">", "Subject: " + sujet,
    "Date: " + new Date().toUTCString(), "Message-ID: <" + msgId + ">",
  ];
  if (inReplyTo) { entetes.push("In-Reply-To: <" + inReplyTo + ">"); entetes.push("References: <" + inReplyTo + ">"); }
  entetes.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit");
  const brut = entetes.join("\r\n") + "\r\n\r\n" + texte + "\r\n";
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO_USER, pass: ZOHO_PASS }, tls: { rejectUnauthorized: false }, logger: false });
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  try { await c.append("INBOX", Buffer.from(brut, "utf8")); } finally { lock.release(); await c.logout(); }
}

async function envoyerReponseSmtp({ sujet, inReplyTo, texte }) {
  const t = nodemailer.createTransport({ host: "smtp.zoho.com", port: 465, secure: true, auth: { user: ZOHO_USER, pass: ZOHO_PASS } });
  await t.sendMail({ from: ZOHO_USER, to: ZOHO_USER, subject: sujet, text: texte, inReplyTo: "<" + inReplyTo + ">", references: "<" + inReplyTo + ">" });
}

async function relire(ref) { return db.demandeAdministrative.findUnique({ where: { reference: ref } }); }
function sujetReponse(ref, type) {
  return "Re: AutoRH - " + (type === "CONGE" ? "Demande de conge" : "Autorisation de sortie") + " " + ref + " (traitement requis)";
}

/* attend qu'un prédicat devienne vrai ; ré-injecte la réponse tant que non. */
async function injecterEtAttendre(cas, maxTentatives) {
  for (let t = 1; t <= maxTentatives; t++) {
    const d0 = await relire(cas.ref);
    if (cas.pred(d0)) return true;
    const sujet = sujetReponse(cas.ref, cas.type);
    try {
      if (cas.smtpReel) {
        await envoyerReponseSmtp({ sujet, inReplyTo: cas.messageId, texte: cas.texte });
        console.log("  → [t" + t + "] SMTP RÉEL " + ZOHO_USER + " | " + cas.ref + " | « " + cas.texte.replace(/\n/g, " ").slice(0, 45) + " »");
      } else {
        await appenderReponse({ de: cas.de || EMAIL_RH, sujet, inReplyTo: cas.messageId, texte: cas.texte, msgId: "task204c-" + cas.ref + "-" + Date.now() + "@reponse.test" });
        console.log("  → [t" + t + "] IMAP APPEND (From " + (cas.de || EMAIL_RH) + ") | " + cas.ref + " | « " + cas.texte.replace(/\n/g, " ").slice(0, 45) + " »");
      }
    } catch (e) { console.log("  → [t" + t + "] ERREUR injection " + cas.ref + " : " + e.message); }
    // attend jusqu'à 75 s que le poller local traite (interval 15 s)
    for (let a = 0; a < 15; a++) {
      await sleep(5000);
      const d = await relire(cas.ref);
      if (cas.pred(d)) return true;
    }
    console.log("     pas encore traitée (peut-être volée par le poller du déploiement réel) — ré-injection");
  }
  const df = await relire(cas.ref);
  return cas.pred(df);
}

async function main() {
  const T0 = Date.now();
  console.log("== COMPLÉTION Task 204 — ré-injection avec retries + vérification finale ==");
  const adm = client(ADMIN);
  const sa = await adm.post("/api/auth/login", { email: "lab-e2e-116@autorh.local", password: "Lab116-e2e-71a50dccbbc8" });
  check("Connexion interface d'administration", sa.status === 200);
  const port1 = client(PORTAIL), port2 = client(PORTAIL);
  const r1 = await port1.post("/api/verify", { cin: CIN_EMP1, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  const r2 = await port2.post("/api/verify", { cin: CIN_EMP2, password: MDP, otp: totpNow(SECRET_TOTP), remember: false });
  check("Connexions portail employés (TOTP)", r1.status === 200 && r2.status === 200);

  /* état actuel des 18 cas */
  const ETAT = [
    { ref: "DEM-2026-00003", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00004", attendu: "REFUSEE" },
    { ref: "DEM-2026-00007", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00008", attendu: "ACCEPTEE" },
    { ref: "DEM-2026-00009", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00010", attendu: "ACCEPTEE" },
    { ref: "DEM-2026-00011", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00012", attendu: "REFUSEE" },
    { ref: "DEM-2026-00013", attendu: "REFUSEE" }, { ref: "DEM-2026-00014", attendu: "REFUSEE" },
    { ref: "DEM-2026-00015", attendu: "REFUSEE" }, { ref: "DEM-2026-00016", attendu: "EN_ATTENTE" },
    { ref: "DEM-2026-00017", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00018", attendu: "REFUSEE" },
    { ref: "DEM-2026-00019", attendu: "EN_ATTENTE" }, { ref: "DEM-2026-00021", attendu: "REFUSEE" },
  ];
  console.log("\n— État actuel —");
  const manquantes = [];
  for (const e of ETAT) {
    const d = await relire(e.ref);
    const okk = d.statut === e.attendu;
    console.log("   " + e.ref + " : " + d.statut + (okk ? " (attendu ✓)" : " ≠ attendu " + e.attendu));
    if (!okk && e.ref !== "DEM-2026-00016" && e.ref !== "DEM-2026-00019") manquantes.push(e);
  }

  /* réponses restantes (messageId relu de la BD) */
  const CAS = [];
  const FORMUL = {
    "DEM-2026-00011": "J'accorde le congé demandé.",
    "DEM-2026-00013": "NON",
    "DEM-2026-00017": "D'accord pour cette sortie.",
    "DEM-2026-00018": "Demande rejetée.",
  };
  for (const m of manquantes) {
    const d = await relire(m.ref);
    CAS.push({
      ref: m.ref, type: d.type, messageId: d.messageIdEnvoi, texte: FORMUL[m.ref],
      attendu: m.attendu, pred: (x) => x.statut === m.attendu,
    });
  }
  /* matrice 00020 : étape 1 manager (SMTP) puis étape 2 RH (APPEND) */
  CAS.push({
    ref: "DEM-2026-00020", type: "CONGE", smtpReel: true, etape: "manager",
    messageId: (await relire("DEM-2026-00020")).messageIdEnvoi, texte: "Congé accepté.",
    attendu: "manager", pred: (x) => x.decisionManager === "ACCEPTEE",
  });
  CAS.push({
    ref: "DEM-2026-00005", type: "CONGE", etape: "rh",
    messageId: (await relire("DEM-2026-00005")).messageIdEnvoi, texte: "Je valide la demande.",
    attendu: "ACCEPTEE", pred: (x) => x.statut === "ACCEPTEE",
  });

  console.log("\n— Ré-injection des réponses manquantes (" + CAS.length + ") —");
  for (const cas of CAS) {
    const fait = await injecterEtAttendre(cas, 4);
    check(cas.ref + " (" + (cas.etape || "réponse") + ") « " + cas.texte.replace(/\n/g, " ").slice(0, 40) + " » " +
      (cas.etape === "manager" ? "→ décision manager enregistrée" : "→ " + cas.attendu), fait);
  }
  /* étape 2 RH de la matrice 00020 (après décision manager) */
  const d20 = await relire("DEM-2026-00020");
  if (d20.decisionManager === "ACCEPTEE" && d20.statut === "EN_ATTENTE") {
    check("00020 INTERMÉDIAIRE : manager accepté, statut toujours En attente (étape RH requise)", true);
    const journal = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/).filter((l) => l.includes('"demande-transmission-rh"') && l.includes("DEM-2026-00020"));
    check("00020 TRANSMISSION RH réelle journalisée", journal.length > 0, journal.length + " entrée(s)");
    const fait = await injecterEtAttendre({
      ref: "DEM-2026-00020", type: "CONGE", etape: "rh",
      messageId: (await relire("DEM-2026-00020")).messageIdEnvoi, texte: "Je valide.",
      attendu: "ACCEPTEE", pred: (x) => x.statut === "ACCEPTEE",
    }, 4);
    check("00020 étape 2 RH « Je valide. » → ACCEPTEE (matrice complète)", fait);
  } else {
    check("00020 matrice : état intermédiaire attendu", false, "statut=" + d20.statut + " mgr=" + d20.decisionManager);
  }

  /* ---------- vérification finale ---------- */
  console.log("\n— VÉRIFICATION FINALE —");
  const FINALE = ETAT.concat([{ ref: "DEM-2026-00005", attendu: "ACCEPTEE" }, { ref: "DEM-2026-00020", attendu: "ACCEPTEE" }]);
  const itemsPortail = [];
  for (const s of [port1, port2]) {
    const mes = await s.get("/api/mes-demandes");
    itemsPortail.push(...((mes.json && mes.json.items) || []));
  }
  const listeAdm = await adm.get("/api/demandes");
  const itemsAdm = (listeAdm.json && listeAdm.json.items) || [];
  let koDb = 0, koPortail = 0, koAdm = 0;
  console.log("\n  RÉF          | BD        | PORTAIL                          | ADMIN");
  for (const e of FINALE) {
    const d = await relire(e.ref);
    const p = itemsPortail.find((x) => x.reference === e.ref);
    const a = itemsAdm.find((x) => x.reference === e.ref);
    const libAttendu = e.attendu === "ACCEPTEE" ? "Acceptée"
      : e.attendu === "REFUSEE" ? (d.refuseePar === "MANAGER" ? "Refusée par le Manager" : "Refusée par les RH") : "En attente";
    const okD = d.statut === e.attendu, okP = p && p.statutLibelle === libAttendu, okA = a && a.statut === e.attendu;
    if (!okD) koDb++; if (!okP) koPortail++; if (!okA) koAdm++;
    console.log("  " + e.ref + " | " + (okD ? d.statut : "KO:" + d.statut) + " | « " + (p ? p.statutLibelle : "??") + " »" + (okP ? "" : " ≠ « " + libAttendu + " »") + " | " + (okA ? (a.statut) : "KO:" + (a ? a.statut : "absent")));
  }
  check("BD : 18/18 statuts attendus", koDb === 0, (18 - koDb) + "/18");
  check("PORTAIL EMPLOYÉ : 18/18 libellés corrects", koPortail === 0, (18 - koPortail) + "/18");
  check("ADMINISTRATION : 18/18 statuts corrects", koAdm === 0, (18 - koAdm) + "/18");
  console.log("    compteurs admin : " + JSON.stringify(listeAdm.json && listeAdm.json.compteurs));

  /* tracé + journal */
  const dAcc = await relire("DEM-2026-00007");
  const dRef = await relire("DEM-2026-00012");
  check("Formulation reconnue TRACÉE (decisionRhNote)", /Formulation reconnue/.test(dAcc.decisionRhNote || ""), String(dAcc.decisionRhNote || "").slice(0, 60));
  check("Refus RH tracé (refuseePar=RH)", dRef.refuseePar === "RH" && dRef.statut === "REFUSEE", dRef.reference);
  const d20f = await relire("DEM-2026-00020");
  check("Matrice 00020 complète (manager + RH par e-mails réels)", d20f.statut === "ACCEPTEE" && d20f.decisionManager === "ACCEPTEE" && d20f.decisionRh === "ACCEPTEE");

  const lignesJournal = fs.readFileSync("logs/journal-emails.log", "utf8").split(/\r?\n/);
  const depuis = new Date(T0 - 3600000).toISOString().slice(0, 19);
  const actions = {};
  for (const l of lignesJournal) {
    try {
      const j = JSON.parse(l);
      const dateJ = String(j.horodatage || "").slice(0, 19);
      if (dateJ && dateJ < depuis) continue;
      if (j.action && (j.action.startsWith("demande-") || j.action === "doc-refus" || j.action === "doc-signe")) actions[j.action] = (actions[j.action] || 0) + 1;
    } catch { /* non JSON */ }
  }
  console.log("\n  Journal (dernière heure) : " + JSON.stringify(actions));

  console.log("\n==========================================================================");
  console.log("RÉSULTAT COMPLÉTION : " + ok + " OK / " + fail + " FAIL");
  console.log("==========================================================================");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR FATALE:", e && e.stack ? e.stack : e); process.exit(1); });
