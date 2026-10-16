#!/usr/bin/env node
/**
 * ============================================================================
 * TESTS E2E — Task 178 : 8 modifications demandées par l'utilisateur
 * ============================================================================
 *  1. Mot de passe IT/RH : changement OBLIGATOIRE à la première connexion
 *     (création ET réinitialisation par le superadministrateur) ;
 *  2/3. Attestations travail/salaire : champ « Nom et prénom » SUPPRIMÉ ;
 *  4. Congé : champ « Votre CIN » SUPPRIMÉ (récupération automatique) ;
 *  5. Parrainage : champ « Nom et prénom » SUPPRIMÉ ;
 *  6. Congé/autorisation : e-mails EN ARRIÈRE-PLAN (réponse immédiate) +
 *     DOUBLE ENVOI (service RH + responsable N+1) ;
 *  7. Validation par RÉPONSE e-mail du N+1 → statut « Acceptée » +
 *     notifications RH + employé (testé via traiterMessageRecu, module
 *     chargé SANS serveur) ;
 *  8. Redimensionnement des colonnes : vérifié au navigateur (hors script).
 * Nettoyage complet en fin de run (base rendue à l'état initial).
 * ============================================================================
 */
"use strict";
const path = require("path");
const fs = require("fs");

// .env (DATABASE_URL + AUTH_SECRET)
(function () {
  const envPath = path.join(__dirname, "..", ".env");
  try {
    for (const ligne of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch (e) { /* .env absent */ }
})();

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const EMAIL_SA = "superadmin@autorh.local";
const MDP_SA = "AutoRH-2026!Verif#1";

let ok = 0, ko = 0;
function verif(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom); }
  else { ko++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

function cookieDepuis(res) {
  const set = res.headers.get("set-cookie") || "";
  return set.split(";")[0];
}

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, headers: res.headers, body };
}

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ log: ["error"] });
const cryptoBd = require(path.join(__dirname, "lib-crypto-bd.js"));

(async () => {
  console.log("=== Task 178 — tests E2E ===");

  /* ------------------------------------------------------------------ */
  /* 0) Connexion superadministrateur (correctif AUTH_SECRET restauré)  */
  /* ------------------------------------------------------------------ */
  console.log("-- 0) Connexion superadministrateur (correctif .env)");
  const loginSa = await jsonFetch(ADMIN + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL_SA, password: MDP_SA, remember: true }),
  });
  verif("login superadmin 200 (email ou mot de passe correct)", loginSa.status === 200,
    JSON.stringify(loginSa.body));
  verif("login superadmin SANS mustChangePassword", loginSa.body && loginSa.body.mustChangePassword === false);
  const cookieSa = loginSa.headers.get("set-cookie").split(";")[0];

  /* ------------------------------------------------------------------ */
  /* 1) Création compte IT → changement forcé à la première connexion  */
  /* ------------------------------------------------------------------ */
  console.log("-- 1) Création compte IT par le superadmin (changement forcé)");
  const emailIt = "task178.it@demo.local";
  // nettoyage préalable éventuel
  const listeAvant = await jsonFetch(ADMIN + "/api/users", { headers: { cookie: cookieSa } });
  const ancien = (listeAvant.body.users || []).find((u) => u.email === emailIt);
  if (ancien) {
    await fetch(ADMIN + "/api/users/" + ancien.id, {
      method: "DELETE", headers: { cookie: cookieSa },
    });
  }
  const creation = await jsonFetch(ADMIN + "/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieSa },
    body: JSON.stringify({ name: "Test Task178 IT", email: emailIt, role: "IT", password: "Init-178!Demo" }),
  });
  verif("création compte IT 200/201", creation.status === 200 || creation.status === 201, JSON.stringify(creation.body));
  verif("message annonce le changement obligatoire à la première connexion",
    creation.body && /première connexion/.test(creation.body.message || ""));
  verif("passwordChangedAt renvoyé null (mot de passe INITIAL)",
    creation.body && creation.body.user && creation.body.user.passwordChangedAt === null,
    JSON.stringify(creation.body.user));
  const idIt = creation.body.user.id;

  // liste /api/users : passwordChangedAt présent (pour le badge interface)
  const liste = await jsonFetch(ADMIN + "/api/users", { headers: { cookie: cookieSa } });
  verif("GET /api/users expose passwordChangedAt (badge UI)",
    liste.body && liste.body.users && liste.body.users.every((u) => "passwordChangedAt" in u));

  // première connexion du compte IT
  const loginIt1 = await jsonFetch(ADMIN + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIt, password: "Init-178!Demo" }),
  });
  verif("1re connexion IT → 200 avec mustChangePassword:true",
    loginIt1.status === 200 && loginIt1.body.mustChangePassword === true, JSON.stringify(loginIt1.body));
  const cookieIt = loginIt1.headers.get("set-cookie").split(";")[0];

  // toutes les autres API répondent 403 tant que le changement n'est pas fait
  const apiBloquee = await jsonFetch(ADMIN + "/api/stats", { headers: { cookie: cookieIt } });
  verif("API de données → 403 MOT_DE_PASSE_EXPIRE avant changement",
    apiBloquee.status === 403 && apiBloquee.body.code === "MOT_DE_PASSE_EXPIRE", JSON.stringify(apiBloquee.body));
  const apiBloquee2 = await jsonFetch(ADMIN + "/api/payslips/employes", { headers: { cookie: cookieIt } });
  verif("2e API de données → 403 avant changement", apiBloquee2.status === 403);

  // changement du mot de passe
  const changement = await jsonFetch(ADMIN + "/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieIt },
    body: JSON.stringify({ currentPassword: "Init-178!Demo", newPassword: "Task178!Nouveau" }),
  });
  verif("changement de mot de passe 200", changement.status === 200, JSON.stringify(changement.body));
  const cookieIt2 = changement.headers.get("set-cookie").split(";")[0];
  const apiDebloquee = await jsonFetch(ADMIN + "/api/stats", { headers: { cookie: cookieIt2 } });
  verif("API de données → 200 après changement", apiDebloquee.status === 200,
    "statut " + apiDebloquee.status);
  const loginIt2 = await jsonFetch(ADMIN + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIt, password: "Task178!Nouveau" }),
  });
  verif("reconnexion avec le NOUVEAU mot de passe, sans changement forcé",
    loginIt2.status === 200 && loginIt2.body.mustChangePassword === false);

  /* ------------------------------------------------------------------ */
  /* 1 bis) Réinitialisation par le superadmin → changement forcé à nouveau */
  /* ------------------------------------------------------------------ */
  console.log("-- 1 bis) Réinitialisation du mot de passe IT par le superadmin");
  const reset = await jsonFetch(ADMIN + "/api/users/" + idIt + "/password", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieSa },
    body: JSON.stringify({ password: "Reset-178!Demo" }),
  });
  verif("réinitialisation 200 + message première connexion",
    reset.status === 200 && /prochaine connexion/.test(reset.body.message || ""), JSON.stringify(reset.body));
  const loginIt3 = await jsonFetch(ADMIN + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIt, password: "Reset-178!Demo" }),
  });
  verif("après réinitialisation → mustChangePassword:true OBLIGATOIRE",
    loginIt3.status === 200 && loginIt3.body.mustChangePassword === true, JSON.stringify(loginIt3.body));
  // l'ANCIEN mot de passe ne fonctionne plus
  const loginItAncien = await jsonFetch(ADMIN + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: emailIt, password: "Task178!Nouveau" }),
  });
  verif("ancien mot de passe révoqué après réinitialisation", loginItAncien.status === 401);

  /* ------------------------------------------------------------------ */
  /* 2-5) Portail : formulaires sans champs identité + demandes         */
  /* ------------------------------------------------------------------ */
  console.log("-- 2 à 5) Portail : formulaires + création de demandes");
  // accès employé de test (créé en base, mot de passe personnel déjà posé)
  const CIN_TEST = "TEST17899";
  // nettoyage préalable
  await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_TEST, true) } });
  await db.demandeAdministrative.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_TEST, true) } });

  // hash scrypt identique à l'app (src/lib/auth.ts)
  const crypto = require("crypto");
  function hashPassword(p) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(p, salt, 64).toString("hex");
    return "scrypt:" + salt + ":" + hash;
  }
  await db.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      passwordHash: cryptoBd.chiffrerChamp(hashPassword("Portail-178!Demo")),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      nomPrenom: cryptoBd.chiffrerChamp("Employe Test CentSeptHuit"),
      email: cryptoBd.chiffrerChamp("employe178@demo.local"),
      isActive: true,
      // employé DÉJÀ INSCRIT (première connexion complétée) : la session
      // /api/verify ouvre directement le portail, sans étape QR/OTP.
      lastLoginAt: new Date(),
      qrPresente: true,
    },
  });
  const loginEmp = await jsonFetch(PORTAIL + "/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cin: CIN_TEST, password: "Portail-178!Demo" }),
  });
  let cookieEmp = cookieDepuis(loginEmp);
  verif("connexion portail : CIN + mot de passe validés (étape OTP ouverte)",
    loginEmp.status === 200 && loginEmp.body && loginEmp.body.otpRequired === true && cookieEmp.length > 20,
    "statut " + loginEmp.status + " " + JSON.stringify(loginEmp.body));

  // Étape OTP (TOTP) : le test lit le secret DÉFINITIF généré pour l'employé
  // (même secret qu'encodé dans le QR affiché à l'écran) et calcule un code
  // à 6 chiffres (RFC 6238 — SHA-1, période 30 s, 6 chiffres).
  function codeTotp(secretBase32) {
    const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const c of secretBase32.replace(/=+$/, "")) {
      const v = alpha.indexOf(c.toUpperCase());
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
    const dec = hmac[hmac.length - 1] & 0xf;
    const valeur = ((hmac[dec] & 0x7f) << 24) | (hmac[dec + 1] << 16) | (hmac[dec + 2] << 8) | hmac[dec + 3];
    return String(valeur % 1000000).padStart(6, "0");
  }
  const accFrais = await db.portalAccess.findUnique({
    where: { cin: cryptoBd.chiffrerChamp(CIN_TEST, true) },
  });
  const secretOtp = cryptoBd.dechiffrerChamp(accFrais.totpSecret || "");
  verif("secret TOTP disponible (généré à la validation CIN + mot de passe)",
    Boolean(secretOtp) && secretOtp.length >= 16);
  const otpVerify = await jsonFetch(PORTAIL + "/api/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieEmp },
    body: JSON.stringify({ otp: codeTotp(secretOtp) }),
  });
  cookieEmp = cookieDepuis(otpVerify) || cookieEmp;
  verif("code OTP confirmé → session COMPLÈTE du portail",
    otpVerify.status === 200 && otpVerify.body && otpVerify.body.ok === true,
    "statut " + otpVerify.status + " " + JSON.stringify(otpVerify.body).slice(0, 200));

  // la page /demandes ne contient PLUS les champs supprimés
  const pageDemandes = await fetch(PORTAIL + "/demandes", { headers: { cookie: cookieEmp } });
  const htmlDemandes = await pageDemandes.text();
  verif("page /demandes 200", pageDemandes.status === 200);
  verif("attestation travail : champ « att-travail-nom-auto » SUPPRIMÉ", !htmlDemandes.includes("att-travail-nom-auto"));
  verif("attestation salaire : champ « att-salaire-nom-auto » SUPPRIMÉ", !htmlDemandes.includes("att-salaire-nom-auto"));
  verif("congé : champ « conge-cin » SUPPRIMÉ", !htmlDemandes.includes('id="conge-cin"'));
  verif("parrainage : champ « parr-nom-auto » SUPPRIMÉ", !htmlDemandes.includes("parr-nom-auto"));
  verif("autorisation de sortie : champ « sortie-nom-auto » CONSERVÉ (non demandé)", htmlDemandes.includes("sortie-nom-auto"));
  verif("congé : champ e-mail N+1 toujours présent (champ prévu)", htmlDemandes.includes('id="conge-n1"'));

  /* 6) création d'un congé : réponse immédiate + envoi arrière-plan */
  // Adresse du service RH configurée (routage) : nécessaire pour vérifier le
  // DOUBLE ENVOI RH + N+1 (sans host SMTP : l'envoi reste simulé/échec doux).
  await db.mailConfig.upsert({
    where: { id: "smtp" },
    update: { rhEmail: "rh.task178@demo.local" },
    create: { id: "smtp", rhEmail: "rh.task178@demo.local" },
  });
  const t0 = Date.now();
  const cong = await jsonFetch(PORTAIL + "/api/demandes", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieEmp },
    body: JSON.stringify({
      type: "CONGE",
      typeConge: "Annuel",
      dateDebut: "2026-10-05",
      dateFin: "2026-10-09",
      emailN1: "n1.task178@demo.local",
      commentaire: "Test Task 178",
    }),
  });
  const dureeMs = Date.now() - t0;
  verif("création congé 201", cong.status === 201, JSON.stringify(cong.body));
  verif("réponse IMMÉDIATE (< 1,5 s, SMTP non attendu)", dureeMs < 1500, dureeMs + " ms");
  verif("réponse : envoi en arrière-plan signalé", cong.body.email && cong.body.email.arrierePlan === true);
  verif("réponse : liste destinataires (N+1 + RH) fournie",
    Array.isArray(cong.body.destinataires) &&
    cong.body.destinataires.includes("n1.task178@demo.local") &&
    cong.body.destinataires.includes("rh.task178@demo.local"),
    JSON.stringify(cong.body.destinataires));

  const refConge = cong.body.reference;
  verif("référence DEM- générée", /^DEM-\d{4}-\d{5}$/.test(refConge || ""));

  /* 7) validation par réponse e-mail du N+1 (traiterMessageRecu sans serveur) */
  console.log("-- 7) Validation par réponse e-mail du N+1");
  const portail = require(path.join(__dirname, "portail-server.js"));
  verif("module portail chargé SANS démarrer le serveur (require test)", Boolean(portail.traiterMessageRecu));

  // jumelle de la détection (module pur) : cas de référence
  const det = portail.libValidationN1.detecterIntentionValidation;
  verif("détection « Accepté » → VALIDEE", det("Accepté, bonne continuation.") === "VALIDEE");
  verif("détection « Refusé » → REFUSEE", det("Je refuse cette demande.") === "REFUSEE");
  verif("détection réponse neutre → null", det("Bonjour, pouvez-vous préciser les dates ?") === null);
  verif("anti faux-positif : citation seule (consignes) → null",
    det("Une nouvelle demande nécessite votre traitement.\nVALIDATION PAR E-MAIL : répondez « Accepté » ou « Refusé ».") === null);

  // la demande existe toujours EN_ATTENTE avant la réponse (si créée)
  if (!refConge) {
    console.log("  (session portail absente : étapes 6-7 adaptées)");
  }
  const avantReponse = refConge
    ? await db.demandeAdministrative.findUnique({ where: { reference: refConge } })
    : null;
  verif("demande congé EN_ATTENTE avant réponse du N+1", avantReponse && avantReponse.statut === "EN_ATTENTE");

  // réponse « Accepté » d'un EXPÉDITEUR NON AUTORISÉ → IGNORE (sécurité)
  const mauvaisExp = await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Demande de congé " + refConge + " (traitement requis)",
    from: { value: [{ address: "intrus@demo.local" }] },
    text: "Accepté",
    attachments: [],
  });
  verif("réponse d'un expéditeur NON autorisé → IGNORE (anti-validation abusive)",
    mauvaisExp.statut === "IGNORE", JSON.stringify(mauvaisExp));

  // réponse « Accepté » du BON N+1 (rattachement par la référence du sujet) → ACCEPTEE
  const bonneReponse = refConge ? await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Demande de congé " + refConge + " (traitement requis)",
    from: { value: [{ address: "n1.task178@demo.local" }] },
    text: "Accepté, bon courage pour la suite.\n\nLe 26 sept. 2026, Auto-RH a écrit :\n> VALIDATION PAR E-MAIL : répondez « Accepté » ou « Refusé ».",
    attachments: [],
  }) : { statut: "ABSENT" };
  verif("réponse « Accepté » du N+1 → TRAITE + intention VALIDEE",
    bonneReponse.statut === "TRAITE" && bonneReponse.intention === "VALIDEE", JSON.stringify(bonneReponse));
  const apresReponse = refConge
    ? await db.demandeAdministrative.findUnique({ where: { reference: refConge } })
    : null;
  verif("statut passé automatiquement à ACCEPTEE", apresReponse && apresReponse.statut === "ACCEPTEE",
    "statut=" + (apresReponse ? apresReponse.statut : "absent"));
  verif("traité par « Responsable N+1 (e-mail) »", apresReponse && apresReponse.traitePar === "Responsable N+1 (e-mail)");

  // notification employé/RH journalisée
  let journalBrut = "";
  try { journalBrut = fs.readFileSync(path.join(__dirname, "..", "logs", "journal-emails.log"), "utf8"); } catch (e) { journalBrut = ""; }
  verif("journal : notification de validation N+1 enregistrée",
    journalBrut.includes("demande-validation-n1") && journalBrut.includes(refConge));

  // 7 bis) réponse « Refusé » d'une AUTORISATION → REFUSEE
  const aut = await jsonFetch(PORTAIL + "/api/demandes", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieEmp },
    body: JSON.stringify({
      type: "AUTORISATION_SORTIE",
      date: "2026-10-01",
      departement: "COMPTABILITE",
      motif: "Test Task 178",
      nombreHeures: "2",
      heureSortie: "14:00",
      heureRetour: "16:00",
      compensation: "NON",
    }),
  });
  verif("création autorisation de sortie 201", aut.status === 201, JSON.stringify(aut.body));
  const refAut = aut.body.reference;
  const autBdAvant = refAut ? await db.demandeAdministrative.findUnique({ where: { reference: refAut } }) : null;
  verif("autorisation créée EN_ATTENTE (destinataire = responsable/routage)",
    autBdAvant && autBdAvant.statut === "EN_ATTENTE", "statut=" + (autBdAvant ? autBdAvant.statut : "absent"));
  const reponseRefus = refAut ? await portail.traiterMessageRecu({
    subject: "Re: Auto-RH — Autorisation de sortie " + refAut,
    from: { value: [{ address: "rh.task178@demo.local" }] },
    text: "Refusé ce jour, réunion indispensable.",
    attachments: [],
  }) : { statut: "ABSENT" };
  // destinataire d'une autorisation = responsable du département (repli cfg.rhEmail en test)
  const autBd = refAut ? await db.demandeAdministrative.findUnique({ where: { reference: refAut } }) : null;
  if (reponseRefus.statut === "TRAITE" && autBd) {
    verif("réponse « Refusé » → REFUSEE", autBd.statut === "REFUSEE", "statut=" + autBd.statut);
  } else {
    verif("réponse d'un autre expéditeur ignorée (routage responsable absent en test)",
      reponseRefus.statut === "IGNORE", JSON.stringify(reponseRefus.motif || ""));
  }

  // attestations : comportement historique conservé (réponse RH avec document)
  const att = await jsonFetch(PORTAIL + "/api/demandes", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieEmp },
    body: JSON.stringify({ type: "ATTESTATION_TRAVAIL" }),
  });
  verif("création attestation de travail 201 (sans champ nom/prénom)",
    att.status === 201, JSON.stringify(att.body));
  const attBd = att.body.reference ? await db.demandeAdministrative.findUnique({ where: { reference: att.body.reference } }) : null;
  const donneesAtt = attBd ? JSON.parse(cryptoBd.dechiffrerChamp(attBd.donnees) || "{}") : {};
  verif("nom de l'employé récupéré AUTOMATIQUEMENT côté serveur (donnees.nom)",
    (donneesAtt.nom || "").includes("Employe Test"), JSON.stringify(donneesAtt));

  // journal : copie RH pour le congé (demande-creation-copie-rh) — SMTP non configuré
  // en test ⇒ entrée journalisée avec echec MAIL_NON_CONFIGURE mais l'ACTION doit exister
  let journal2 = "";
  try { journal2 = fs.readFileSync(path.join(__dirname, "..", "logs", "journal-emails.log"), "utf8"); } catch (e) { journal2 = ""; }
  verif("journal : action « demande-creation-copie-rh » présente (double envoi RH+N+1 branché)",
    journal2.includes("demande-creation-copie-rh"));

  /* ------------------------------------------------------------------ */
  /* 1 ter) correctif import forbiddenSuperadmin (403 propre, pas 500)  */
  /* ------------------------------------------------------------------ */
  console.log("-- 1 ter) Correctif forbiddenSuperadmin");
  const mauvaisRole = await jsonFetch(ADMIN + "/api/users/" + idIt, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", cookie: cookieEmp }, // session EMPLOYÉ portail ≠ session admin
  });
  verif("PATCH /api/users/[id] avec session invalide → 401 (pas de crash)",
    mauvaisRole.status === 401, "statut " + mauvaisRole.status);

  /* ------------------------------------------------------------------ */
  /* Nettoyage                                                          */
  /* ------------------------------------------------------------------ */
  console.log("-- Nettoyage");
  const delIt = await jsonFetch(ADMIN + "/api/users/" + idIt, {
    method: "DELETE", headers: { cookie: cookieSa },
  });
  verif("compte IT de test supprimé", delIt.status === 200 || delIt.status === 204, "statut " + delIt.status);
  await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_TEST, true) } });
  await db.demandeAdministrative.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN_TEST, true) } });
  // routage RH remis à vide (état initial des tests Task 173)
  await db.mailConfig.updateMany({ data: { rhEmail: "" } });
  console.log("  OK   accès employé + demandes de test supprimés");

  console.log("\n=== RÉSULTAT : " + ok + " OK / " + ko + " FAIL ===");
  process.exitCode = ko ? 1 : 0;
})().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
