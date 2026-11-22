#!/usr/bin/env node
/**
 * v0.2.196 — PREUVE DÉDIÉE : ADRESSES DÉDIÉES DES ATTESTATIONS « EN COPIE »
 * ==========================================================================
 * (Demande utilisateur — cadre vert de la capture : « E-mail dédié —
 *  attestations de travail (copie) » et « E-mail dédié — attestations de
 *  salaire (copie) » dans la configuration des e-mails du service RH.)
 *
 * AVANT (v0.2.94, Task 197) : l'adresse dédiée du type d'attestation recevait
 * la demande À LA PLACE de la boîte RH (« dédiée prioritaire », repli RH).
 * DÉSORMAIS (v0.2.196) : la boîte du service RH REDEVIENT destinataire
 * PRINCIPAL des attestations et l'adresse dédiée reçoit une COPIE
 * systématique — exactement la sémantique « (copie) » du congé et de
 * l'autorisation de sortie.
 *
 * Le test extrait le CODE RÉEL du portail (scripts/portail-server.js) :
 *   1. destinatairePourDemande  → destinataire principal par type ;
 *   2. analyserResponsablesDemandes (dépendance réelle du routage
 *      AUTORISATION_SORTIE) ;
 *   3. envoyerEmailsDemandeEnArrierePlan → e-mails principal + COPIE +
 *      confirmation (transport SMTP seul simulé — capture des envois) ;
 *   4. garde IMAP de traiterMessageRecu → expéditeurs légitimes des réponses
 *      (l'adresse dédiée des attestations doit RESTER habilitée, rôle « rh »).
 *
 * Usage : node scripts/test_v02196_attestations_copie.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });

// --------------------------------------------------------------------
// Extraction du code RÉEL du portail
// --------------------------------------------------------------------
const src = fs.readFileSync("scripts/portail-server.js", "utf8");

function extraire(marqueur, fin) {
  const i0 = src.indexOf(marqueur);
  if (i0 < 0) throw new Error("Marqueur introuvable : " + marqueur);
  const i1 = fin === "\n}\n"
    ? src.indexOf(fin, i0)
    : src.indexOf(fin, i0);
  if (i1 < 0) throw new Error("Borne de fin introuvable pour : " + marqueur);
  return src.slice(i0, fin === "\n}\n" ? i1 + fin.length : i1);
}

const srcDest = extraire("function destinatairePourDemande(type, donnees, cfg, managerInfo) {", "\n}\n");
const srcAnalyse = extraire("function analyserResponsablesDemandes(txt) {", "\n}\n");
const srcEnvoi = extraire("async function envoyerEmailsDemandeEnArrierePlan(demandeCreee, creeId, destPrincipal, cfg) {", "\n}\n");
const srcGarde = extraire('  let destAttendu = "";', "  // ---- 2.5)");

// Contrôles d'extraction (le code v0.2.196 doit être présent)
check("Extraction — destinatairePourDemande contient la sémantique v0.2.196 (copie dédiée)",
  srcDest.includes("v0.2.196") &&
  srcDest.indexOf("if (cfg.rhEmail)") >= 0 &&
  srcDest.indexOf("if (cfg.rhEmail)") < srcDest.indexOf("const dediee"));
check("Extraction — bloc copie : attestations incluses (typeAttestation)",
  srcEnvoi.includes("typeAttestation") && srcEnvoi.includes("v0.2.196"));
check("Extraction — garde IMAP : dérogation adresse dédiée v0.2.196",
  srcGarde.includes("expAttestationDediee") && srcGarde.includes("v0.2.196"));

// --------------------------------------------------------------------
// Routage — destinatairePourDemande (fonction RÉELLE)
// --------------------------------------------------------------------
const RH = "rh@entreprise.tn";
const ATT_TRAVAIL = "attestation.travail@entreprise.tn";
const ATT_SALAIRE = "attestation.salaire@entreprise.tn";
const CONGE_BOX = "conge@entreprise.tn";
const AUTORISATION_BOX = "autorisation@entreprise.tn";
const PARRAINAGE_BOX = "parrainage@entreprise.tn";
const MGR = "manager@entreprise.tn";

const emailValideSim = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ""));
const fnAnalyse = new Function("return " + srcAnalyse)();
const fnDest = new Function("emailValideDemande", "analyserResponsablesDemandes",
  "return " + srcDest)(emailValideSim, fnAnalyse);

const cfgComplet = {
  host: "smtp.entreprise.tn", port: 587, secure: false,
  rhEmail: RH, parrainageEmail: PARRAINAGE_BOX,
  attestationTravailEmail: ATT_TRAVAIL, attestationSalaireEmail: ATT_SALAIRE,
  congeEmail: CONGE_BOX, autorisationEmail: AUTORISATION_BOX,
  responsablesMap: "COMPTABILITE=compta@entreprise.tn\nDEFAUT=" + RH,
};

console.log("\n-- A. destinatairePourDemande — attestations : principal = boîte RH --");
let r = fnDest("ATTESTATION_TRAVAIL", {}, cfgComplet, null);
check("A — ATTESTATION_TRAVAIL : destinataire PRINCIPAL = boîte RH (" + RH + ")",
  r.dest === RH, JSON.stringify(r));
check("A — ATTESTATION_TRAVAIL : motif annonce la COPIE dédiée",
  /copie systématique/.test(r.motif) && /attestation de travail/.test(r.motif), r.motif);
r = fnDest("ATTESTATION_SALAIRE", {}, cfgComplet, null);
check("A — ATTESTATION_SALAIRE : destinataire PRINCIPAL = boîte RH",
  r.dest === RH && /attestation de salaire/.test(r.motif), JSON.stringify(r));

console.log("\n-- B. destinatairePourDemande — replis attestations (boîte RH absente) --");
r = fnDest("ATTESTATION_TRAVAIL", {}, { ...cfgComplet, rhEmail: "" }, null);
check("B — sans boîte RH : REPLI sur l'adresse dédiée travail (" + ATT_TRAVAIL + ")",
  r.dest === ATT_TRAVAIL && /repli/.test(r.motif), JSON.stringify(r));
r = fnDest("ATTESTATION_SALAIRE", {}, { ...cfgComplet, rhEmail: "", attestationSalaireEmail: "" }, null);
check("B — ni boîte RH ni dédiée : destinataire ABSENT (motif explicite)",
  r.dest === null && /non configur/.test(r.motif), JSON.stringify(r));

console.log("\n-- C. destinatairePourDemande — congé / autorisation / parrainage INCHANGÉS --");
r = fnDest("CONGE", {}, cfgComplet, { nom: "Manager", email: MGR });
check("C — CONGE : principal = manager responsable (inchangé v0.2.132)",
  r.dest === MGR, JSON.stringify(r));
r = fnDest("CONGE", {}, cfgComplet, null);
check("C — CONGE sans manager : repli boîte RH (inchangé)", r.dest === RH, JSON.stringify(r));
r = fnDest("AUTORISATION_SORTIE", { departement: "COMPTABILITE" }, cfgComplet, null);
check("C — AUTORISATION_SORTIE sans manager : repli table responsables (inchangé)",
  r.dest === "compta@entreprise.tn", JSON.stringify(r));
r = fnDest("PARRAINAGE", {}, cfgComplet, null);
check("C — PARRAINAGE : principal = adresse dédiée (inchangé v0.2.92)",
  r.dest === PARRAINAGE_BOX, JSON.stringify(r));

// --------------------------------------------------------------------
// Envoi — envoyerEmailsDemandeEnArrierePlan (fonction RÉELLE, envois capturés)
// --------------------------------------------------------------------
function nouvelleCapture() {
  const envois = [];
  const journal = [];
  const majDemande = [];
  const prismaSim = {
    demandeAdministrative: { update: async (q) => { majDemande.push(q); return {}; } },
  };
  const envoyerSim = async (demande, dest, cfg) => {
    envois.push({ dest: String(dest || ""), type: demande.type, ref: demande.reference });
    // (comme la fonction réelle envoyerEmailDemandeCreation) l'envoi du
    // principal est journalisé PAR LA FONCTION d'envoi elle-même.
    journal.push({ action: "demande-creation", dest: String(dest || ""), succes: true });
    return { envoye: true, messageId: "MID-" + (envois.length) };
  };
  const confirmerSim = async (demande, dest, cfg) => {
    envois.push({ dest: String(dest || ""), type: demande.type, ref: demande.reference });
    journal.push({ action: "demande-creation-confirmation-demandeur", dest: String(dest || ""), succes: true });
    return { envoye: true, messageId: "MID-" + (envois.length) };
  };
  const journalSim = (entry) => { journal.push(entry); };
  const fn = new Function("envoyerEmailDemandeCreation", "envoyerEmailDemandeConfirmation",
    "journaliserEnvoiDemandes", "prisma",
    "return " + srcEnvoi)(envoyerSim, confirmerSim, journalSim, prismaSim);
  return { fn, envois, journal, majDemande };
}

function demandeCreee(type) {
  return {
    reference: "DEM-2026-90001", type: type, cin: "TEST196001",
    statut: "EN_ATTENTE", createdAt: new Date(),
    nomEmploye: "Employé Test 196", matricule: "M196",
    emailEmploye: "employe196@test.tn",
    validationParReponse: type === "CONGE" || type === "AUTORISATION_SORTIE" || type === "PARRAINAGE",
    infos: [],
  };
}

console.log("\n-- D. Envoi attestation de travail : principal RH + COPIE dédiée --");
(async () => {
  let c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_TRAVAIL"), "att196-1", RH, cfgComplet);
  const dests = c.envois.map((e) => e.dest);
  check("D — DEUX envois : principal RH + copie dédiée (+ confirmation demandeur)",
    c.envois.length === 3, JSON.stringify(c.envois));
  check("D — principal = boîte RH (" + RH + ")", dests[0] === RH, JSON.stringify(dests));
  check("D — COPIE parti à l'adresse dédiée travail (" + ATT_TRAVAIL + ")",
    dests.includes(ATT_TRAVAIL), JSON.stringify(dests));
  check("D — confirmation demandeur partie", dests.includes("employe196@test.tn"), JSON.stringify(dests));
  check("D — journal : copie tracée « demande-creation-copie-dediee »",
    c.journal.some((j) => j.action === "demande-creation-copie-dediee" && j.dest === ATT_TRAVAIL),
    JSON.stringify(c.journal.map((j) => j.action + "->" + j.dest)));
  check("D — journal : principal tracé « demande-creation » vers RH",
    c.journal.some((j) => j.action === "demande-creation" && j.dest === RH && j.succes === true),
    JSON.stringify(c.journal.map((j) => j.action + "->" + j.dest)));
  check("D — Message-ID du principal mémorisé en base",
    c.majDemande.length === 1 && c.majDemande[0].data.messageIdEnvoi === "MID-1",
    JSON.stringify(c.majDemande));

  console.log("\n-- E. Envoi attestation de salaire : principal RH + COPIE dédiée --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_SALAIRE"), "att196-2", RH, cfgComplet);
  check("E — COPIE parti à l'adresse dédiée salaire (" + ATT_SALAIRE + ")",
    c.envois.map((e) => e.dest).includes(ATT_SALAIRE), JSON.stringify(c.envois));
  check("E — AUCUN doublon vers la boîte RH (1 seul envoi principal)",
    c.envois.filter((e) => e.dest === RH).length === 1, JSON.stringify(c.envois));

  console.log("\n-- F. Attestation SANS adresse dédiée : AUCUNE copie (pas de repli RH en double) --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_TRAVAIL"), "att196-3", RH, { ...cfgComplet, attestationTravailEmail: "" });
  check("F — seulement principal + confirmation (PAS de copie)",
    c.envois.length === 2 && c.envois[0].dest === RH && c.envois[1].dest === "employe196@test.tn",
    JSON.stringify(c.envois));
  check("F — aucune action « copie-dediee » au journal",
    !c.journal.some((j) => j.action === "demande-creation-copie-dediee"),
    JSON.stringify(c.journal.map((j) => j.action)));

  console.log("\n-- G. Repli : boîte RH absente → principal = dédiée, PAS de copie à soi-même --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_TRAVAIL"), "att196-4", ATT_TRAVAIL, { ...cfgComplet, rhEmail: "" });
  check("G — principal = adresse dédiée, AUCUNE copie (doublon évité)",
    c.envois.length === 2 && c.envois[0].dest === ATT_TRAVAIL &&
    !c.envois.slice(1).some((e) => e.dest === ATT_TRAVAIL),
    JSON.stringify(c.envois));

  console.log("\n-- H. Congé / autorisation / parrainage : sémantique INCHANGÉE --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("CONGE"), "att196-5", MGR, cfgComplet);
  check("H — CONGÉ : principal manager + copie dédiée congé + confirmation",
    c.envois.length === 3 && c.envois[0].dest === MGR && c.envois[1].dest === CONGE_BOX,
    JSON.stringify(c.envois));
  c = nouvelleCapture();
  await c.fn(demandeCreee("CONGE"), "att196-6", MGR, { ...cfgComplet, congeEmail: "" });
  check("H — CONGÉ sans adresse dédiée : copie de repli vers la boîte RH (v0.2.88 conservé)",
    c.envois[1].dest === RH &&
    c.journal.some((j) => j.action === "demande-creation-copie-rh" && j.dest === RH),
    JSON.stringify(c.envois));
  c = nouvelleCapture();
  await c.fn(demandeCreee("AUTORISATION_SORTIE"), "att196-7", MGR, cfgComplet);
  check("H — AUTORISATION : copie dédiée autorisation (inchangé)",
    c.envois[1].dest === AUTORISATION_BOX, JSON.stringify(c.envois));
  c = nouvelleCapture();
  await c.fn(demandeCreee("PARRAINAGE"), "att196-8", PARRAINAGE_BOX, cfgComplet);
  check("H — PARRAINAGE : principal dédiée, AUCUNE copie (inchangé)",
    c.envois.length === 2 && c.envois[0].dest === PARRAINAGE_BOX,
    JSON.stringify(c.envois));

  console.log("\n-- I. Destinataire ABSENT (boîte RH et dédiée vides — situation réelle) : journal DESTINATAIRE_ABSENT --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_TRAVAIL"), "att196-9", null,
    { ...cfgComplet, attestationTravailEmail: "", attestationSalaireEmail: "" });
  check("I — aucun envoi, journal « DESTINATAIRE_ABSENT », confirmation maintenue",
    c.envois.length === 1 && c.envois[0].dest === "employe196@test.tn" &&
    c.journal.some((j) => j.code === "DESTINATAIRE_ABSENT"),
    JSON.stringify(c.journal.map((j) => (j.code || j.action) + "->" + j.dest)));

  // ------------------------------------------------------------------
  // Garde IMAP — expéditeurs légitimes des réponses
  // ------------------------------------------------------------------
  const prismaGarde = {
    portalAccess: { findUnique: async () => null }, // pas de manager résolu ici
  };
  const cfgGarde = { rhEmail: RH, attestationTravailEmail: ATT_TRAVAIL, attestationSalaireEmail: ATT_SALAIRE };
  const fnGarde = new Function("cryptoBd", "prisma", "lireConfigMailDemandes", `
    return async function garde(demande, exp) {
${srcGarde}
      return { ignore: null, roleReponse: roleReponse, destAttendu: destAttendu };
    };
  `)(
    { dechiffrerChamp: (v) => String(v || "") },
    prismaGarde,
    async () => cfgGarde
  );
  // Le fragment réel retourne SOIT l'objet IGNORE (return anticipé — il sort
  // du harnais tel quel), SOIT l'objet normalisé du harnais.
  const estIgnore = (g) => Boolean(g && (g.statut === "IGNORE" || (g.ignore && g.ignore.statut === "IGNORE")));

  console.log("\n-- J. Garde IMAP — attestations : boîte RH (principal) habilitée --");
  let g = await fnGarde({ type: "ATTESTATION_TRAVAIL", destinataire: RH, cin: "X", reference: "DEM-2026-90002" }, RH);
  check("J — expéditeur = boîte RH (destinataire principal) → rôle « rh »",
    g.ignore === null && g.roleReponse === "rh", JSON.stringify(g));

  console.log("\n-- K. Garde IMAP — adresse dédiée attestations TOUJOURS habilitée (v0.2.196) --");
  g = await fnGarde({ type: "ATTESTATION_TRAVAIL", destinataire: RH, cin: "X", reference: "DEM-2026-90003" }, ATT_TRAVAIL);
  check("K — attestation TRAVAIL répondue depuis la boîte dédiée travail → rôle « rh »",
    g.ignore === null && g.roleReponse === "rh", JSON.stringify(g));
  g = await fnGarde({ type: "ATTESTATION_SALAIRE", destinataire: RH, cin: "X", reference: "DEM-2026-90004" }, ATT_SALAIRE);
  check("K — attestation SALAIRE répondue depuis la boîte dédiée salaire → rôle « rh »",
    g.ignore === null && g.roleReponse === "rh", JSON.stringify(g));
  g = await fnGarde({ type: "ATTESTATION_SALAIRE", destinataire: RH, cin: "X", reference: "DEM-2026-90005" }, ATT_TRAVAIL);
  check("K — la boîte dédiée TRAVAIL ne répond PAS à une attestation SALAIRE → rejet",
    estIgnore(g) && /Expéditeur non autorisé/.test(g.motif || (g.ignore && g.ignore.motif) || ""),
    JSON.stringify(g));

  console.log("\n-- L. Garde IMAP — autres expéditeurs TOUJOURS rejetés (inchangé) --");
  g = await fnGarde({ type: "ATTESTATION_TRAVAIL", destinataire: RH, cin: "X", reference: "DEM-2026-90006" }, "intrus@autre.tn");
  check("L — expéditeur inconnu → « Expéditeur non autorisé »",
    estIgnore(g), JSON.stringify(g));
  g = await fnGarde({ type: "CONGE", destinataire: MGR, cin: "X", reference: "DEM-2026-90007" }, CONGE_BOX);
  check("L — CONGÉ : la boîte copie dédiée reste NON habilitée (sémantique inchangée)",
    estIgnore(g), JSON.stringify(g));
  g = await fnGarde({ type: "CONGE", destinataire: MGR, cin: "X", reference: "DEM-2026-90008" }, RH);
  check("L — CONGÉ : réponse de la boîte RH → rôle « rh » (v0.2.146 conservé)",
    g.ignore === null && g.roleReponse === "rh", JSON.stringify(g));

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
