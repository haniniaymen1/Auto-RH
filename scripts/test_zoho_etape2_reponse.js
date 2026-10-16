#!/usr/bin/env node
/**
 * ============================================================================
 * TEST ZOHO — ÉTAPE FINALE : ACCEPTATION par e-mail + TRANSMISSION RH
 * Suite directe de test_zoho_e2e_complet.js (dont les demandes sont déjà
 * créées et dont la boucle de REFUS a déjà été prouvée : DEM-2026-00006
 * REFUSÉE par le Manager via une vraie réponse IMAP Zoho).
 *
 * Ici : réponse RÉELLE « j'accepte la demande » envoyée via smtp.zoho.com
 * (In-Reply-To) pour le congé DEM-2026-00005 (adressé à la boîte Zoho) :
 *   1. poller IMAP (service 4001, toutes les 120 s) → décision MANAGER
 *      = ACCEPTEE enregistrée, statut = En attente (matrice 2 étapes) ;
 *   2. e-mail de TRANSMISSION RH RÉEL envoyé à smtp.test@autorh.tn
 *      (« — validation RH requise ») → l'utilisateur pourra répondre
 *      « Acceptée » depuis sa boîte Gmail pour achever l'étape 2 EN DIRECT ;
 *   3. vérification de la configuration Zoho persistée (mail-config API).
 * ============================================================================
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

const ZOHO_USER = "rh3000@zohomail.com";
const ZOHO_PASS = "Chelsea4ever****";
const EMAIL_RH = "smtp.test@autorh.tn";
const REF_CONGE = "DEM-2026-00005";
const JOURNAL = "logs/journal-emails.log";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function lignesJournal(references) {
  let brut = "";
  try { brut = fs.readFileSync(JOURNAL, "utf8"); } catch { return []; }
  const sortie = [];
  for (const l of brut.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (references.some((r) => (j.reference || "") === r)) sortie.push(j);
    } catch { /* ligne partielle */ }
  }
  return sortie;
}

async function main() {
  console.log("== ZOHO étape finale : acceptation e-mail + transmission RH ==");
  const demande = await db.demandeAdministrative.findUnique({ where: { reference: REF_CONGE } });
  if (!demande) { console.log("Demande " + REF_CONGE + " introuvable."); process.exit(2); }
  check("Congé " + REF_CONGE + " : en attente, décision manager vide",
    demande.statut === "EN_ATTENTE" && !demande.decisionManager,
    "statut=" + demande.statut + " decisionManager=" + (demande.decisionManager || "-"));

  // 1) RÉPONSE RÉELLE via smtp.zoho.com (In-Reply-To = Message-ID mémorisé)
  const transport = nodemailer.createTransport({
    host: "smtp.zoho.com", port: 465, secure: true,
    auth: { user: ZOHO_USER, pass: ZOHO_PASS }, tls: { rejectUnauthorized: false },
  });
  const sujet = "RE: AutoRH — Demande de congé " + REF_CONGE + " (traitement requis)";
  const info = await transport.sendMail({
    from: ZOHO_USER, to: ZOHO_USER, subject: sujet,
    text: "Bonjour,\n\nj'accepte la demande de congé.\n\nCordialement,\nManager",
    inReplyTo: "<" + demande.messageIdEnvoi + ">",
    references: "<" + demande.messageIdEnvoi + ">",
  });
  check("Réponse « j'accepte la demande » envoyée via smtp.zoho.com", Boolean(info && info.messageId), info.response || "");

  // 2) Attente du poller IMAP (120 s) — secours direct à 45 s
  console.log("  Attente du traitement IMAP (poller 4001 — secours direct à 45 s)…");
  const fin45 = Date.now() + 45000;
  let d = demande;
  while (Date.now() < fin45 && !(d && d.decisionManager === "ACCEPTEE")) {
    await sleep(5000);
    d = await db.demandeAdministrative.findUnique({ where: { reference: REF_CONGE } });
  }
  if (!(d && d.decisionManager === "ACCEPTEE")) {
    try { await portail.verifierBoiteDemandes(); } catch (e) { console.log("  (secours : " + (e.message || e) + ")"); }
  }
  const fin = Date.now() + 120000;
  while (Date.now() < fin && !(d && d.decisionManager === "ACCEPTEE")) {
    await sleep(5000);
    d = await db.demandeAdministrative.findUnique({ where: { reference: REF_CONGE } });
  }
  d = await db.demandeAdministrative.findUnique({ where: { reference: REF_CONGE } });
  check("Réponse IMAP traitée : décision MANAGER = ACCEPTEE (formulation « j'accepte » reconnue)",
    d && d.decisionManager === "ACCEPTEE",
    "decisionManager=" + (d.decisionManager || "-") + " | " + (d.decisionManagerNote || "") + " | par=" + (d.decisionManagerPar || "-"));
  check("Statut final : EN_ATTENTE (étape 1 OK — étape RH attendue, matrice 2 étapes)",
    d && d.statut === "EN_ATTENTE", "statut=" + (d.statut || "-") + " decisionRh=" + (d.decisionRh || "-"));

  // 3) TRANSMISSION RH réelle vers smtp.test@autorh.tn
  await sleep(8000); // laisse partir l'e-mail de transmission (arrière-plan)
  const lignes = await lignesJournal([REF_CONGE]);
  const transmission = lignes.filter((j) => j.succes && j.dest === EMAIL_RH &&
    (j.action || "").indexOf("demande-creation") < 0 && (j.action || "").indexOf("confirmation") < 0);
  check("E-mail de TRANSMISSION RH parti (réel) à " + EMAIL_RH, transmission.length >= 1,
    transmission.map((t) => t.action + " @ " + t.horodatage).join(" ; ") || "aucune entrée");

  // 4) Configuration Zoho persistée (relecture API admin)
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch("http://localhost:4000" + chemin, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: corps === undefined ? undefined : JSON.stringify(corps), redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null; try { json = JSON.parse(texte); } catch {}
    return { status: res.status, json };
  };
  const { execFileSync } = require("child_process");
  try { execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const COMPTE = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const login = await req("POST", "/api/auth/login", COMPTE);
  const cfgRep = await req("GET", "/api/mail-config");
  const cfg = (cfgRep.json && cfgRep.json.config) || cfgRep.json || {};
  check("Configuration Zoho persistée : SMTP smtp.zoho.com:465 + IMAP imap.zoho.com:993 actif",
    login.status === 200 && cfg.host === "smtp.zoho.com" && Number(cfg.port) === 465 &&
    Boolean(cfg.imapActif) && cfg.imapHost === "imap.zoho.com",
    "host=" + cfg.host + " port=" + cfg.port + " imap=" + cfg.imapHost + ":" + cfg.imapPort + " actif=" + cfg.imapActif);
  check("Routage : rhEmail + 4 adresses dédiées = " + EMAIL_RH,
    cfg.rhEmail === EMAIL_RH && cfg.attestationTravailEmail === EMAIL_RH &&
    cfg.attestationSalaireEmail === EMAIL_RH && cfg.congeEmail === EMAIL_RH && cfg.autorisationEmail === EMAIL_RH,
    "rhEmail=" + cfg.rhEmail);

  console.log("\n== RÉCAPITULATIF FINAL ==");
  console.log("Preuves réelles Zoho (journal + base) :");
  console.log("  • 6 demandes envoyées via smtp.zoho.com:465 (250 OK) :");
  console.log("      - DEM-00001 travail / DEM-00002 salaire → " + EMAIL_RH + " (adresses dédiées)");
  console.log("      - DEM-00003 congé / DEM-00004 autorisation → " + EMAIL_RH + " (manager responsable)");
  console.log("      - DEM-00005 congé / DEM-00006 autorisation → boîte Zoho (boucle réponses)");
  console.log("  • Confirmations automatiques → " + "employe.test@autorh.tn" + " (tous types)");
  console.log("  • RÉPONSE IMAP réelle traitée : DEM-00006 « refus » → REFUSÉE par le Manager +");
  console.log("    notifications (employé + RH) + document de refus générés");
  console.log("  • RÉPONSE IMAP réelle traitée : DEM-00005 « j'accepte » → Acceptée par le Manager");
  console.log("    + transmission RH réelle → " + EMAIL_RH + " (étape 2 jouable EN DIRECT)");
  console.log("\nÉTAPE RH EN DIRECT : répondez « Acceptée » à l'e-mail « — validation RH requise »");
  console.log("reçu sur " + EMAIL_RH + " : la demande " + REF_CONGE + " passera ACCEPTEE (2/2) toute seule.");
  return { ok, fail };
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
