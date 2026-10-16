"use strict";
/**
 * Task 252 (v0.2.162) — CORRECTION « STATUTS NON MIS À JOUR APRÈS RÉPONSE E-MAIL »
 * ================================================================================
 * Causes racines (diagnostic préalable OBLIGATOIRE — voir worklog) :
 *   1. (opérationnelle, 10-08 21:00→22:18) SMTP « 535 Invalid login » + IMAP
 *      « Invalid credentials » en échec TOTAL pendant la session de test de
 *      l'utilisateur : demandes jamais envoyées, réponses jamais lues.
 *      → config réparée depuis (Task 251) ; vérifiée en début de test.
 *   2. (code) TYPES_CLASSIFICATION_AUTO excluais ATTESTATION_TRAVAIL/SALAIRE →
 *      une réponse TEXTE (« Acceptée », « Refusée »…) était IGNORÉE.
 *      → corrigé : classification étendue aux 4 types.
 *   3. (code) acceptation RH par e-mail AVANT décision manager → statut
 *      RESTAIT « En attente » (matrice 2 étapes). → corrigé : RH autorité finale.
 *   4. (code) auto-réponses Gmail (RH répond depuis la boîte = boîte système)
 *      marquées LUES → invisibles pour search({seen:false}).
 *      → corrigé : scan boîte « Envoyés » (fenêtre 10 min) + dédoublonnage
 *      Message-ID (reponsesRecues.messageId).
 *   5. (latence) plafond 50 messages/passage (≈85 s) → corrigé : 12 (≈20-30 s).
 *
 * CE TEST (Gmail RÉEL) : 9 réponses RH —
 *   - 8 via APPEND IMAP dans [Gmail]/Sent Mail : simulation EXACTE d'une
 *     auto-réponse Gmail (AUCUNE copie INBOX → seul le scan Envoyés la voit) ;
 *   - 1 via SMTP classique (copie INBOX NON LUE → voie historique).
 * Par scénario : latence mesurée (exigence < 60 s) + visibilité sur les DEUX
 * interfaces (API administration :4000 + API portail employé :4001).
 *
 * Usage : node scripts/test_task252_statuts_email_4types.js [nettoyage]
 */
const M = require("./test_task251_pj_reponses_deux_portails.js");
const {
  check, sleep, dech, relire, totpNow, clientHttp, avecImap, attendreMessageId, db,
  PORTAIL, ADMIN, SUPERADMIN, GMAIL_USER, GMAIL_APP, SMTP_HOST, SMTP_PORT,
  IMAP_HOST, IMAP_PORT, MDP_PORTAIL, SECRET_TOTP,
} = M;
const fs = require("fs");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const ImapFlow = require("imapflow").ImapFlow;

const ETAT = "/tmp/task252/etat.json";
const TIMEOUT_STATUT = 90000;      // au-delà : échec du scénario
const EXIGENCE_MS = 60000;         // exigence utilisateur : < 60 s

/* ------------------------------- cas de test ------------------------------- */
// voie "SENT" : APPEND dans [Gmail]/Sent Mail (auto-réponse marquée lue)
// voie "SMTP" : envoi SMTP classique (copie INBOX non lue — voie historique)
const CAS = [
  { cle: "C-A",  cin: "EMPZOH001", type: "CONGE",                voie: "SENT", texte: "Je valide cette demande de congé.",                     attendu: "ACCEPTEE" },
  { cle: "C-R",  cin: "EMPZOH001", type: "CONGE",                voie: "SENT", texte: "Je refuse cette demande de congé.",                     attendu: "REFUSEE" },
  { cle: "A-A",  cin: "EMPZOH002", type: "AUTORISATION_SORTIE",  voie: "SENT", texte: "Demande acceptée.",                                     attendu: "ACCEPTEE" },
  { cle: "A-R",  cin: "EMPZOH002", type: "AUTORISATION_SORTIE",  voie: "SENT", texte: "Je refuse cette autorisation de sortie.",               attendu: "REFUSEE" },
  { cle: "AT-A", cin: "EMPZOH001", type: "ATTESTATION_TRAVAIL",  voie: "SENT", texte: "Attestation acceptée, à retirer au service.",           attendu: "ACCEPTEE" },
  { cle: "AT-R", cin: "EMPZOH001", type: "ATTESTATION_TRAVAIL",  voie: "SENT", texte: "Je refuse cette attestation de travail.",               attendu: "REFUSEE" },
  { cle: "AS-A", cin: "EMPZOH002", type: "ATTESTATION_SALAIRE",  voie: "SENT", texte: "OK pour moi, demande validée.",                         attendu: "ACCEPTEE" },
  { cle: "AS-R", cin: "EMPZOH002", type: "ATTESTATION_SALAIRE",  voie: "SENT", texte: "Attestation de salaire refusée — période non justifiée.",  attendu: "REFUSEE" },
  { cle: "SM-A", cin: "EMPZOH001", type: "ATTESTATION_SALAIRE",  voie: "SMTP", texte: "Je valide cette demande.",                              attendu: "ACCEPTEE" },
];

function libelleType(t) {
  return t === "CONGE" ? "Congé"
    : t === "AUTORISATION_SORTIE" ? "Autorisation de sortie"
    : t === "ATTESTATION_TRAVAIL" ? "Attestation de travail"
    : "Attestation de salaire";
}
function corpsDemande(c) {
  if (c.type === "CONGE") return { type: c.type, typeConge: "Congé annuel", dateDebut: "2027-03-08", dateFin: "2027-03-12", commentaire: "Dossier Task 252 (statuts par réponse e-mail)" };
  if (c.type === "AUTORISATION_SORTIE") return { type: c.type, date: "2027-03-10", motif: "Démarche Task 252 (statuts par réponse e-mail)", nombreHeures: "2", heureSortie: "14:00", heureRetour: "16:00", compensation: "NON" };
  return { type: c.type };
}
function mimeReponse(c, inReplyTo, idMessage) {
  const sujet = "Re: AutoRH — " + libelleType(c.type) + " " + c.ref;
  return [
    "From: Auto-RH Auto-RH (Task 252) <" + GMAIL_USER + ">",
    "To: " + GMAIL_USER,
    "Subject: " + sujet,
    "Date: " + new Date().toUTCString(),
    "Message-ID: <" + idMessage + ">",
    "In-Reply-To: <" + inReplyTo + ">",
    "References: <" + inReplyTo + ">",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    c.texte,
    "",
  ].join("\r\n");
}
/** APPEND réel de la réponse DANS la boîte « Envoyés » (pas de copie INBOX).
 * Le chemin est DÉTECTÉ (Gmail francophone : [Gmail]/Messages envoyés) — un
 * chemin codé en dur échoue sur les comptes non anglophones. */
async function cheminBoiteEnvoyes(cl) {
  const liste = await cl.list();
  const envoyee = (liste || []).find((m) => m && (m.specialUse === "\\Sent" || /\bsent\b|envoy/i.test(String(m.path || ""))));
  if (!envoyee) throw new Error("Boîte Envoyés introuvable (list=" + (liste || []).map((m) => m.path).join(", ").slice(0, 150) + ")");
  return envoyee.path;
}
async function appenderReponseEnvoyes(c, inReplyTo, idMessage) {
  const brut = Buffer.from(mimeReponse(c, inReplyTo, idMessage), "utf8");
  // connexion DÉDIÉE : avecImap() tient le verrou INBOX — un second
  // getMailboxLock() sur la même connexion attendrait indéfiniment (deadlock).
  const cl = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
  await cl.connect();
  const chemin = await cheminBoiteEnvoyes(cl);
  const lock = await cl.getMailboxLock(chemin);
  try { await cl.append(chemin, brut); } finally { lock.release(); await cl.logout().catch(() => {}); }
  return idMessage;
}
/** Voie SMTP classique : vrai envoi auto-adressé (copie INBOX NON lue). */
async function envoyerReponseSmtp(c, inReplyTo, idMessage) {
  const t = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, connectionTimeout: 20000 });
  const sujet = "Re: AutoRH — " + libelleType(c.type) + " " + c.ref;
  const info = await t.sendMail({
    from: '"Auto-RH Auto-RH (Task 252)" <' + GMAIL_USER + ">", to: GMAIL_USER,
    subject: sujet, text: c.texte,
    inReplyTo: "<" + inReplyTo + ">", references: "<" + inReplyTo + ">",
  });
  return info.messageId || "<" + idMessage + ">";
}
/** Attend le statut attendu et mesure la latence (échantillonnage 2 s). */
async function mesurerLatence(ref, attendu, timeoutMs) {
  const debut = Date.now();
  for (;;) {
    const d = await relire(ref);
    if (d && d.statut === attendu) return { d, ms: Date.now() - debut, ok: true };
    if (Date.now() - debut > (timeoutMs || TIMEOUT_STATUT)) return { d, ms: Date.now() - debut, ok: false };
    await sleep(2000);
  }
}
async function statutPortailEmploye(session, ref) {
  const r = await session.get("/api/mes-demandes");
  // forme : { cin, items: [{ reference, statut, ... }] }
  const items = (r.json && (r.json.items || r.json.demandes)) || (Array.isArray(r.json) ? r.json : []);
  const ligne = items.find((d) => d.reference === ref);
  return ligne ? ligne.statut : null;
}
async function statutAdmin(adm, ref) {
  // forme : { total, compteurs, items: [{ reference, statut, ... }] }
  const r = await adm.get("/api/demandes");
  const items = (r.json && (r.json.items || r.json.demandes)) || [];
  const ligne = items.find((d) => d.reference === ref);
  return ligne ? ligne.statut : null;
}

/* --------------------------------- main ----------------------------------- */
// Tranches (sandbox tue les longs runs) : node ... test <début> <fin exclusive>
// Le flux principal ne s'exécute QUE en mode « test » (jamais en verif/nettoyage).
const ARG_DEB = process.argv[2] === "test" ? (parseInt(process.argv[3], 10) || 0) : 0;
const ARG_FIN = process.argv[2] === "test" && process.argv[4] !== undefined ? parseInt(process.argv[4], 10) : CAS.length;
const CIBLES = CAS.slice(ARG_DEB, ARG_FIN);
if (process.argv[2] === "test") (async () => {
  console.log("============================================================");
  console.log("  Task 252 — statuts par réponse e-mail (tranche " + ARG_DEB + ".." + ARG_FIN + ")");
  console.log("============================================================");

  // ---- 0) services vivants ----
  const s4000 = await fetch(ADMIN + "/login", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  const s4001 = await fetch(PORTAIL, { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  check("Services vivants (admin " + s4000 + " / portail " + s4001 + ")", s4000 === 200 && s4001 === 200, "node scripts/redemarrer-services-4000-4001.js si besoin");

  // ---- 1) connexions réelles ----
  const adm = clientHttp(ADMIN);
  const lg = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion administration (:4000, superadmin lab)", lg.status === 200, "status=" + lg.status);
  const sessions = {};
  for (const cin of ["EMPZOH001", "EMPZOH002"]) {
    const p = clientHttp(PORTAIL);
    let r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
    if (!(r.status === 200 && r.json && r.json.ok)) { await sleep(15000); r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
    check("Connexion portail employé (:4001, " + cin + ")", r.status === 200 && r.json && r.json.ok, "status=" + r.status);
    sessions[cin] = p;
  }

  // ---- 2) création des demandes via le VRAI portail (reprise si état) ----
  const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { cas: {}, nettoyage: [] };
  fs.mkdirSync("/tmp/task252", { recursive: true });
  console.log("\n— Création des demandes (portail réel, SMTP Gmail réel) —");
  for (const c of CIBLES) {
    const connu = etat.cas[c.cle];
    const existante = connu && connu.ref && (await relire(connu.ref));
    if (existante) { c.ref = connu.ref; c.id = existante.id; check(c.cle + " : REPRISE → " + c.ref, true, "statut=" + existante.statut); continue; }
    const r = await sessions[c.cin].post("/api/demandes", corpsDemande(c));
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    if ((r.status === 200 || r.status === 201) && ref) {
      c.ref = ref;
      const d0 = await relire(ref);
      c.id = d0 && d0.id;
      // (reprise) la référence est enregistrée IMMÉDIATEMENT — un arrêt brutal
      // entre création et réponse ne recrée PAS de demandes en double.
      etat.cas[c.cle] = Object.assign({}, etat.cas[c.cle], { ref: c.ref });
      fs.writeFileSync(ETAT, JSON.stringify(etat, null, 2));
      check("Demande " + c.cle + " créée (" + c.type + ") → " + ref, true, "status=" + r.status);
    } else {
      check("Demande " + c.cle + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 120));
    }
    await sleep(500);
  }
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 2));

  // messageIdEnvoi requis pour In-Reply-To
  for (const c of CIBLES) {
    if (!c.ref) continue;
    const d = await attendreMessageId(c.ref, 90000);
    c.inReplyTo = d && d.messageIdEnvoi ? String(d.messageIdEnvoi).replace(/[<>]/g, "").trim() : null;
    check(c.cle + " : Message-ID d'envoi disponible", !!c.inReplyTo, c.inReplyTo ? c.inReplyTo.slice(0, 40) : "absent");
  }

  // ---- 3) injections séquentielles + latence + deux interfaces ----
  console.log("\n— Réponses RH e-mail (Gmail réel) → mesure latence < 60 s —");
  const latences = [];
  for (const c of CIBLES) {
    if (!c.ref || !c.inReplyTo) continue;
    const avant = await relire(c.ref);
    if (avant && avant.statut === c.attendu && etat.cas[c.cle] && etat.cas[c.cle].traite) {
      check(c.cle + " : REPRISE (déjà traité, statut " + c.attendu + ")", true, "latence=" + etat.cas[c.cle].ms + " ms"); continue;
    }
    const idMessage = "task252-" + c.cle.toLowerCase() + "-" + Date.now() + "@auto-rh-test";
    const t0 = Date.now();
    // garde anti-blocage : une opération IMAP qui pend ne doit pas tuer la tranche
    const injection = (async () => {
      if (c.voie === "SENT") { await appenderReponseEnvoyes(c, c.inReplyTo, idMessage); c.messageId = "<" + idMessage + ">"; }
      else { c.messageId = await envoyerReponseSmtp(c, c.inReplyTo, idMessage); }
    })();
    const garde = new Promise((resoudre) => setTimeout(() => resoudre("timeout"), 45000));
    const sorti = await Promise.race([injection.then(() => "ok"), garde]);
    if (sorti !== "ok") { check(c.cle + " : réponse injectée (" + c.voie + ")", false, "délai d'injection dépassé (45 s)"); continue; }
    check(c.cle + " : réponse injectée (" + (c.voie === "SENT" ? "APPEND boîte Envoyés" : "SMTP classique") + ")", true, "« " + c.texte + " »");
    const res = await mesurerLatence(c.ref, c.attendu);
    const dansLeDelai = res.ok && res.ms < EXIGENCE_MS;
    check(c.cle + " : statut → " + c.attendu + " en " + (res.ms / 1000).toFixed(1) + " s (< 60 s exigé)", dansLeDelai, res.d && res.d.statut !== c.attendu ? "statut=" + res.d.statut + " (TIMEOUT)" : "ok");
    // les DEUX interfaces
    const stAdm = await statutAdmin(adm, c.ref);
    check(c.cle + " : interface ADMINISTRATION (:4000) affiche " + c.attendu, stAdm === c.attendu, "api=" + stAdm);
    const stPort = await statutPortailEmploye(sessions[c.cin], c.ref);
    check(c.cle + " : interface PORTAIL EMPLOYÉ (:4001) affiche " + c.attendu, stPort === c.attendu, "api=" + stPort);
    // trace de réponse + décision RH tracée (reponsesRecues est CHIFFRÉ et
    // écrit APRÈS la mise à jour du statut → re-poll jusqu'à 15 s)
    let trace = null;
    for (let attente = 0; attente < 8 && !trace; attente++) {
      await sleep(2000);
      const d = await relire(c.ref);
      let reps = [];
      try { const brut = dech(d.reponsesRecues); reps = brut ? JSON.parse(brut) : []; } catch (e) { reps = []; }
      const midPropre = String(c.messageId || "").replace(/[<>]/g, "");
      trace = reps.find((r2) => String(r2.messageId || "") === midPropre) || null;
    }
    check(c.cle + " : réponse tracée dans l'historique (role=rh, décision)", !!trace, trace ? "décision=" + trace.decision + " mid=" + String(trace.messageId || "").slice(0, 25) : "absente après 16 s");
    if (c.type === "CONGE" || c.type === "AUTORISATION_SORTIE") {
      const d2 = await relire(c.ref);
      check(c.cle + " : décision RH tracée (decisionRh)", d2.decisionRh === c.attendu, "decisionRh=" + d2.decisionRh);
    }
    latences.push({ cle: c.cle, ms: res.ms, ok: dansLeDelai });
    etat.cas[c.cle] = { ref: c.ref, traite: dansLeDelai, ms: res.ms, messageId: c.messageId };
    fs.writeFileSync(ETAT, JSON.stringify(etat, null, 2));
    await sleep(3000); // espacer les injections (plafond/passage propre)
  }

  // ---- 4) bilan ----
  console.log("\n— BILAN LATENCE —");
  const maxMs = Math.max(...latences.map((l) => l.ms), 0);
  for (const l of latences) console.log("   " + l.cle.padEnd(6) + (l.ms / 1000).toFixed(1).padStart(6) + " s" + (l.ok ? "  ✓" : "  ✗ DÉLAI DÉPASSÉ"));
  check("Toutes les latences < 60 s", latences.length === CIBLES.length && latences.every((l) => l.ok), "max=" + (maxMs / 1000).toFixed(1) + " s");

  console.log("\nRésultat : " + M.getOK() + " OK / " + M.getFail() + " échec(s)");
  console.log("Nettoyage : node scripts/test_task252_statuts_email_4types.js nettoyage");
  await db.$disconnect();
  process.exit(M.getFail() ? 1 : 0);
})().catch((e) => { console.error("ERREUR FATALE:", e); db.$disconnect(); process.exit(1); });

/* --------------------- mode VERIF (reprise/corrections) -------------------- */
// Re-vérifie statut (base) + DEUX interfaces + trace déchiffrée pour chaque
// scénario déjà traité — permet de clôturer les vérifications d'une tranche
// interrompue sans ré-injecter de réponses.
if (process.argv[2] === "verif") {
  (async () => {
    const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { cas: {} };
    const adm = clientHttp(ADMIN);
    const lg = await adm.post("/api/auth/login", SUPERADMIN);
    check("Connexion administration (verif)", lg.status === 200, "status=" + lg.status);
    const sessions = {};
    for (const cin of ["EMPZOH001", "EMPZOH002"]) {
      const p = clientHttp(PORTAIL);
      const r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
      check("Connexion portail (verif, " + cin + ")", r.status === 200 && r.json && r.json.ok, "status=" + r.status);
      sessions[cin] = p;
    }
    for (const c of CAS) {
      const connu = etat.cas[c.cle];
      if (!connu || !connu.ref) continue;
      const d = await relire(connu.ref);
      if (!d) continue;
      const attendu = c.attendu;
      check(c.cle + " [verif] base : " + attendu, d.statut === attendu, "statut=" + d.statut);
      const stAdm = await statutAdmin(adm, connu.ref);
      check(c.cle + " [verif] interface ADMIN : " + attendu, stAdm === attendu, "api=" + stAdm);
      const stPort = await statutPortailEmploye(sessions[c.cin], connu.ref);
      check(c.cle + " [verif] interface PORTAIL : " + attendu, stPort === attendu, "api=" + stPort);
      let reps = [];
      try { const brut = dech(d.reponsesRecues); reps = brut ? JSON.parse(brut) : []; } catch (e) { reps = []; }
      // trace par DÉCISION (le Message-ID exact peut différer après reprise)
      const decisionAttendue = attendu === "ACCEPTEE" ? "VALIDATION" : "REFUS";
      const trace = reps.find((r2) => r2.role === "rh" && r2.decision === decisionAttendue);
      check(c.cle + " [verif] trace historique (décision " + decisionAttendue + ")", !!trace, reps.length + " trace(s), décisions: " + reps.map((r2) => r2.decision).join(",") || "aucune");
    }
    console.log("\nVerif : " + M.getOK() + " OK / " + M.getFail() + " échec(s)");
    await db.$disconnect();
    process.exit(M.getFail() ? 1 : 0);
  })().catch((e) => { console.error("ERREUR FATALE:", e); db.$disconnect(); process.exit(1); });
}
/* ------------------------------- nettoyage -------------------------------- */
if (process.argv[2] === "nettoyage") {
  (async () => {
    const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { cas: {} };
    const refs = Object.values(etat.cas).map((c) => c.ref).filter(Boolean);
    for (const ref of refs) {
      const d = await relire(ref);
      if (!d) continue;
      const docs = await db.documentDemande.findMany({ where: { demandeId: d.id } });
      await db.documentDemande.deleteMany({ where: { demandeId: d.id } });
      await db.demandeAdministrative.delete({ where: { id: d.id } });
      console.log("  supprimée:", ref, "(" + docs.length + " document(s))");
    }
    // messages de test retirés de la boîte Gmail réelle (INBOX + Envoyés)
    const ids = Object.values(etat.cas).map((c) => c.messageId).filter(Boolean);
    if (ids.length) {
      // connexion DÉDIÉE (même raison que ci-dessus : pas de double verrou)
      const cl = new ImapFlow({ host: IMAP_HOST, port: IMAP_PORT, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP }, tls: { rejectUnauthorized: false }, logger: false });
      await cl.connect();
      const chemins = ["INBOX"];
      try { chemins.push(await cheminBoiteEnvoyes(cl)); } catch (e) { /* pas de boîte Envoyés */ }
      for (const chemin of chemins) {
        const lock = await cl.getMailboxLock(chemin);
        try {
          for (const mid of ids) {
            const uids = await cl.search({ header: { "message-id": mid } }, { uid: true });
            for (const uid of uids || []) { await cl.messageDelete(String(uid), { uid: true }); }
          }
        } finally { lock.release(); }
      }
      await cl.logout().catch(() => {});
      console.log("  messages de test retirés (INBOX + Envoyés):", ids.length);
    }
    fs.unlinkSync(ETAT);
    await db.$disconnect();
    process.exit(0);
  })();
}
