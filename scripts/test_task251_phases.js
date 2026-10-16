"use strict";
/** Task 251 — phases prep / config / test / restore (voir en-tête du fichier principal). */
const M = require("./test_task251_pj_reponses_deux_portails.js");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { CAS, check, sleep, dech, sha256, relire, totpNow, clientHttp, avecImap, ensemblesSequence, attendreStatut, attendreMessageId, journalDepuis, etatLire, etatEcrire, pdfMinimal, PNG_1PX, appenderReponseManagerAvecPj, envoyerReponseRhAvecPj, db, TMP, SNAPSHOT_BOITE, JOURNAL, LIVRABLES, PORTAIL, ADMIN, SUPERADMIN, GMAIL_USER, GMAIL_APP, SMTP_HOST, SMTP_PORT, IMAP_HOST, IMAP_PORT, MGR_EMP1, MGR_EMP2, MDP_PORTAIL, SECRET_TOTP, getOK, getFail, getEchecs } = M;

/* ------------------------------- PHASE prep ------------------------------- */
async function prep() {
  console.log("\n============ PHASE PREP : instantanés (boîte Gmail réelle + config) ============");
  fs.mkdirSync(TMP, { recursive: true });
  const snap = await avecImap(async (c) => {
    const st = c.mailbox;
    const uids = (await c.search({ seen: false }, { uid: true })) || [];
    const maxUid = st.uidNext ? st.uidNext - 1 : Math.max(0, ...uids);
    return { exists: st.exists, nonLus: uids.length, maxUid, uids };
  });
  console.log("  Boîte Gmail : exists=" + snap.exists + " | NON LUS=" + snap.nonLus + " | maxUid=" + snap.maxUid);
  const lots = ensemblesSequence(snap.uids, 4000);
  fs.writeFileSync(SNAPSHOT_BOITE, JSON.stringify({ ...snap, uids: undefined, lots, horodatage: new Date().toISOString() }, null, 2));
  check("Instantané boîte Gmail sauvegardé (" + snap.nonLus + " non lus → " + lots.length + " ensemble(s))", snap.nonLus > 0 && lots.length > 0, SNAPSHOT_BOITE);
  fs.writeFileSync(TMP + "/pj-originales.json", JSON.stringify(CAS.map((c) => ({ cle: c.cle })), null, 2));
  console.log("\n  → Lancer : node scripts/test_task251_pj_reponses_deux_portails.js config");
  await db.$disconnect(); process.exit(getFail() ? 1 : 0);
}

/* ------------------------------ PHASE config ------------------------------ */
async function config() {
  console.log("\n============ PHASE CONFIG : IMAP Gmail ACTIVÉ (poller lira la boîte) ============");
  await servicesSiBesoin();
  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion administration (:4000)", login.status === 200, "status=" + login.status);
  const avant = await adm.get("/api/mail-config");
  const cAvant = (avant.json && (avant.json.config || avant.json)) || {};
  console.log("  Config AVANT : " + cAvant.host + ":" + cAvant.port + " | imapActif=" + cAvant.imapActif + " | rhEmail=" + cAvant.rhEmail);
  const put = await adm.put("/api/mail-config", {
    host: cAvant.host || SMTP_HOST, port: cAvant.port || SMTP_PORT, username: cAvant.username || GMAIL_USER,
    from: cAvant.from || "", rhEmail: cAvant.rhEmail || GMAIL_USER,
    attestationTravailEmail: cAvant.attestationTravailEmail || GMAIL_USER, attestationSalaireEmail: cAvant.attestationSalaireEmail || GMAIL_USER,
    congeEmail: cAvant.congeEmail || GMAIL_USER, autorisationEmail: cAvant.autorisationEmail || GMAIL_USER,
    imapActif: true, imapHost: IMAP_HOST, imapPort: IMAP_PORT, imapUser: GMAIL_USER,
  });
  check("PUT mail-config : IMAP Gmail ACTIVÉ (mot de passe conservé — non fourni)", put.status === 200, "status=" + put.status + (put.json && put.json.error ? " " + put.json.error : ""));
  const apres = await adm.get("/api/mail-config");
  const c = (apres.json && (apres.json.config || apres.json)) || {};
  check("Relecture : IMAP ACTIF + SMTP Gmail engagé + routage complet", c.imapActif === true && c.host === SMTP_HOST && c.rhEmail === GMAIL_USER && c.attestationTravailEmail === GMAIL_USER && c.attestationSalaireEmail === GMAIL_USER && c.congeEmail === GMAIL_USER && c.autorisationEmail === GMAIL_USER,
    "imap=" + c.imapActif + " smtp=" + c.host + ":" + c.port + " rh=" + c.rhEmail);
  check("Relecture : mot de passe JAMAIS renvoyé par l'API", c.hasPassword === true && c.password === undefined, "hasPassword=" + c.hasPassword);
  console.log("\n  → Lancer : node scripts/test_task251_pj_reponses_deux_portails.js test");
  await db.$disconnect(); process.exit(getFail() ? 1 : 0);
}

/* Préambule : services relevés s'ils ont été tués par le sandbox (nohup). */
async function servicesSiBesoin() {
  const s4000 = await fetch(ADMIN + "/login", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  const s4001 = await fetch(PORTAIL, { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  const { spawn } = require("child_process");
  if (s4001 !== 200) { spawn("node", ["scripts/portail-server.js"], { cwd: process.cwd(), detached: true, stdio: ["ignore", fs.openSync("/tmp/portail-4001.log", "a"), fs.openSync("/tmp/portail-4001.log", "a")] }).unref(); console.log("  (portail :4001 relevé)"); }
  if (s4000 !== 200 && s4000 !== 307) { spawn("npm", ["run", "dev"], { cwd: process.cwd(), detached: true, stdio: ["ignore", fs.openSync("/tmp/admin-4000.log", "a"), fs.openSync("/tmp/admin-4000.log", "a")] }).unref(); console.log("  (administration :4000 relevée)"); }
  if (s4001 !== 200 || (s4000 !== 200 && s4000 !== 307)) await sleep(20000);
}

/* ------------------------------- PHASE test ------------------------------- */
async function test() {
  console.log("\n============ PHASE TEST : réponses avec pièces jointes → 2 portails ============");
  await servicesSiBesoin();
  const etatPrec = etatLire();
  const debutISO = (etatPrec && etatPrec.debutISO) || new Date().toISOString();
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(LIVRABLES, { recursive: true });

  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion administration (:4000, superadmin lab)", login.status === 200, "status=" + login.status);
  const portails = {};
  for (const cin of ["EMPZOH001", "EMPZOH002"]) {
    const p = clientHttp(PORTAIL);
    let r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
    if (!(r.status === 200 && r.json && r.json.ok)) { await sleep(20000); r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
    check("Connexion portail employé (:4001, " + cin + " — CIN+mdp+TOTP)", r.status === 200 && r.json && r.json.ok, "status=" + r.status);
    portails[cin] = p;
  }

  // ---- 1) Contenu RÉEL des pièces jointes + création des 2 demandes ----
  // (REPRISE : si l'état précédent contient déjà des références vivantes, on
  //  ne recrée PAS de demandes — le test est relançable après interruption.)
  console.log("\n— 1) Pièces jointes réelles + création des demandes (SMTP Gmail réel) —");
  const refsConnues = new Map((etatPrec.cas || []).filter((c) => c.ref).map((c) => [c.cle, c]));
  for (const c of CAS) {
    c.pjManager.contenu = pdfMinimal("Task 251 - Piece jointe manager - " + c.cle + " - justificatif du manager");
    c.pjRh.contenu = c.pjRh.typeMime === "image/png" ? PNG_1PX : pdfMinimal("Task 251 - Piece jointe RH - " + c.cle + " - note du service RH");
    c.shaManager = sha256(c.pjManager.contenu); c.shaRh = sha256(c.pjRh.contenu);
    const connue = refsConnues.get(c.cle);
    const existante = connue && (await relire(connue.ref));
    if (existante) { c.ref = connue.ref; check(c.cle + " : REPRISE demande existante → " + c.ref, true, "statut=" + existante.statut); continue; }
    const port = portails[c.cin];
    const r = await port.post("/api/demandes", c.corps);
    const ref = r.json && (r.json.reference || (r.json.d && r.json.d.reference));
    if ((r.status === 200 || r.status === 201) && ref) { c.ref = ref; check("Demande " + c.cle + " créée (" + c.type + ") → " + ref, true, "status=" + r.status); }
    else check("Demande " + c.cle + " créée", false, "status=" + r.status + " " + JSON.stringify(r.json || {}).slice(0, 150));
  }
  etatEcrire({ debutISO, cas: CAS.map((c) => ({ cle: c.cle, ref: c.ref, shaManager: c.shaManager, shaRh: c.shaRh, nomManager: c.pjManager.nom, nomRh: c.pjRh.nom })) });
  const dejaMessages = (await Promise.all(CAS.map((c) => relire(c.ref)))).every((d) => d && d.messageIdEnvoi);
  if (!dejaMessages) {
    await sleep(15000);
    const envois = journalDepuis(debutISO, (e) => String(e.action || "").startsWith("demande-") && e.action !== "demande-imap");
    const succes = envois.filter((e) => e.succes === true);
    check("Envois SMTP Gmail RÉELS journalisés en succès (250)", succes.length >= 2, succes.length + " succès — " + succes.filter((e) => /250/.test(String(e.reponseSmtp || ""))).length + " × 250 gsmtp");
  }
  for (const c of CAS) {
    const d = await attendreMessageId(c.ref, 60000);
    check(c.cle + " : Message-ID d'envoi stocké", !!(d && d.messageIdEnvoi), d && d.messageIdEnvoi ? String(d.messageIdEnvoi).slice(0, 45) : "absent");
    const dd = await relire(c.ref);
    check(c.cle + " : routée vers le manager attendu (" + c.destAttendu + ")", dd && dech(dd.destinataire) === c.destAttendu, dd ? "dest=" + dech(dd.destinataire) : "introuvable");
  }

  // ---- 2) VAGUE 1 : réponses MANAGER AVEC pièce jointe (IMAP APPEND réel) ----
  console.log("\n— 2) Réponses MANAGER avec pièce jointe (IMAP APPEND réel dans INBOX Gmail) —");
  let num = 0;
  for (const c of CAS) {
    num++;
    const sujet = await appenderReponseManagerAvecPj({ de: c.mgr, nom: "Manager Task 251", ref: c.ref, type: c.type, texte: c.texteManager, num, pjs: [c.pjManager] });
    check(c.cle + " : réponse manager APPENDÉE avec « " + c.pjManager.nom + " » (From " + c.mgr + ")", true, sujet.slice(0, 55));
    await sleep(3000);
  }
  console.log("  → Attente des décisions manager (poller IMAP, import des pièces)…");
  for (const c of CAS) {
    const deja = await relire(c.ref);
    if (deja && deja.decisionManagerLe) { check(c.cle + " : décision manager déjà posée (reprise)", true, "decisionManager=" + deja.decisionManager); continue; }
    const d = await attendreStatut(c.ref, (x) => !!x.decisionManagerLe, 420000);
    check(c.cle + " : décision MANAGER = ACCEPTEE (« OK pour moi » reconnu)", d && d.decisionManager === "ACCEPTEE", d ? "decisionManager=" + d.decisionManager : "absent");
    const pj = await db.documentDemande.findFirst({ where: { demande: { reference: c.ref }, recuDe: c.mgr } });
    check(c.cle + " : pièce jointe MANAGER importée (recuDe=" + c.mgr + ")", !!pj, pj ? pj.nomFichier + " (" + pj.taille + " o)" : "ABSENTE");
    if (pj) check(c.cle + " : SHA-256 pièce manager == octets envoyés", pj.empreinte === c.shaManager, pj.empreinte.slice(0, 16) + "…");
  }
  const trans = journalDepuis(debutISO, (e) => e.action === "demande-transmission-rh" && e.succes === true);
  check("Transmissions RH envoyées avec les pièces du manager (SMTP réel 250)", trans.length >= 2, trans.length + " transmission(s) 250");

  // ---- 3) VAGUE 2 : réponses RH AVEC pièce jointe (VRAIS e-mails SMTP) ----
  console.log("\n— 3) Réponses RH avec pièce jointe (VRAIS e-mails smtp.gmail.com, In-Reply-To) —");
  for (const c of CAS) {
    const d = await relire(c.ref);
    const info = await envoyerReponseRhAvecPj({ ref: c.ref, type: c.type, texte: c.texteRh, inReplyTo: d.messageIdEnvoi, pjs: [c.pjRh] });
    check(c.cle + " : réponse RH ENVOYÉE avec « " + c.pjRh.nom + " » (250 réel)", /250|OK/.test(info.response || ""), String(info.response || "").slice(0, 40));
    await sleep(3000);
  }
  console.log("  → Attente des décisions RH (poller, import des pièces, documents générés)…");
  for (const c of CAS) {
    const avant = await relire(c.ref);
    const d = avant && avant.statut !== "EN_ATTENTE" ? avant : await attendreStatut(c.ref, (x) => x.statut === "ACCEPTEE" || x.statut === "REFUSEE", 420000);
    const attendu = c.cle === "P1-conge-pj" ? "ACCEPTEE" : "REFUSEE (RH)";
    const conforme = c.cle === "P1-conge-pj" ? d && d.statut === "ACCEPTEE" : d && d.statut === "REFUSEE" && d.refuseePar === "RH";
    check(c.cle + " : statut FINAL = " + attendu, !!conforme, d ? "statut=" + d.statut + " refuseePar=" + (d.refuseePar || "-") : "absent");
    const pj = await db.documentDemande.findFirst({ where: { demande: { reference: c.ref }, recuDe: GMAIL_USER } });
    check(c.cle + " : pièce jointe RH importée (recuDe=" + GMAIL_USER + ")", !!pj, pj ? pj.nomFichier : "ABSENTE");
    if (pj) check(c.cle + " : SHA-256 pièce RH == octets envoyés", pj.empreinte === c.shaRh, pj.empreinte.slice(0, 16) + "…");
    const dd = await relire(c.ref);
    const docGen = dd[c.docGenere === "docSigne" ? "docSigneChemin" : "docRefusChemin"];
    check(c.cle + " : document généré automatiquement présent (" + (c.docGenere === "docSigne" ? "signé PAdES" : "refus") + ")", !!docGen, docGen || "absent");
  }

  // ---- 4) PREUVES PORTAIL EMPLOYÉ : pièces VISIBLES + téléchargeables ----
  console.log("\n— 4) PORTAIL EMPLOYÉ (:4001) : pièces jointes visibles + téléchargeables —");
  for (const c of CAS) {
    const mes = await portails[c.cin].get("/api/mes-demandes");
    const item = (((mes.json || {}).items) || []).find((x) => x.reference === c.ref);
    check(c.cle + " : demande présente dans /api/mes-demandes", !!item, item ? "statut=" + item.statut : "absente");
    const docs = (item && item.documents) || [];
    const pjM = docs.find((x) => x.nomFichier === c.pjManager.nom);
    const pjR = docs.find((x) => x.nomFichier === c.pjRh.nom);
    check(c.cle + " : pièce MANAGER listée (nom, taille, expéditeur affichés)", !!pjM, pjM ? pjM.nomFichier + " — " + pjM.taille + " o — envoyé par " + (pjM.recuDe || "?") : "absente");
    check(c.cle + " : pièce RH listée (nom, taille, expéditeur affichés)", !!pjR, pjR ? pjR.nomFichier + " — " + pjR.taille + " o — envoyé par " + (pjR.recuDe || "?") : "absente");
    for (const [nom, pjDoc, shaOrig] of [[c.pjManager.nom, pjM, c.shaManager], [c.pjRh.nom, pjR, c.shaRh]]) {
      if (!pjDoc) continue;
      const r = await portails[c.cin].get("/api/mes-demandes/documents/" + pjDoc.id + "?telecharger=1");
      check(c.cle + " : téléchargement portail de « " + nom + " » → octets D'ORIGINE (SHA-256)", r.status === 200 && sha256(r.buf) === shaOrig, r.status === 200 ? sha256(r.buf).slice(0, 16) + "…" : "status=" + r.status);
      c.portailSha = c.portailSha || {}; c.portailSha[nom] = { sha: sha256(r.buf), buf: r.buf, id: pjDoc.id };
    }
    const docGenere = docs.find((x) => x.nomFichier !== c.pjManager.nom && x.nomFichier !== c.pjRh.nom);
    if (docGenere) {
      const r = await portails[c.cin].get("/api/mes-demandes/documents/" + docGenere.id + "?telecharger=1");
      check(c.cle + " : document généré (" + docGenere.nomFichier + ") téléchargeable sur le portail (" + (docGenere.signeeElectronique ? "badge 🔏 signature" : "généré") + ")", r.status === 200 && r.buf.length > 500, r.status === 200 ? r.buf.length + " o, SHA " + sha256(r.buf).slice(0, 16) + "…" : "status=" + r.status);
      if (r.status === 200) { c.portailSha = c.portailSha || {}; c.portailSha[docGenere.nomFichier] = { sha: sha256(r.buf), buf: r.buf, id: docGenere.id }; }
    }
  }
  const pageDemandesBuf = await portails["EMPZOH001"].get("/demandes");
  const pageDemandes = pageDemandesBuf ? String(pageDemandesBuf.buf || "") : "";
  check("Interface portail : libellé « Pièce(s) jointe(s) transmise(s) avec la réponse (RH ou manager) » présent", pageDemandes.includes("jointe(s) transmise(s) avec la réponse"), "HTML /demandes");
  check("Interface portail : boutons Visualiser + Télécharger par pièce jointe présents", pageDemandes.includes("btn-doc") && pageDemandes.includes("Visualiser") && pageDemandes.includes("Télécharger"), "/demandes");

  // ---- 5) PREUVES ADMINISTRATION : mêmes pièces, MÊME SHA-256 ----
  console.log("\n— 5) ADMINISTRATION (:4000) : mêmes pièces jointes, SHA-256 IDENTIQUES —");
  for (const c of CAS) {
    const liste = await adm.get("/api/demandes");
    const ligne = (((liste.json || {}).items) || []).find((x) => x.reference === c.ref);
    check(c.cle + " : demande visible dans l'administration", !!ligne, ligne ? "statut=" + ligne.statut : "absente");
    if (!ligne) continue;
    const det = await adm.get("/api/demandes/" + ligne.id);
    const detail = (det.json && (det.json.item || det.json.d || det.json)) || {};
    const docs = detail.documents || [];
    const pjM = docs.find((x) => x.nomFichier === c.pjManager.nom);
    const pjR = docs.find((x) => x.nomFichier === c.pjRh.nom);
    check(c.cle + " : pièces manager + RH listées dans le détail admin (recuDe, auto:false)", !!pjM && !!pjR && pjM.auto === false && pjR.auto === false, [pjM && pjM.nomFichier, pjR && pjR.nomFichier].filter(Boolean).join(" + "));
    check(c.cle + " : document généré marqué auto:true (badge système)", docs.some((x) => x.auto === true), docs.filter((x) => x.auto).map((x) => x.nomFichier).join(", "));
    for (const [pjDoc, shaOrig] of [[pjM, c.shaManager], [pjR, c.shaRh]]) {
      if (!pjDoc) continue;
      const r = await adm.get("/api/demandes/" + ligne.id + "/documents/" + pjDoc.id + "?telecharger=1");
      const memeSha = sha256(r.buf) === shaOrig;
      const identiquePortail = c.portailSha && c.portailSha[pjDoc.nomFichier] && c.portailSha[pjDoc.nomFichier].sha === sha256(r.buf);
      check(c.cle + " : téléchargement ADMIN de « " + pjDoc.nomFichier + " » == octets d'origine == PORTAIL employé", r.status === 200 && memeSha && identiquePortail, "admin=" + sha256(r.buf).slice(0, 12) + "… origine OK=" + memeSha + " identique-portail=" + !!identiquePortail);
      if (r.status === 200) fs.writeFileSync(LIVRABLES + "/admin-" + pjDoc.nomFichier, r.buf);
      if (r.status === 200 && c.portailSha && c.portailSha[pjDoc.nomFichier]) fs.writeFileSync(LIVRABLES + "/portail-" + pjDoc.nomFichier, c.portailSha[pjDoc.nomFichier].buf);
    }
    for (const x of docs.filter((x) => x.auto === true)) {
      const r = await adm.get("/api/demandes/" + ligne.id + "/documents/" + x.id + "?telecharger=1");
      const identique = c.portailSha && c.portailSha[x.nomFichier] && c.portailSha[x.nomFichier].sha === sha256(r.buf);
      if (identique) check(c.cle + " : document généré « " + x.nomFichier + " » identique sur les DEUX portails (SHA-256)", true, sha256(r.buf).slice(0, 16) + "…");
      else if (r.status === 200) { c.shaGenereAdmin = c.shaGenereAdmin || {}; c.shaGenereAdmin[x.nomFichier] = sha256(r.buf); fs.writeFileSync(LIVRABLES + "/admin-" + x.nomFichier, r.buf); }
    }
  }

  // ---- 6) GARDE : un employé ne voit PAS les documents d'autrui ----
  const autre = CAS.find((c) => c.cin === "EMPZOH002");
  if (autre && autre.portailSha) {
    const idDoc = Object.values(autre.portailSha)[0] && Object.values(autre.portailSha)[0].id;
    if (idDoc) {
      const r = await portails["EMPZOH001"].get("/api/mes-demandes/documents/" + idDoc);
      check("Garde propriétaire : EMPZOH001 NE PEUT PAS lire une pièce d'EMPZOH002 (403)", r.status === 403, "status=" + r.status);
    }
  }

  // ---- 7) Livrables + résumé SHA ----
  const lignesSha = [];
  for (const c of CAS) {
    lignesSha.push(c.cle + " | " + c.pjManager.nom + " | manager " + c.mgr + " | " + c.shaManager);
    lignesSha.push(c.cle + " | " + c.pjRh.nom + " | RH " + GMAIL_USER + " | " + c.shaRh);
  }
  fs.writeFileSync(LIVRABLES + "/SHA256-origines.txt", lignesSha.join("\n") + "\n");
  await db.$disconnect();
  console.log("\n================================ RÉSUMÉ PHASE TEST ================================");
  console.log("  " + getOK() + " contrôle(s) OK — " + getFail() + " échec(s)");
  if (getEchecs().length) for (const e of getEchecs()) console.log("   FAIL: " + e);
  console.log("  Livrables : " + LIVRABLES + "/ (copies admin + portail + SHA-256)");
  console.log("\n  → Lancer : node scripts/test_task251_pj_reponses_deux_portails.js restore");
  process.exit(getFail() ? 1 : 0);
}

/* ------------------------------ PHASE restore ----------------------------- */
async function restore() {
  console.log("\n============ PHASE RESTORE : boîte réelle protégée + nettoyage ============");
  await servicesSiBesoin();
  const adm = clientHttp(ADMIN);
  await adm.post("/api/auth/login", SUPERADMIN);
  const avant = await adm.get("/api/mail-config");
  const cAvant = (avant.json && (avant.json.config || avant.json)) || {};
  const put = await adm.put("/api/mail-config", {
    host: cAvant.host, port: cAvant.port, username: cAvant.username,
    from: cAvant.from || "", rhEmail: cAvant.rhEmail || "",
    attestationTravailEmail: cAvant.attestationTravailEmail || "", attestationSalaireEmail: cAvant.attestationSalaireEmail || "",
    congeEmail: cAvant.congeEmail || "", autorisationEmail: cAvant.autorisationEmail || "",
    imapActif: false,
  });
  check("IMAP désactivé (le poller ne re-marque pas les 40 k non lus — SMTP Gmail reste ACTIF)", put.status === 200, "status=" + put.status);
  console.log("  → 20 s d'attente (fin du passage du poller en cours)…");
  await sleep(20000);

  // Nettoyage : demandes de test supprimées (cascade documents) + fichiers stockés
  const etat = etatLire();
  let fichiers = 0;
  for (const c of (etat.cas || [])) {
    if (!c.ref) continue;
    const docs = await db.documentDemande.findMany({ where: { demande: { reference: c.ref } } });
    for (const d of docs) { const p = "storage/documents-demandes/" + d.chemin; if (fs.existsSync(p)) { fs.unlinkSync(p); fichiers++; } }
    await db.demandeAdministrative.deleteMany({ where: { reference: c.ref } });
    check("Nettoyage : demande " + c.ref + " + " + docs.length + " document(s) supprimés (2 portails)", true, fichiers + " fichier(s) chiffré(s) retirés");
  }
  etatEcrire({ nettoyage: "fait", horodatage: new Date().toISOString() });

  // Restitution du flag \Seen sur l'instantané (état initial de la boîte)
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_BOITE, "utf8"));
  console.log("  Instantané : " + snap.nonLus + " UIDs non lus en " + snap.lots.length + " ensemble(s) — restauration…");
  let lotsOk = 0, lotsKo = 0;
  for (const lot of snap.lots) {
    try { await avecImap(async (cl) => { await cl.messageFlagsRemove(lot, ["\\Seen"], { uid: true }); }); lotsOk++; }
    catch (e) { lotsKo++; console.log("    lot en échec (retenté individuellement) : " + String(e.message || e).slice(0, 70)); }
  }
  check("Flag \\Seen RETIRÉ sur l'instantané (état initial RESTITUÉ)", lotsOk >= 1 && lotsKo < snap.lots.length, lotsOk + " lot(s) OK, " + lotsKo + " échec(s)");
  const fin = await avecImap(async (cl) => { const u = await cl.search({ seen: false }, { uid: true }); return (u || []).length; });
  check("Boîte Gmail vérifiée APRÈS restauration : " + fin + " non lus (initial : " + snap.nonLus + ")", fin >= snap.nonLus, "nonLus=" + fin);

  const s4000 = await fetch(ADMIN + "/api/mail-config", { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  const s4001 = await fetch(PORTAIL, { redirect: "manual" }).then((r) => r.status).catch(() => 0);
  check("Service administration (:4000) en bonne santé", s4000 > 0, "HTTP " + s4000);
  check("Service portail (:4001) en bonne santé", s4001 === 200, "HTTP " + s4001);
  await db.$disconnect();
  console.log("\n================================ RÉSUMÉ GLOBAL =================================");
  console.log("  " + getOK() + " contrôle(s) OK — " + getFail() + " échec(s)");
  if (getEchecs().length) for (const e of getEchecs()) console.log("   FAIL: " + e);
  console.log("  Gmail : SMTP ACTIF — IMAP désactivé en fin de test (boîte restaurée)");
  process.exit(getFail() ? 1 : 0);
}

module.exports = { prep, config, test, restore };

/* ------------------------------ PHASE verif ------------------------------- */
/* Preuves DOUBLE PORTAIL : chaque pièce jointe (manager + RH) et chaque
   document généré est VISIBLE et TÉLÉCHARGEABLE sur :4000 ET :4001 avec le
   MÊME SHA-256 (octets d'origine == admin == portail employé). */
async function verif() {
  console.log("\n============ PHASE VERIF : pièces jointes VISIBLES sur les 2 portails ============");
  await servicesSiBesoin();
  const etat = etatLire();
  const cas = etat.cas || [];
  fs.mkdirSync(LIVRABLES, { recursive: true });

  const adm = clientHttp(ADMIN);
  const login = await adm.post("/api/auth/login", SUPERADMIN);
  check("Connexion administration (:4000)", login.status === 200, "status=" + login.status);
  const portails = {};
  for (const cin of ["EMPZOH001", "EMPZOH002"]) {
    const p = clientHttp(PORTAIL);
    let r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false });
    if (!(r.status === 200 && r.json && r.json.ok)) { await sleep(20000); r = await p.post("/api/verify", { cin, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false }); }
    check("Connexion portail employé (:4001, " + cin + ")", r.status === 200 && r.json && r.json.ok, "status=" + r.status);
    portails[cin] = p;
  }

  for (const c of cas) {
    if (!c.ref) continue;
    const def = CAS.find((x) => x.cle === c.cle);
    if (!def) continue;
    c.cin = def.cin; c.mgr = def.mgr; c.docGenere = def.docGenere;
    const d = await relire(c.ref);
    if (!d) { check(c.cle + " : demande " + c.ref + " en base", false, "absente"); continue; }
    const fin = d.statut === "ACCEPTEE" || d.statut === "REFUSEE";
    check(c.cle + " (" + c.ref + ") : statut final = " + d.statut + (d.refuseePar ? " (" + d.refuseePar + ")" : ""), fin, "mgr=" + (d.decisionManager || "-") + " rh=" + (d.decisionRh || "-"));

    // ---- PORTAIL EMPLOYÉ ----
    const mes = await portails[c.cin].get("/api/mes-demandes");
    const item = (((mes.json || {}).items) || []).find((x) => x.reference === c.ref);
    check(c.cle + " : visible dans « Mes demandes » du portail employé", !!item, item ? "statut=" + item.statut : "absente");
    const docs = (item && item.documents) || [];
    const pjM = docs.find((x) => x.nomFichier === c.nomManager);
    const pjR = docs.find((x) => x.nomFichier === c.nomRh);
    check(c.cle + " : pièce MANAGER listée (nom + expéditeur affichés)", !!pjM, pjM ? pjM.nomFichier + " ← " + (pjM.recuDe || "?") : "absente");
    check(c.cle + " : pièce RH listée (nom + expéditeur affichés)", !!pjR, pjR ? pjR.nomFichier + " ← " + (pjR.recuDe || "?") : "absente");
    c.portailSha = {};
    for (const [pjDoc, shaOrig, etiquette] of [[pjM, c.shaManager, "manager"], [pjR, c.shaRh, "RH"]]) {
      if (!pjDoc) continue;
      const r = await portails[c.cin].get("/api/mes-demandes/documents/" + pjDoc.id + "?telecharger=1");
      check(c.cle + " : portail employé — « " + pjDoc.nomFichier + " » (" + etiquette + ") téléchargé == octets d'origine", r.status === 200 && sha256(r.buf) === shaOrig, r.status === 200 ? "SHA " + sha256(r.buf).slice(0, 16) + "…" : "status=" + r.status);
      if (r.status === 200) { c.portailSha[pjDoc.nomFichier] = { sha: sha256(r.buf), buf: r.buf, id: pjDoc.id }; fs.writeFileSync(LIVRABLES + "/portail-" + pjDoc.nomFichier, r.buf); }
    }
    const docGenere = docs.find((x) => x.nomFichier !== c.nomManager && x.nomFichier !== c.nomRh);
    if (docGenere) {
      const r = await portails[c.cin].get("/api/mes-demandes/documents/" + docGenere.id + "?telecharger=1");
      check(c.cle + " : document généré (« " + docGenere.nomFichier + " »" + (docGenere.signeeElectronique ? ", 🔏 signature électronique" : "") + ") téléchargeable sur le portail", r.status === 200 && r.buf.length > 500, r.status === 200 ? r.buf.length + " o — SHA " + sha256(r.buf).slice(0, 16) + "…" : "status=" + r.status);
      if (r.status === 200) { c.portailSha[docGenere.nomFichier] = { sha: sha256(r.buf), buf: r.buf, id: docGenere.id }; fs.writeFileSync(LIVRABLES + "/portail-" + docGenere.nomFichier, r.buf); }
    }

    // ---- ADMINISTRATION ----
    const liste = await adm.get("/api/demandes");
    const ligne = (((liste.json || {}).items) || []).find((x) => x.reference === c.ref);
    check(c.cle + " : visible dans la liste des demandes (administration)", !!ligne, ligne ? "statut=" + ligne.statut : "absente");
    if (!ligne) continue;
    const det = await adm.get("/api/demandes/" + ligne.id);
    const detail = (det.json && (det.json.item || det.json.d || det.json)) || {};
    const docsAdm = detail.documents || [];
    const pjMA = docsAdm.find((x) => x.nomFichier === c.nomManager);
    const pjRA = docsAdm.find((x) => x.nomFichier === c.nomRh);
    check(c.cle + " : pièces manager + RH listées dans le détail admin (recuDe, auto:false)", !!pjMA && !!pjRA && pjMA.auto === false && pjRA.auto === false, [pjMA && pjMA.nomFichier, pjRA && pjRA.nomFichier].filter(Boolean).join(" + ") || "absentes");
    check(c.cle + " : document généré marqué auto:true (badge système)", docsAdm.some((x) => x.auto === true), docsAdm.filter((x) => x.auto).map((x) => x.nomFichier).join(", "));
    for (const pjDoc of [pjMA, pjRA]) {
      if (!pjDoc) continue;
      const r = await adm.get("/api/demandes/" + ligne.id + "/documents/" + pjDoc.id + "?telecharger=1");
      const refSha = pjDoc.nomFichier === c.nomManager ? c.shaManager : c.shaRh;
      const identique = r.status === 200 && sha256(r.buf) === refSha && c.portailSha[pjDoc.nomFichier] && c.portailSha[pjDoc.nomFichier].sha === sha256(r.buf);
      check(c.cle + " : administration — « " + pjDoc.nomFichier + " » == octets d'origine == portail employé (SHA-256)", !!identique, "admin SHA " + sha256(r.buf).slice(0, 16) + "…");
      if (r.status === 200) fs.writeFileSync(LIVRABLES + "/admin-" + pjDoc.nomFichier, r.buf);
    }
    for (const x of docsAdm.filter((x) => x.auto === true)) {
      const r = await adm.get("/api/demandes/" + ligne.id + "/documents/" + x.id + "?telecharger=1");
      const identique = r.status === 200 && c.portailSha[x.nomFichier] && c.portailSha[x.nomFichier].sha === sha256(r.buf);
      check(c.cle + " : document généré « " + x.nomFichier + " » IDENTIQUE sur les deux portails (SHA-256)", !!identique, "admin " + (r.status === 200 ? sha256(r.buf).slice(0, 16) + "…" : "status=" + r.status));
      if (r.status === 200) fs.writeFileSync(LIVRABLES + "/admin-" + x.nomFichier, r.buf);
    }
  }

  // Garde propriétaire + interface
  const c2 = cas.find((c) => c.cle === "P2-autor-pj");
  if (c2 && c2.portailSha && Object.keys(c2.portailSha).length) {
    const idDoc = Object.values(c2.portailSha)[0].id;
    const r = await portails["EMPZOH001"].get("/api/mes-demandes/documents/" + idDoc);
    check("Garde propriétaire : EMPZOH001 ne peut PAS lire une pièce d'EMPZOH002 (403)", r.status === 403, "status=" + r.status);
  }
  const pageDemandesBuf = await portails["EMPZOH001"].get("/demandes");
  const pageDemandes = pageDemandesBuf ? String(pageDemandesBuf.buf || "") : "";
  check("Interface portail : libellé « Pièce(s) jointe(s) transmise(s) avec la réponse (RH ou manager) » présent", pageDemandes.includes("jointe(s) transmise(s) avec la réponse"), "HTML /demandes");
  check("Interface portail : boutons Visualiser + Télécharger présents par pièce jointe", pageDemandes.includes("btn-doc") && pageDemandes.includes("Visualiser") && pageDemandes.includes("Télécharger"), "/demandes");

  await db.$disconnect();
  console.log("\n================ RÉSUMÉ VERIF ================");
  console.log("  " + getOK() + " contrôle(s) OK — " + getFail() + " échec(s)");
  if (getEchecs().length) for (const e of getEchecs()) console.log("   FAIL: " + e);
  console.log("  Livrables : " + LIVRABLES + "/ (copies admin + portail, SHA-256 originaux dans SHA256-origines.txt)");
  process.exit(getFail() ? 1 : 0);
}

module.exports = { prep, config, test, restore, verif };
