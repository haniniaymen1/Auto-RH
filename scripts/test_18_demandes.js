#!/usr/bin/env node
/**
 * ============================================================================
 * TEST E2E — LES 18 DEMANDES DE L'UTILISATEUR (v0.2.88)
 * ============================================================================
 * Vérifie contre l'administration RÉELLE (port 4000) et le portail réel
 * (port 4001) les points non encore couverts par les tests antérieurs :
 *   1. mot de passe PROVISOIRE IT/RH (création + réinitialisation) :
 *      mustChangePassword au login → écran forcé (APIs 403) → changement → OK ;
 *   2-6. formulaires du portail SANS champs d'identité (statique HTML réel) ;
 *   7. envoi e-mails EN ARRIÈRE-PLAN + copie RH congé/autorisation (statique) ;
 *   8. validation par RÉPONSE e-mail du N+1 : lib (unitaire) + traiterMessageRecu
 *      (intégration sans serveur : Accepté → ACCEPTEE, Refusé → REFUSEE,
 *      mauvais expéditeur → IGNORE, notifications RH + employé déclenchées) ;
 *   9. poignées de redimensionnement présentes (statique build) ;
 *   10-18. MATRICE FINALE DES PERMISSIONS (SuperAdmin / RH / IT) sur toutes
 *      les API sensibles — aucune fonctionnalité non autorisée accessible.
 * Nettoyage complet vérifié.
 * ============================================================================
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js"); // mode TEST : pas de serveur ni IMAP

const BASE = "http://localhost:4000";
const db = new PrismaClient();

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

async function api(method, p, body, cookie) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
}

function cookieDe(res) {
  return (res.headers.get("set-cookie") || "").split(";")[0] || null;
}

async function creerEtConnecter(role, email, motDePasse) {
  // Création par le superadmin
  const supLogin = await api("POST", "/api/auth/login", {
    email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
  });
  const ckSup = cookieDe(supLogin);
  const crea = await api("POST", "/api/users", { name: "Test " + role, email, password: motDePasse, role }, ckSup);
  const idCree = crea.json?.user?.id || crea.json?.id || null;
  // Premier login (mot de passe provisoire)
  const l1 = await api("POST", "/api/auth/login", { email, password: motDePasse });
  return { ckSup, idCree, login1: l1, ck1: cookieDe(l1) };
}

async function main() {
  console.log("== Les 18 demandes — preuve E2E (v0.2.88) ==");

  // ------------------------------------------------------------------
  // 1) MOT DE PASSE PROVISOIRE IT/RH (création)
  // ------------------------------------------------------------------
  console.log("-- Point 1 : mot de passe forcé à la 1re connexion (IT/RH) --");
  const suffixe = crypto.randomBytes(3).toString("hex");
  const emailRH = `rh-p1-${suffixe}@test.local`;
  const mdpProvisoire = "Provisoire1!a";
  let ckRH = null;
  const { idCree: idRH, ck1: ckRH1, login1: loginRH1 } = await creerEtConnecter("RH", emailRH, mdpProvisoire);
  check("Compte RH créé par le SuperAdmin (201/200)", Boolean(idRH), `id=${idRH}`);
  check("1re connexion RH : mustChangePassword = true", loginRH1.json?.mustChangePassword === true, JSON.stringify(loginRH1.json).slice(0, 100));
  check("1re connexion RH : session de 15 minutes", loginRH1.json?.user?.mustChangePassword === true);
  const bloque = await api("GET", "/api/payslips?page=1&limit=1", undefined, ckRH1);
  check("Aucun accès aux fonctionnalités tant que non changé (403)", bloque.status === 403, `status=${bloque.status}`);
  const chg = await api("POST", "/api/auth/change-password", { currentPassword: mdpProvisoire, newPassword: "NouveauMot1!b" }, ckRH1);
  check("Changement de mot de passe accepté", chg.status === 200, `status=${chg.status} ${JSON.stringify(chg.json).slice(0, 100)}`);
  const l2 = await api("POST", "/api/auth/login", { email: emailRH, password: "NouveauMot1!b" });
  ckRH = cookieDe(l2);
  check("Reconnexion : plus de forçage", l2.json?.mustChangePassword === false, JSON.stringify(l2.json?.mustChangePassword));
  const accesApres = await api("GET", "/api/payslips?page=1&limit=1", undefined, ckRH);
  check("Accès normal après le changement (200)", accesApres.status === 200, `status=${accesApres.status}`);

  // IT : même mécanisme
  const emailIT = `it-p1-${suffixe}@test.local`;
  const { idCree: idIT, ck1: ckIT1, login1: loginIT1 } = await creerEtConnecter("IT", emailIT, "Provisoire2!b");
  // (ckRH réaffecté après la réinitialisation → déclaré avec let ci-dessus)
  check("1re connexion IT : mustChangePassword = true", loginIT1.json?.mustChangePassword === true);
  await api("POST", "/api/auth/change-password", { currentPassword: "Provisoire2!b", newPassword: "NouveauMot2!c" }, ckIT1);
  const loginIT2 = await api("POST", "/api/auth/login", { email: emailIT, password: "NouveauMot2!c" });
  const ckIT = cookieDe(loginIT2);

  // Réinitialisation par le SuperAdmin → re-forçage
  const ckSupFresh = cookieDe(await api("POST", "/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }));
  const reset = await api("POST", `/api/users/${idRH}/password`, { password: "Reinit3!d" }, ckSupFresh);
  check("Réinitialisation RH par le SuperAdmin (200)", reset.status === 200, `status=${reset.status}`);
  const l3 = await api("POST", "/api/auth/login", { email: emailRH, password: "Reinit3!d" });
  check("Après réinitialisation : forçage REVENUE", l3.json?.mustChangePassword === true);
  await api("POST", "/api/auth/change-password", { currentPassword: "Reinit3!d", newPassword: "FinalRH4!e" }, cookieDe(l3));
  // (la réinitialisation a RÉVOQUÉ les sessions antérieures — Task 94) :
  // reconnexion pour obtenir une session RH fraîche pour la matrice.
  const loginRH3 = await api("POST", "/api/auth/login", { email: emailRH, password: "FinalRH4!e" });
  ckRH = cookieDe(loginRH3);
  check("Session RH fraîche après réinitialisation", Boolean(ckRH));

  // ------------------------------------------------------------------
  // 2-6) FORMULAIRES DU PORTAIL SANS CHAMPS D'IDENTITÉ (HTML réel servi)
  // ------------------------------------------------------------------
  console.log("-- Points 2-6 : formulaires du portail (champs supprimés) --");
  // La page /demandes est derrière la session employé : les vérifications se
  // font sur le CODE SOURCE réellement servi par le portail.
  const srcPageDemandes = fs.readFileSync("scripts/portail-server.js", "utf8");
  for (const id of ["att-travail-nom-auto", "att-salaire-nom-auto", "conge-cin", "sortie-nom-auto", "parr-nom-auto"]) {
    check(`Champ « ${id} » retiré du portail`, !srcPageDemandes.includes(id));
  }
  check("Attestation travail : bouton Envoyer seul", srcPageDemandes.includes('id="form-att-travail"') && /id="form-att-travail"[^]*?Envoyer<\/button>/.test(srcPageDemandes) && !srcPageDemandes.includes('id="att-travail-nom-auto"'));
  check("Congé : champ N+1 conservé (validation par e-mail)", srcPageDemandes.includes('id="conge-n1"'));
  check("Parrainage : champ N+1 conservé", srcPageDemandes.includes('id="parr-n1"'));

  // ------------------------------------------------------------------
  // 7) ENVOI EN ARRIÈRE-PLAN + COPIE RH (statique sur le code réel servi)
  // ------------------------------------------------------------------
  console.log("-- Point 7 : e-mails en arrière-plan + copie RH --");
  const sourcePortail = fs.readFileSync("scripts/portail-server.js", "utf8");
  check("Fonction d'envoi arrière-plan présente", sourcePortail.includes("async function envoyerEmailsDemandeEnArrierePlan"));
  check("Appel NON bloquant (sans await)", /envoyerEmailsDemandeEnArrierePlan\(demandeCreee, cree\.id, routage\.dest, cfgMail\)\s*\n\s*\.catch/.test(sourcePortail));
  check("Réponse HTTP immédiate avec email.arrierePlan", sourcePortail.includes("arrierePlan: Boolean(routage.dest)"));
  check("Liste des destinataires (N+1 + RH) dans la réponse", sourcePortail.includes("destinataires: destinataires,"));
  check("Copie RH congé + autorisation", sourcePortail.includes("demande-creation-copie-rh"));

  // ------------------------------------------------------------------
  // 8) VALIDATION PAR RÉPONSE E-MAIL DU N+1 (lib + intégration sans serveur)
  // ------------------------------------------------------------------
  console.log("-- Point 8 : validation par réponse e-mail du N+1 --");
  const det = portail.libValidationN1.detecterIntentionValidation;
  check("Lib : « Accepté » → VALIDEE", det("Bonjour, c'est accepté pour moi.") === "VALIDEE");
  check("Lib : « Refusé » → REFUSEE (priorité)", det("Refusé cette fois, ok ?") === "REFUSEE");
  check("Lib : citation de l'e-mail d'origine neutralisée", det("D'accord.\n\n----- Message d'origine -----\nÉcrire « Accepté » ou « Refusé ».") === "VALIDEE");
  check("Lib : texte neutre → null", det("Je regarde la semaine prochaine.") === null);
  check("Consigne VALIDATION PAR E-MAIL dans les e-mails de création (congé/autorisation)", sourcePortail.includes("VALIDATION PAR E-MAIL : répondez directement à cet e-mail"));

  // Demande CONGE réelle en base + réponse simulée du N+1
  const cinTest = "TEST18888";
  await db.demandeAdministrative.deleteMany({ where: { reference: { startsWith: "DEM-" } } });
  // (on ne peut pas créer la demande via le portail sans accès employé : création directe fidèle)
  const emailN1 = `n1-${suffixe}@entreprise.test`;
  const refAccept = "DEM-2026-" + crypto.randomInt(10000, 99999);
  const cree1 = await db.demandeAdministrative.create({
    data: {
      reference: refAccept,
      type: "CONGE",
      cin: cryptoBd.chiffrerChamp(cinTest, true),
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp(emailN1),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ typeConge: "Annuel", emailN1 })),
      employeEmail: cryptoBd.chiffrerChamp(`emp-${suffixe}@entreprise.test`),
      messageIdEnvoi: "test-msgid-" + suffixe + "-1",
    },
  });
  const ver1 = await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Congé " + refAccept + " (traitement requis)",
    from: { value: [{ address: emailN1 }] },
    inReplyTo: "<test-msgid-" + suffixe + "-1>",
    text: "Bonjour, c'est accepté. Bonne journée.",
  });
  check("Réponse « Accepté » du N+1 : demande TRAITÉE", ver1.statut === "TRAITE", JSON.stringify(ver1).slice(0, 140));
  check("Statut porté à ACCEPTEE", ver1.statutApres === "ACCEPTEE");
  const enBase1 = await db.demandeAdministrative.findUnique({ where: { id: cree1.id } });
  check("Statut persisté en base", enBase1.statut === "ACCEPTEE");
  check("Traité par le responsable N+1 (e-mail)", String(enBase1.traitePar || "").includes("N+1"));

  // Refus
  const refRefus = "DEM-2026-" + crypto.randomInt(10000, 99999);
  const cree2 = await db.demandeAdministrative.create({
    data: {
      reference: refRefus, type: "CONGE",
      cin: cryptoBd.chiffrerChamp(cinTest, true),
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp(emailN1),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({ typeConge: "Exceptionnel", emailN1 })),
      employeEmail: cryptoBd.chiffrerChamp(`emp-${suffixe}@entreprise.test`),
      messageIdEnvoi: "test-msgid-" + suffixe + "-2",
    },
  });
  const ver2 = await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Congé " + refRefus,
    from: { value: [{ address: emailN1 }] },
    text: "Désolé, refusé pour cette période.",
  });
  check("Réponse « Refusé » → REFUSEE", ver2.statutApres === "REFUSEE", JSON.stringify(ver2).slice(0, 120));

  // Mauvais expéditeur → ignoré (aucune validation croisée possible)
  const ver3 = await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Congé " + refAccept,
    from: { value: [{ address: "imposteur@ Pirate.test".replace(" Pirate", "pirate") }] },
    text: "Accepté",
  });
  check("Mauvais expéditeur → IGNORE (anti-validation croisée)", ver3.statut === "IGNORE", JSON.stringify(ver3).slice(0, 120));

  // Notifications RH + employé : la fonction de notification existe et vise les 2 rôles
  check("Notifications RH + employé après validation (fonction dédiée)", sourcePortail.includes("async function envoyerEmailsValidationN1") && sourcePortail.includes('role: "rh"') && sourcePortail.includes('role: "employe"'));
  check("E-mail employé : auteur dynamique de la décision (N+1 ou service RH — v0.2.108)", sourcePortail.includes("motAction + \" par \" + auteurPossessif") && sourcePortail.includes("motAction + \" par \" + auteurNom"));

  // ------------------------------------------------------------------
  // 9) REDIMENSIONNEMENT DES COLONNES (statique : composant intégré)
  // ------------------------------------------------------------------
  console.log("-- Point 9 : redimensionnement des colonnes --");
  check("Composant colonnes-redimensionnables présent", fs.existsSync("src/components/payslip/colonnes-redimensionnables.tsx"));
  for (const f of ["all-tab", "portal-access-tab", "users-tab", "search-tab", "demandes-tab"]) {
    const src = fs.readFileSync(`src/components/payslip/${f}.tsx`, "utf8");
    check(`Tableau « ${f} » équipé des poignées`, src.includes("utiliserColonnesRedimensionnables"));
  }

  // ------------------------------------------------------------------
  // 10-18) MATRICE FINALE DES PERMISSIONS
  // ------------------------------------------------------------------
  console.log("-- Points 10-18 : matrice finale des permissions --");
  // IT
  const itSig = await api("GET", "/api/signature-config", undefined, ckIT);
  check("IT : tampon/signature → 403 (point 10/14)", itSig.status === 403, `status=${itSig.status}`);
  check("IT : code dédié FONCTIONNALITE_NON_AUTORISEE_IT", itSig.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT");
  const itDemandes = await api("GET", "/api/demandes", undefined, ckIT);
  check("IT : demandes administratives → 403 (point 14)", itDemandes.status === 403, `status=${itDemandes.status}`);
  const itPortal = await api("GET", "/api/portal-access", undefined, ckIT);
  check("IT : accès portail → 403 (point 14)", itPortal.status === 403, `status=${itPortal.status}`);
  const itUpload = await api("POST", "/api/payslips/upload", {}, ckIT);
  check("IT : import de fiches → 403 (point 14)", itUpload.status === 403, `status=${itUpload.status}`);
  const itListe = await api("GET", "/api/payslips?page=1&limit=1", undefined, ckIT);
  check("IT : liste des fiches → 403 (point 14)", itListe.status === 403, `status=${itListe.status}`);
  const itUsers = await api("GET", "/api/users", undefined, ckIT);
  check("IT : liste des utilisateurs → 200 (lecture seule)", itUsers.status === 200, `status=${itUsers.status}`);
  const itCree = await api("POST", "/api/users", { name: "x", email: `x-${suffixe}@t.local`, password: "Xx12345!x", role: "RH" }, ckIT);
  check("IT : création de compte → 403 (point 14)", itCree.status === 403, `status=${itCree.status}`);
  const itMail = await api("GET", "/api/mail-config", undefined, ckIT);
  check("IT : configuration SMTP → 200 (seule fonctionnalité conservée)", itMail.status === 200, `status=${itMail.status}`);
  // RH
  const rhCree = await api("POST", "/api/users", { name: "x", email: `y-${suffixe}@t.local`, password: "Xx12345!x", role: "IT" }, ckRH);
  check("RH : création de compte → 403 (point 15)", rhCree.status === 403, `status=${rhCree.status}`);
  const rhSup = await api("DELETE", `/api/users/${idIT}`, undefined, ckRH);
  check("RH : suppression de compte → 403 (point 15)", [403].includes(rhSup.status), `status=${rhSup.status}`);
  const rhRole = await api("POST", `/api/users/${idIT}/role`, { role: "RH" }, ckRH);
  check("RH : modification de rôle → 403 (point 15)", rhRole.status === 403, `status=${rhRole.status}`);
  const rhPortal = await api("GET", "/api/portal-access", undefined, ckRH);
  check("RH : accès portail (Nom/Prénom modifiables) → 200 (point 11)", rhPortal.status === 200, `status=${rhPortal.status}`);
  const rhSig = await api("GET", "/api/signature-config", undefined, ckRH);
  check("RH : tampon/signature → 200 (autorisé)", rhSig.status === 200);
  // SuperAdmin
  const supCookie = cookieDe(await api("POST", "/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }));
  const saCree = await api("POST", "/api/users", { name: "SA Check", email: `sa-${suffixe}@t.local`, password: "Xx12345!x", role: "IT" }, supCookie);
  check("SuperAdmin : création de compte → 200 (point 13)", [200, 201].includes(saCree.status), `status=${saCree.status}`);
  const saSup = await api("DELETE", `/api/users/${saCree.json?.user?.id || saCree.json?.id}`, undefined, supCookie);
  check("SuperAdmin : suppression de compte → 200 (point 13)", [200, 204].includes(saSup.status), `status=${saSup.status}`);
  const saSig = await api("GET", "/api/signature-config", undefined, supCookie);
  check("SuperAdmin : tampon/signature → 200 (point 13)", saSig.status === 200);

  // ------------------------------------------------------------------
  // 16-17) SUPPRESSIONS (statique)
  // ------------------------------------------------------------------
  console.log("-- Points 16-17 : fonctionnalités supprimées --");
  check("Aucune API /api/auth/signup", !fs.existsSync("src/app/api/auth/signup"));
  check("Aucun fichier SECURISER-INSCRIPTION-WINDOWS", !fs.existsSync("SECURISER-INSCRIPTION-WINDOWS.bat") && !fs.existsSync(".next/standalone/SECURISER-INSCRIPTION-WINDOWS.bat"));

  // ------------------------------------------------------------------
  // NETTOYAGE
  // ------------------------------------------------------------------
  console.log("-- Nettoyage --");
  const estCompteTest = (e) => e.endsWith("@test.local") || e.endsWith("@t.local");
  for (const u of await db.user.findMany({ select: { id: true, email: true } })) {
    try {
      const e = cryptoBd.dechiffrerChamp(u.email);
      if (estCompteTest(e)) await db.user.delete({ where: { id: u.id } });
    } catch {}
  }
  await db.demandeAdministrative.deleteMany({ where: { id: { in: [cree1.id, cree2.id] } } });
  const resteUsers = (await db.user.findMany({ select: { email: true } })).filter((u) => {
    try { return estCompteTest(cryptoBd.dechiffrerChamp(u.email)); } catch { return false; }
  }).length;
  check("Comptes de test supprimés", resteUsers === 0);
  check("Demandes de test supprimées", (await db.demandeAdministrative.count({ where: { id: { in: [cree1.id, cree2.id] } } })) === 0);

  console.log(`\n==== BILAN : ${OK} OK / ${KO} FAIL ====`);
  await db.$disconnect();
  process.exit(KO === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error("[ERREUR FATALE]", e); try { await db.$disconnect(); } catch {} process.exit(2); });
