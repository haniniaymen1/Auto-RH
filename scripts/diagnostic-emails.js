#!/usr/bin/env node
/**
 * ============================================================================
 *  DIAGNOSTIC E-MAILS — DEMANDES ADMINISTRATIVES (v0.2.152)
 * ============================================================================
 *  But : identifier POURQUOI certains e-mails de demandes ne sont pas reçus.
 *
 *  Vérifie, dans l'ordre :
 *   1. La configuration SMTP (base MailConfig) — hôte, port, identifiants,
 *      expéditeur, adresses de routage (RH, parrainage, attestations, congé,
 *      autorisation) + réception IMAP.
 *   2. La CONNEXION SMTP RÉELLE (test d'authentification nodemailer).
 *   3. Les accès portail (PortalAccess) : employés sans e-mail de
 *      notification, managers affectés sans e-mail, employés sans manager.
 *   4. Le routage THÉORIQUE de chaque type de demande avec la config courante
 *      (même logique que destinatairePourDemande du portail).
 *   5. Les demandes récentes en base : destinataire résolu, e-mail employé.
 *   6. Le journal logs/journal-emails.log : échecs par code
 *      (MAIL_NON_CONFIGURE, SMTP_ECHEC, DESTINATAIRE_ABSENT, RH_NON_CONFIGURE),
 *      demandes concernées, et demandes récentes SANS AUCUN envoi réussi.
 *
 *  Usage :
 *    node scripts/diagnostic-emails.js                 (diagnostic complet)
 *    node scripts/diagnostic-emails.js --envoi=moi@domaine.tn
 *        (en plus : envoie un e-mail de test réel à l'adresse indiquée)
 *    node scripts/diagnostic-emails.js --journal=500
 *        (analyse les 500 dernières lignes du journal au lieu de 300)
 *
 *  Aucune écriture en base : lecture seule (sauf l'e-mail de test optionnel).
 *  Aucune donnée sensible affichée : mots de passe JAMAIS, adresses tronquées
 *  seulement si --complet est passé (sinon elles sont affichées en entier pour
 *  faciliter le diagnostic local — choisir avant de partager la sortie).
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

// ---------- Chargement du .env de la racine (comme le portail) ----------
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    const contenu = fs.readFileSync(envPath, "utf8");
    String(contenu).split(/\r?\n/).forEach(function (ligne) {
      const t = ligne.trim();
      if (!t || t.startsWith("#") || t.indexOf("=") < 0) return;
      const i = t.indexOf("=");
      const cle = t.slice(0, i).trim();
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (cle && process.env[cle] === undefined) process.env[cle] = val;
    });
  } catch (e) { /* .env illisible : continuons sans */ }
})();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });
const cryptoBd = require("./lib-crypto-bd.js");

// ---------- Options ----------
const options = { envoi: null, journalLignes: 300, complet: false };
process.argv.slice(2).forEach(function (a) {
  if (a.indexOf("--envoi=") === 0) options.envoi = a.slice(8).trim();
  else if (a.indexOf("--journal=") === 0) options.journalLignes = parseInt(a.slice(10), 10) || 300;
  else if (a === "--complet") options.complet = true;
});

const C = {
  titre: "\x1b[1;36m",
  ok: "\x1b[0;32m",
  ko: "\x1b[0;31m",
  warn: "\x1b[0;33m",
  gris: "\x1b[0;90m",
  reset: "\x1b[0m",
};
function titre(s) { console.log("\n" + C.titre + "==== " + s + " ====" + C.reset); }
function ok(s) { console.log("  " + C.ok + "[OK]" + C.reset + " " + s); }
function ko(s) { console.log("  " + C.ko + "[PROBLÈME]" + C.reset + " " + s); }
function warn(s) { console.log("  " + C.warn + "[ATTENTION]" + C.reset + " " + s); }
function info(s) { console.log("  " + s); }
function gris(s) { console.log("      " + C.gris + s + C.reset); }

function emailValide(s) {
  const v = String(s == null ? "" : s).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) && v.length <= 254;
}
function dechiffrer(v) {
  if (!v) return "";
  try { return String(cryptoBd.dechiffrerChamp(v) || ""); } catch (e) { return ""; }
}
function masquer(v) {
  if (options.complet) return String(v || "");
  const s = String(v || "");
  if (!s.includes("@")) return s;
  const i = s.indexOf("@");
  return s.slice(0, Math.min(2, i)) + "•••" + s.slice(i);
}

// ============================================================================
async function main() {
  console.log(C.titre +
    "\n╔══════════════════════════════════════════════════════════════╗" +
    "\n║   DIAGNOSTIC E-MAILS — DEMANDES ADMINISTRATIVES (v0.2.152)   ║" +
    "\n╚══════════════════════════════════════════════════════════════╝" +
    C.reset);
  console.log(C.gris + "  Racine : " + ROOT + C.reset);

  // ---------- 1) CONFIGURATION SMTP ----------
  titre("1. CONFIGURATION SMTP (panneau « Envoi d'e-mails (SMTP) »)");
  let cfg = null;
  try {
    cfg = await prisma.mailConfig.findUnique({ where: { id: "smtp" } });
  } catch (e) {
    ko("Base illisible : " + (e && e.message ? e.message : e));
  }
  if (!cfg) {
    ko("AUCUNE configuration SMTP en base : AUCUN e-mail ne peut partir. Ouvrez l'administration → onglet Accès portail → « Envoi d'e-mails (SMTP) », configurez et enregistrez.");
  } else {
    const host = String(cfg.host || "");
    const port = cfg.port || 587;
    if (!host) {
      ko("Champ « Serveur SMTP » VIDE : AUCUN e-mail ne peut partir (code journalisé MAIL_NON_CONFIGURE).");
    } else {
      ok("Serveur : " + host + " : " + port + (port === 465 ? " (SSL implicite)" : port === 587 ? " (STARTTLS)" : ""));
    }
    const user = dechiffrer(cfg.username);
    const pass = dechiffrer(cfg.password);
    if (!user || !pass) warn("Identifiants incomplets (" + (user ? "utilisateur ok" : "utilisateur VIDE") + ", " + (pass ? "mot de passe ok" : "mot de passe VIDE/chiffré autre clé") + ") : selon le serveur, l'envoi peut être REFUSÉ (authentification requise).");
    else ok("Utilisateur configuré : " + masquer(user));
    if (host.toLowerCase().includes("gmail")) {
      info("Gmail : le mot de passe doit être un MOT DE PASSE D'APPLICATION (16 caractères, validation en 2 étapes activée). Un mot de passe de connexion normal est REFUSÉ par Google.");
    }
    const from = String(cfg.from || "");
    if (from) ok("Expéditeur (Mail From) : " + from);
    else if (user && emailValide(user)) info("Expéditeur dérivé du compte : AutoRH <" + masquer(user) + ">");
    else warn("Ni « Mail From » ni utilisateur e-mail valide : l'expéditeur sera « AutoRH » (certains serveurs REFUSENT cet expéditeur).");

    // Routage
    titre("  Routage (panneau SMTP → routage)");
    const routage = [
      ["rhEmail", "Auto-RH (boîte de repli de TOUS les types + copies congé/autorisation)", cfg.rhEmail],
      ["attestationTravailEmail", "Attestations de travail (destinataire principal)", cfg.attestationTravailEmail],
      ["attestationSalaireEmail", "Attestations de salaire (destinataire principal)", cfg.attestationSalaireEmail],
      ["congeEmail", "Congés (COPIE systématique)", cfg.congeEmail],
      ["autorisationEmail", "Autorisations de sortie (COPIE systématique)", cfg.autorisationEmail],
      ["parrainageEmail", "Parrainages (destinataire principal)", cfg.parrainageEmail],
      ["itEmail", "Service informatique (expéditeur comptes RH/IT)", cfg.itEmail],
    ];
    let rhManquant = false;
    routage.forEach(function (r) {
      const v = String(r[2] || "").trim();
      if (v) ok(r[0] + " = " + masquer(v) + "  " + C.gris + "(" + r[1] + ")" + C.reset);
      else {
        if (r[0] === "rhEmail") { ko(r[0] + " VIDE — " + r[1]); rhManquant = true; }
        else warn(r[0] + " vide — " + r[1] + " → repli sur la boîte RH" + (rhManquant ? " … ELLE AUSSI VIDE → e-mail PERDU (DESTINATAIRE_ABSENT)" : ""));
      }
    });
    const mapTxt = String(cfg.responsablesMap || "");
    if (mapTxt.trim()) info("responsablesMap (ancien routage par département) : " + mapTxt.split(/\r?\n/).filter(Boolean).length + " ligne(s)");
    if (cfg.imapActif && cfg.imapHost) ok("Réception IMAP active : " + cfg.imapHost + ":" + (cfg.imapPort || 993) + " (réponses manager/RH lues toutes les 120 s)");
    else warn("Réception IMAP DÉSACTIVÉE : les réponses par e-mail du manager/RH ne sont JAMAIS lues → les demandes de congé/autorisation restent « En attente » même si le manager répond.");

    // ---------- 2) TEST DE CONNEXION SMTP RÉEL ----------
    titre("2. TEST DE CONNEXION SMTP RÉEL");
    if (!host) {
      ko("Test impossible : serveur non configuré.");
    } else {
      try {
        const nodemailer = require("nodemailer");
        const transport = nodemailer.createTransport({
          host: host,
          port: port,
          secure: port === 465,
          auth: user && pass ? { user: user, pass: pass } : undefined,
          tls: { rejectUnauthorized: false },
          connectionTimeout: 15000,
          greetingTimeout: 12000,
          socketTimeout: 20000,
        });
        await transport.verify();
        ok("Connexion + authentification réussies : le serveur ACCEPTE les envois.");
      } catch (e) {
        ko("Connexion/authentification ÉCHOUÉE : " + (e && e.message ? e.message : e));
        const m = String(e && e.message ? e.message : "").toLowerCase();
        if (m.includes("auth") || m.includes("535") || m.includes("530")) info("→ Cause probable : identifiants refusés (Gmail : utiliser un MOT DE PASSE D'APPLICATION).");
        else if (m.includes("timeout") || m.includes("etimedout") || m.includes("econnrefused")) info("→ Cause probable : pare-feu/réseau bloquant le port " + port + ", ou hôte erroné.");
        else if (m.includes("certificate") || m.includes("tls")) info("→ Cause probable : certificat TLS (le portail tolère déjà les certificats auto-signés).");
        else if (m.includes("534")) info("→ Gmail : sécurité — mot de passe d'application requis.");
      }
    }

    // ---------- 3) TEST D'ENVOI OPTIONNEL ----------
    if (options.envoi) {
      titre("3. ENVOI D'UN E-MAIL DE TEST → " + options.envoi);
      if (!emailValide(options.envoi)) ko("Adresse invalide.");
      else if (!host) ko("Serveur SMTP non configuré : envoi impossible.");
      else {
        try {
          const nodemailer = require("nodemailer");
          const transport = nodemailer.createTransport({
            host: host, port: port, secure: port === 465,
            auth: user && pass ? { user: user, pass: pass } : undefined,
            tls: { rejectUnauthorized: false },
            connectionTimeout: 15000,
          });
          const fromEffectif = from || (user && emailValide(user) ? "AutoRH <" + user + ">" : "AutoRH");
          const info2 = await transport.sendMail({
            from: fromEffectif,
            to: options.envoi,
            subject: "AutoRH — test de diagnostic (" + new Date().toLocaleString("fr-FR") + ")",
            text: "Ceci est un e-mail de TEST généré par scripts/diagnostic-emails.js.\nSi vous le lisez, le SMTP et le routage fonctionnent.",
          });
          ok("E-mail de test ENVOYÉ (Message-ID : " + info2.messageId + ") — vérifiez la boîte ET le dossier spam.");
        } catch (e) {
          ko("Envoi de test ÉCHOUÉ : " + (e && e.message ? e.message : e));
        }
      }
    }
  } // --- fin else (configuration SMTP présente) : les sections suivantes s'exécutent dans tous les cas ---

  // ---------- 4) ACCÈS PORTAIL / MANAGERS ----------
    titre("4. ACCÈS PORTAIL — e-mails employés et affectations manager");
    let acces = [];
    try { acces = await prisma.portalAccess.findMany(); }
    catch (e) { ko("Lecture PortalAccess impossible : " + (e && e.message ? e.message : e)); }
    if (acces.length) {
      let avecEmail = 0, avecMailEnvoyeA = 0, sansAucun = 0;
      const managers = new Map(); // id -> { nom, email, valide }
      acces.forEach(function (a) {
        const em = dechiffrer(a.email);
        const mea = dechiffrer(a.mailEnvoyeA);
        if (emailValide(em)) avecEmail++;
        if (emailValide(mea)) avecMailEnvoyeA++;
        if (!emailValide(em) && !emailValide(mea)) sansAucun++;
        managers.set(a.id, {
          nom: dechiffrer(a.nomPrenom) || "(sans nom)",
          email: emailValide(em) ? em : (emailValide(mea) ? mea : null),
          managerId: a.managerId || null,
        });
      });
      info("Accès portail : " + acces.length + " — avec e-mail de notification : " + avecEmail + " — seulement mailEnvoyeA : " + avecMailEnvoyeA + " — SANS AUCUN e-mail : " + sansAucun);
      if (sansAucun > 0) {
        warn(sansAucun + " employé(s) SANS adresse de notification : pour eux, la CONFIRMATION de création et les notifications de décision ne partent PAS (le traitement part quand même au manager/RH).");
        acces.forEach(function (a) {
          const em = dechiffrer(a.email), mea = dechiffrer(a.mailEnvoyeA);
          if (!emailValide(em) && !emailValide(mea)) gris("  - " + (dechiffrer(a.nomPrenom) || "CIN " + masquer(dechiffrer(a.cin) || "?")) + " : email et mailEnvoyeA vides");
        });
      }
      let affectes = 0, mgrSansEmail = 0, mgrAbsent = 0;
      acces.forEach(function (a) {
        if (!a.managerId) return;
        affectes++;
        const mgr = managers.get(a.managerId);
        if (!mgr) { mgrAbsent++; gris("  - " + (dechiffrer(a.nomPrenom) || "?") + " → managerId " + a.managerId + " INTROUVABLE (accès supprimé ?)"); }
        else if (!mgr.email) { mgrSansEmail++; gris("  - " + (dechiffrer(a.nomPrenom) || "?") + " → manager « " + mgr.nom + " » SANS e-mail"); }
      });
      info("Employés avec un manager responsable affecté : " + affectes);
      if (mgrAbsent) warn(mgrAbsent + " affectation(s) vers un manager INEXISTANT → congé/autorisation partent au RH (repli).");
      if (mgrSansEmail) warn(mgrSansEmail + " manager(s) SANS e-mail → congé/autorisation partent au RH (repli), PAS au manager.");
    } else {
      warn("Aucun accès portail en base.");
    }

    // ---------- 5) ROUTAGE THÉORIQUE PAR TYPE (config courante) ----------
    titre("5. ROUTAGE THÉORIQUE PAR TYPE DE DEMANDE (config actuelle)");
    const rhE = String((cfg && cfg.rhEmail) || "").trim();
    const table = [
      ["ATTESTATION_TRAVAIL", String((cfg && cfg.attestationTravailEmail) || "").trim() || rhE, "Adresse dédiée attest. travail" + (String((cfg && cfg.attestationTravailEmail) || "").trim() ? "" : " (REPLI boîte RH)")],
      ["ATTESTATION_SALAIRE", String((cfg && cfg.attestationSalaireEmail) || "").trim() || rhE, "Adresse dédiée attest. salaire" + (String((cfg && cfg.attestationSalaireEmail) || "").trim() ? "" : " (REPLI boîte RH)")],
      ["PARRAINAGE", String((cfg && cfg.parrainageEmail) || "").trim() || rhE, "Adresse dédiée parrainage" + (String((cfg && cfg.parrainageEmail) || "").trim() ? "" : " (REPLI boîte RH)")],
      ["CONGE", rhE, "Manager responsable (PRINCIPAL) — boîte RH en repli + COPIE " + (String((cfg && cfg.congeEmail) || "").trim() ? "dédiée congé" : "RH")],
      ["AUTORISATION_SORTIE", rhE, "Manager responsable (PRINCIPAL) — boîte RH en repli + COPIE " + (String((cfg && cfg.autorisationEmail) || "").trim() ? "dédiée autorisation" : "RH")],
    ];
    table.forEach(function (t) {
      if (t[1]) ok(t[0] + " → " + masquer(t[1]) + "  " + C.gris + "(" + t[2] + ")" + C.reset);
      else ko(t[0] + " → AUCUN DESTINATAIRE (ni manager, ni RH configuré) : e-mail IMPOSSIBLE (DESTINATAIRE_ABSENT).");
    });
    info("Confirmation au DEMANDEUR (tous types) : e-mail de l'accès portail (sinon mailEnvoyeA). Copie congé/autorisation SAUTÉE si elle égale le destinataire principal (anti-doublon).");

    // ---------- 6) DEMANDES RÉCENTES ----------
    titre("6. DEMANDES RÉCENTES (30 dernières) — routage en base");
    let demandes = [];
    try {
      demandes = await prisma.demandeAdministrative.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
      });
    } catch (e) { ko("Lecture demandes impossible : " + (e && e.message ? e.message : e)); }
    demandes.forEach(function (d) {
      const dest = dechiffrer(d.destinataire);
      const empl = dechiffrer(d.employeEmail);
      const dj = (function () { try { return JSON.parse(dechiffrer(d.donnees) || "{}"); } catch (e) { return {}; } })();
      const mgrNom = dj.managerNom || "";
      info("  " + d.reference + "  " + d.type + "  " + C.gris + d.statut + C.reset);
      gris("     créée " + new Date(d.createdAt).toLocaleString("fr-FR") +
        " | traitement → " + (dest ? masquer(dest) : "AUCUN") +
        " | employé → " + (empl ? masquer(empl) : "AUCUN") +
        (mgrNom ? " | manager : " + mgrNom : ""));
      if (!dest) ko("     " + d.reference + " : AUCUN destinataire de traitement — l'e-mail n'a JAMAIS pu partir (voir motif dans le journal).");
      if (d.type === "CONGE" || d.type === "AUTORISATION_SORTIE") {
        if (!mgrNom) gris("     (pas de manager responsable à la création — routage RH/repli)");
      }
    });

    // ---------- 7) JOURNAL ----------
    titre("7. JOURNAL " + options.journalLignes + " dernières lignes — logs/journal-emails.log");
    const journalPath = path.join(ROOT, "logs", "journal-emails.log");
    let lignes = [];
    try {
      lignes = fs.readFileSync(journalPath, "utf8").split(/\r?\n/).filter(Boolean);
    } catch (e) {
      ko("Journal illisible/absent (" + journalPath + ") : AUCUN envoi n'a jamais été tenté depuis ce dossier — ou le portail n'a pas encore traité de demande.");
    }
    if (lignes.length) {
      const recentes = lignes.slice(-options.journalLignes);
      const entrees = [];
      recentes.forEach(function (l) {
        try { entrees.push(JSON.parse(l)); } catch (e) { /* ligne tronquée */ }
      });
      const parAction = {};
      const echecs = [];
      const reussitesParRef = {};
      entrees.forEach(function (e) {
        parAction[e.action] = (parAction[e.action] || 0) + 1;
        if (e.reference) {
          reussitesParRef[e.reference] = reussitesParRef[e.reference] || { ok: 0, ko: 0, codes: {} };
          if (e.succes) reussitesParRef[e.reference].ok++;
          else {
            reussitesParRef[e.reference].ko++;
            const code = e.code || "SMTP_ECHEC";
            reussitesParRef[e.reference].codes[code] = (reussitesParRef[e.reference].codes[code] || 0) + 1;
            echecs.push(e);
          }
        } else if (!e.succes) echecs.push(e);
      });
      info("Actions : " + Object.keys(parAction).map(function (a) { return a + "=" + parAction[a]; }).join(", "));
      if (!echecs.length) ok("AUCUN échec dans les " + entrees.length + " dernières entrées.");
      else {
        ko(echecs.length + " envoi(s) en ÉCHEC :");
        const vus = {};
        echecs.slice(-40).forEach(function (e) {
          const cle = [e.reference || "-", e.dest || "-", e.code || "-", e.erreur || ""].join("|");
          if (vus[cle]) return; vus[cle] = 1;
          gris("  - " + (e.horodatage || "").replace("T", " ").slice(0, 16) +
            "  " + (e.reference || "(sans réf.)") + "  " + (e.action || "?") +
            "  → " + (e.dest ? masquer(e.dest) : "(sans destinataire)") +
            "  [" + (e.code || "?") + "]" +
            (e.erreur ? " " + String(e.erreur).slice(0, 140) : ""));
        });
      }
      // Demandes récentes sans AUCUN envoi réussi
      if (demandes.length) {
        const orphelines = demandes.filter(function (d) { return !reussitesParRef[d.reference] || reussitesParRef[d.reference].ok === 0; });
        if (orphelines.length) {
          warn(orphelines.length + " demande(s) récente(s) SANS AUCUN e-mail réussi dans le journal :");
          orphelines.forEach(function (d) {
            const r = reussitesParRef[d.reference];
            gris("  - " + d.reference + " (" + d.type + ", " + d.statut + ")" +
              (r ? " échecs: " + r.ko + " codes: " + Object.keys(r.codes).join(",") : " AUCUNE trace d'envoi"));
          });
          info("  Pour ces demandes : soit SMTP non configuré à l'époque, soit aucun destinataire résolu, soit le journal a été purgé/roté.");
        } else ok("Toutes les demandes récentes ont au moins un e-mail RÉUSSI dans le journal.");
      }
    }

    // ---------- SYNTHÈSE ----------
    titre("SYNTHÈSE — causes les plus fréquentes de « je ne reçois pas d'e-mails »");
    console.log("  1. Serveur SMTP vide ou identifiants refusés (Gmail : mot de passe d'APPLICATION).");
    console.log("  2. rhEmail vide ET adresses dédiées vides : les demandes partent… nulle part.");
    console.log("  3. Congé/autorisation : le manager affecté n'existe pas ou n'a PAS d'e-mail → repli RH (si RH vide : perdu).");
    console.log("  4. Employé sans e-mail (PortalAccess.email + mailEnvoyeA vides) : pas de confirmation ni de notification de décision.");
    console.log("  5. Copie congé/autorisation sautée si elle est identique au destinataire principal (anti-doublon volontaire).");
    console.log("  6. E-mails reçus en SPAM / refusés par le serveur destinataire — vérifier le journal (réponse SMTP 250 = accepté).");
    console.log("  7. IMAP désactivé : les RÉPONSES du manager/RH ne sont jamais lues → la demande reste « En attente ».");
    console.log("");
    console.log("  Relancer avec un envoi réel :  node scripts/diagnostic-emails.js --envoi=votre.adresse@domaine.tn");
}

main()
  .catch(function (e) {
    console.error(C.ko + "ERREUR FATALE:" + C.reset, e && e.message ? e.message : e);
    process.exitCode = 1;
  })
  .finally(function () {
    prisma.$disconnect().catch(function () {});
  });
