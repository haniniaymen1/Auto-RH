#!/usr/bin/env node
/**
 * v0.2.197 — PREUVE DÉDIÉE : ADRESSE EN COPIE DES DEMANDES DE PARRAINAGE
 * ==========================================================================
 * (Demande utilisateur : « Pour les demandes de parrainage, je souhaite
 *  également ajouter une adresse e-mail en copie de responsable principal
 *  du parrainage. »)
 *
 * DÉSORMAIS (v0.2.197) : l'adresse DÉDIÉE du parrainage (parrainageEmail,
 * v0.2.92) reste destinataire PRINCIPAL des demandes de parrainage et une
 * NOUVELLE adresse de configuration (parrainageCopieEmail — champ
 * « E-mail dédié — demandes de parrainage (copie) » du panneau SMTP →
 * routage) reçoit une COPIE de chaque demande de parrainage :
 *   - vide       → AUCUNE copie supplémentaire (jamais de doublon) ;
 *   - identique au principal → copie IGNORÉE + JOURNALISÉE
 *     (« demande-creation-copie-ignoree », code COPIE_IDENTIQUE_PRINCIPAL).
 *
 * Le test extrait le CODE RÉEL du portail (scripts/portail-server.js) et
 * vérifie :
 *   1. lireConfigMailDemandes expose parrainageCopieEmail (déchiffrée) ;
 *   2. envoyerEmailsDemandeEnArrierePlan couvre le PARRAINAGE (copie,
 *      pas de repli, copie identique ignorée + journalisée) — transport
 *      SMTP seul simulé (envois capturés) ;
 *   3. non-régression : congé / autorisation / attestations gardent leur
 *      copie dédiée (v0.2.94 / v0.2.196) ;
 *   4. chaîne d'interface complète : schéma Prisma, mailer.ts, API
 *      mail-config (validation + persistance), panneau SMTP (champ
 *      « (copie) »).
 *
 * Usage : node scripts/test_v02197_parrainage_copie.js
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
  const i1 = src.indexOf(fin, i0);
  if (i1 < 0) throw new Error("Borne de fin introuvable pour : " + marqueur);
  return src.slice(i0, i1 + fin.length);
}

const srcConfig = extraire("async function lireConfigMailDemandes() {", "\n}\n");
const srcEnvoi = extraire("async function envoyerEmailsDemandeEnArrierePlan(demandeCreee, creeId, destPrincipal, cfg) {", "\n}\n");

// --------------------------------------------------------------------
// 1. lireConfigMailDemandes — le nouveau champ est exposé (déchiffré)
// --------------------------------------------------------------------
console.log("\n-- A. lireConfigMailDemandes : parrainageCopieEmail exposé --");
check("A — lireConfigMailDemandes expose parrainageCopieEmail (déchiffré)",
  srcConfig.includes("parrainageCopieEmail: dechiffrerAdresse(cfg.parrainageCopieEmail)"),
  srcConfig.split("\n").filter((l) => l.includes("parrainage")).join(" | "));
check("A — commentaire v0.2.197 présent (traçabilité)",
  srcConfig.includes("v0.2.197") && srcConfig.includes("responsable"), "");

// --------------------------------------------------------------------
// 2. envoyerEmailsDemandeEnArrierePlan — PARRAINAGE couvert
// --------------------------------------------------------------------
check("B — bloc copie : PARRAINAGE inclus (typeParrainage) + v0.2.197",
  srcEnvoi.includes("typeParrainage") && srcEnvoi.includes("v0.2.197"), "");
check("B — la copie parrainage lit cfg.parrainageCopieEmail (AUCUN repli)",
  /cfg\.parrainageCopieEmail/.test(srcEnvoi), "");
check("B — copie identique au principal : IGNORÉE + JOURNALISÉE",
  srcEnvoi.includes("demande-creation-copie-ignoree") &&
  srcEnvoi.includes("COPIE_IDENTIQUE_PRINCIPAL"), "");

// --------------------------------------------------------------------
// Routage — fonction RÉELLE avec envois capturés
// --------------------------------------------------------------------
const RH = "rh@entreprise.tn";
const PARRAINAGE_BOX = "parrainage@entreprise.tn";
const PARRAINAGE_COPIE = "responsable.parrainage@entreprise.tn";
const CONGE_BOX = "conge@entreprise.tn";
const AUTORISATION_BOX = "autorisation@entreprise.tn";
const ATT_TRAVAIL = "attestation.travail@entreprise.tn";
const MGR = "manager@entreprise.tn";

const cfgComplet = {
  host: "smtp.entreprise.tn", port: 587, secure: false,
  rhEmail: RH, parrainageEmail: PARRAINAGE_BOX, parrainageCopieEmail: PARRAINAGE_COPIE,
  attestationTravailEmail: ATT_TRAVAIL, attestationSalaireEmail: "",
  congeEmail: CONGE_BOX, autorisationEmail: AUTORISATION_BOX,
  responsablesMap: "DEFAUT=" + RH,
};

function nouvelleCapture() {
  const envois = [];
  const journal = [];
  const majDemande = [];
  const prismaSim = {
    demandeAdministrative: { update: async (q) => { majDemande.push(q); return {}; } },
  };
  const envoyerSim = async (demande, dest, cfg) => {
    envois.push({ dest: String(dest || ""), type: demande.type, ref: demande.reference });
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
    reference: "DEM-2026-90001", type: type, cin: "TEST197001",
    statut: "EN_ATTENTE", createdAt: new Date(),
    nomEmploye: "Employé Test 197", matricule: "M197",
    emailEmploye: "employe197@test.tn",
    validationParReponse: type === "CONGE" || type === "AUTORISATION_SORTIE" || type === "PARRAINAGE",
    infos: [],
  };
}

(async () => {
  console.log("\n-- C. PARRAINAGE : principal dédié + COPIE responsable principal --");
  let c = nouvelleCapture();
  await c.fn(demandeCreee("PARRAINAGE"), "p197-1", PARRAINAGE_BOX, cfgComplet);
  const dests = c.envois.map((e) => e.dest);
  check("C — TROIS envois : principal dédié + copie + confirmation demandeur",
    c.envois.length === 3, JSON.stringify(c.envois));
  check("C — principal = adresse DÉDIÉE du parrainage (" + PARRAINAGE_BOX + ") (inchangé v0.2.92)",
    dests[0] === PARRAINAGE_BOX, JSON.stringify(dests));
  check("C — COPIE parti au responsable principal (" + PARRAINAGE_COPIE + ")",
    dests[1] === PARRAINAGE_COPIE, JSON.stringify(dests));
  check("C — confirmation demandeur en dernier envoi",
    dests[2] === "employe197@test.tn", JSON.stringify(dests));
  const jCopie = c.journal.find((j) => j.action === "demande-creation-copie-dediee");
  check("C — journal « demande-creation-copie-dediee » pour le parrainage",
    Boolean(jCopie) && jCopie.dest === PARRAINAGE_COPIE && jCopie.type === "PARRAINAGE",
    JSON.stringify(jCopie || null));

  console.log("\n-- D. PARRAINAGE sans adresse en copie : AUCUNE copie (pas de doublon) --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("PARRAINAGE"), "p197-2", PARRAINAGE_BOX, { ...cfgComplet, parrainageCopieEmail: "" });
  const destsD = c.envois.map((e) => e.dest);
  check("D — DEUX envois seulement : principal + confirmation (AUCUNE copie)",
    c.envois.length === 2 && destsD[0] === PARRAINAGE_BOX && destsD[1] === "employe197@test.tn",
    JSON.stringify(c.envois));
  check("D — AUCUNE entrée journal copie",
    !c.journal.some((j) => String(j.action || "").startsWith("demande-creation-copie")), "");

  console.log("\n-- E. PARRAINAGE copie IDENTIQUE au principal : IGNORÉE + journalisée --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("PARRAINAGE"), "p197-3", PARRAINAGE_BOX, { ...cfgComplet, parrainageCopieEmail: PARRAINAGE_BOX });
  const destsE = c.envois.map((e) => e.dest);
  check("E — DEUX envois seulement (pas de doublon vers la même boîte)",
    c.envois.length === 2 && destsE[0] === PARRAINAGE_BOX && destsE[1] === "employe197@test.tn",
    JSON.stringify(c.envois));
  const jIgnoree = c.journal.find((j) => j.action === "demande-creation-copie-ignoree");
  check("E — journal « demande-creation-copie-ignoree » (code COPIE_IDENTIQUE_PRINCIPAL)",
    Boolean(jIgnoree) && jIgnoree.code === "COPIE_IDENTIQUE_PRINCIPAL" &&
    jIgnoree.type === "PARRAINAGE" && jIgnoree.dest === PARRAINAGE_BOX && jIgnoree.succes === true,
    JSON.stringify(jIgnoree || null));

  console.log("\n-- F. Non-régression : congé / autorisation / attestation (copie dédiée conservée) --");
  c = nouvelleCapture();
  await c.fn(demandeCreee("CONGE"), "p197-4", MGR, cfgComplet);
  const destsF = c.envois.map((e) => e.dest);
  check("F — CONGÉ : principal manager + copie dédiée (" + CONGE_BOX + ") (v0.2.94)",
    destsF[0] === MGR && destsF[1] === CONGE_BOX, JSON.stringify(destsF));
  c = nouvelleCapture();
  await c.fn(demandeCreee("AUTORISATION_SORTIE"), "p197-5", MGR, cfgComplet);
  const destsF2 = c.envois.map((e) => e.dest);
  check("F — AUTORISATION : principal manager + copie dédiée (" + AUTORISATION_BOX + ") (v0.2.94)",
    destsF2[0] === MGR && destsF2[1] === AUTORISATION_BOX, JSON.stringify(destsF2));
  c = nouvelleCapture();
  await c.fn(demandeCreee("ATTESTATION_TRAVAIL"), "p197-6", RH, cfgComplet);
  const destsF3 = c.envois.map((e) => e.dest);
  check("F — ATTESTATION TRAVAIL : principal RH + copie dédiée (" + ATT_TRAVAIL + ") (v0.2.196)",
    destsF3[0] === RH && destsF3[1] === ATT_TRAVAIL, JSON.stringify(destsF3));

  console.log("\n-- G. Chaîne d'interface complète (schéma, mailer, API, panneau) --");
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  check("G — schema.prisma : champ parrainageCopieEmail String @default(\"\")",
    /parrainageCopieEmail\s+String\s+@default\(""\)/.test(schema), "");
  const mailer = fs.readFileSync("src/lib/mailer.ts", "utf8");
  check("G — mailer.ts : type + défaut + lecture parrainageCopieEmail",
    mailer.includes("parrainageCopieEmail: string;") &&
    mailer.includes('parrainageCopieEmail: "",') &&
    mailer.includes("parrainageCopieEmail: cfg.parrainageCopieEmail ?? \"\"") &&
    mailer.includes("parrainageCopieEmail: brut.parrainageCopieEmail ?? \"\""), "");
  const api = fs.readFileSync("src/app/api/mail-config/route.ts", "utf8");
  check("G — API mail-config : lecture + validation + persistance parrainageCopieEmail",
    api.includes('String(body?.parrainageCopieEmail ?? "").trim()') &&
    api.includes("en copie des demandes de parrainage") &&
    /parrainageCopieEmail,/.test(api), "");
  const panneau = fs.readFileSync("src/components/payslip/mail-panel.tsx", "utf8");
  check("G — panneau SMTP : champ « E-mail dédié — demandes de parrainage (copie) »",
    panneau.includes("E-mail dédié — demandes de parrainage (copie)") &&
    panneau.includes("mail-parrainage-copie") &&
    panneau.includes("setParrainageCopieEmail(c.parrainageCopieEmail ?? \"\")") &&
    /parrainageCopieEmail,/.test(panneau), "");
  check("G — panneau SMTP : description « responsable principal du parrainage »",
    panneau.includes("responsable principal du parrainage"), "");
})();

(async () => {
  // (les sections async ci-dessus s'exécutent avant ce point — synchro)
})();
setTimeout(() => {
  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}, 400);
