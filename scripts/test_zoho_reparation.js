#!/usr/bin/env node
/* Réparation finale du test Zoho :
 * 1. Acceptation avec formulation RECONNUE (« Je valide la demande ») pour
 *    DEM-2026-00005 → décision manager + transmission RH réelle.
 * 2. Restituer la réponse RÉELLE de l'utilisateur (Re: DEM-2026-00013 de
 *    smtp.test@autorh.tn, consommée par le poller du sandbox à 18:33)
 *    en NON LU pour que SON déploiement puisse la traiter.
 * 3. Désactiver le poller IMAP du sandbox (imapActif=false) : fin de la
 *    course avec le déploiement de l'utilisateur sur la même boîte Zoho.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");

const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const EMAIL_RH = "smtp.test@autorh.tn";
const JOURNAL = "logs/journal-emails.log";
let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  // ---- 1) acceptation avec formulation reconnue ----
  console.log("— 1) Acceptation « Je valide » (formulation reconnue) —");
  const REF = "DEM-2026-00005";
  let d = await db.demandeAdministrative.findUnique({ where: { reference: REF } });
  if (d.decisionManager === "ACCEPTEE") {
    check("Décision manager déjà enregistrée (ACCEPTEE)", true);
  } else {
    const transport = nodemailer.createTransport({
      host: "smtp.zoho.com", port: 465, secure: true,
      auth: { user: ZOHO_USER, pass: ZOHO_PASS }, tls: { rejectUnauthorized: false },
    });
    const info = await transport.sendMail({
      from: ZOHO_USER, to: ZOHO_USER,
      subject: "RE: AutoRH — Demande de congé " + REF + " (traitement requis)",
      text: "Bonjour,\n\nJe valide la demande de congé.\n\nCordialement,\nManager",
      inReplyTo: "<" + d.messageIdEnvoi + ">",
      references: "<" + d.messageIdEnvoi + ">",
    });
    check("Réponse « Je valide la demande » envoyée via smtp.zoho.com", Boolean(info && info.messageId), info.response || "");
    console.log("  Attente poller 4001 (120 s)…");
    const fin = Date.now() + 200000;
    while (Date.now() < fin) {
      await sleep(6000);
      d = await db.demandeAdministrative.findUnique({ where: { reference: REF } });
      if (d && d.decisionManager === "ACCEPTEE") break;
    }
    check("Décision MANAGER = ACCEPTEE enregistrée par IMAP", d && d.decisionManager === "ACCEPTEE",
      "decisionManager=" + (d.decisionManager || "-") + " note=" + (d.decisionManagerNote || "-"));
  }

  // transmission RH
  await sleep(10000);
  let brut = "";
  try { brut = fs.readFileSync(JOURNAL, "utf8"); } catch {}
  const transmission = brut.split(/\r?\n/).filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((j) => j && j.reference === REF && j.succes && j.dest === EMAIL_RH &&
    (j.action || "").indexOf("demande-creation") < 0 && (j.action || "").indexOf("confirmation") < 0);
  check("E-mail de TRANSMISSION RH parti à " + EMAIL_RH + " (réel)", transmission.length >= 1,
    transmission.map((t) => t.action + " @ " + (t.horodatage || "")).join(" ; ") || "aucune entrée");

  // ---- 2) restituer la réponse de l'utilisateur en NON LU ----
  console.log("\n— 2) Restitution de la réponse utilisateur (Re: DEM-2026-00013) en NON LU —");
  const client = new ImapFlow({
    host: "imap.zoho.com", port: 993, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS }, tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  let restitue = 0;
  try {
    const uids = await client.search({ since: new Date(Date.now() - 14400000) }, { uid: true });
    for (const uid of uids) {
      const m = await client.fetchOne(String(uid), { envelope: true, flags: true }, { uid: true });
      if (!m || !m.envelope) continue;
      const sujet = m.envelope.subject || "";
      const de = m.envelope.from && m.envelope.from[0] ? m.envelope.from[0].address : "";
      // TOUTES les réponses venant des boîtes Gmail de l'utilisateur sont
      // restituées (non lu) — son déploiement doit pouvoir les traiter.
      if (de === EMAIL_RH && sujet.indexOf("DEM-") >= 0 && (m.flags || new Set()).has("\\Seen")) {
        await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
        restitue++;
        console.log("  restituée (non lu) : « " + sujet.slice(0, 70) + " » de " + de);
      }
    }
  } finally { lock.release(); }
  await client.logout();
  check("Réponse(s) utilisateur restituée(s) en NON LU pour SON déploiement", restitue >= 1, restitue + " message(s)");

  // ---- 3) désactiver le poller IMAP du sandbox ----
  console.log("\n— 3) Arrêt du poller IMAP du sandbox (fin de la course entre les 2 systèmes) —");
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch("http://localhost:4000" + chemin, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps), redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    let json = null; try { json = JSON.parse(await res.text()); } catch {}
    return { status: res.status, json };
  };
  const { execFileSync } = require("child_process");
  try { execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const COMPTE = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const login = await req("POST", "/api/auth/login", COMPTE);
  const cfgActuelle = await req("GET", "/api/mail-config");
  const cfg = (cfgActuelle.json && cfgActuelle.json.config) || {};
  const put = await req("PUT", "/api/mail-config", {
    host: cfg.host || "smtp.zoho.com", port: cfg.port || 465,
    username: cfg.username || ZOHO_USER, password: ZOHO_PASS, from: cfg.from || "",
    rhEmail: cfg.rhEmail || EMAIL_RH,
    attestationTravailEmail: cfg.attestationTravailEmail || EMAIL_RH,
    attestationSalaireEmail: cfg.attestationSalaireEmail || EMAIL_RH,
    congeEmail: cfg.congeEmail || EMAIL_RH,
    autorisationEmail: cfg.autorisationEmail || EMAIL_RH,
    imapActif: false, imapHost: "imap.zoho.com", imapPort: 993, imapUser: "", imapPassword: "",
  });
  const relit = await req("GET", "/api/mail-config");
  const cfg2 = (relit.json && relit.json.config) || {};
  check("Poller IMAP du sandbox DÉSACTIVÉ (imapActif=false) — SMTP conservé",
    put.status === 200 && !cfg2.imapActif && cfg2.host === "smtp.zoho.com",
    "imapActif=" + cfg2.imapActif + " smtp=" + cfg2.host + ":" + cfg2.port);

  console.log("\n== BILAN RÉPARATION ==");
  console.log("  OK=" + ok + " FAIL=" + fail);
  console.log("  Le sandbox n'écoute plus la boîte Zoho : VOTRE déploiement reçoit les réponses.");
  console.log("  La réponse de l'utilisateur (Re: DEM-2026-00013) est de retour NON LU.");
  return { ok, fail };
}

main()
  .then(async (r) => { await db.$disconnect?.(); process.exit(r.fail ? 1 : 0); })
  .catch(async (e) => { console.error("ERREUR:", e && (e.stack || e.message || e)); await db.$disconnect?.(); process.exit(2); });
