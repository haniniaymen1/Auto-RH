#!/usr/bin/env node
"use strict";
/* ============================================================================
 * (NOUVEAU v0.2.167) DIAGNOSTIC COMPLET DE LA CONFIGURATION E-MAIL SMTP/IMAP
 * ============================================================================
 *
 * RÉPOND à : « Erreur serveur dans la configuration SMTP et IMAP ».
 *
 * Exécute SUR LA MACHINE DE L'UTILISATEUR le même parcours que l'application
 * (env → base → chiffrement → réseau → SMTP réel → IMAP réel) et affiche, à
 * chaque étape, le résultat et la SOLUTION en français clair. Aucune
 * modification : lecture seule (sauf envoi optionnel d'un e-mail de test).
 *
 * UTILISATION (Windows comme Linux/Mac) — depuis le dossier du site :
 *
 *     node scripts\diagnostic-config-email.js
 *     node scripts\diagnostic-config-email.js --test-dest moi@exemple.com
 *          (étape 7 : envoie en PLUS un e-mail de test réel à cette adresse)
 *
 * Aucun identifiant n'est affiché : comptes tronqués, mots de passe jamais.
 * ==========================================================================*/
process.chdir(__dirname + "/..");

const fs = require("fs");
const path = require("path");
const net = require("net");
const tls = require("tls");
const dns = require("dns");

const ROOT = process.cwd();
const OK = "  [OK]   ";
const KO = "  [KO]   ";
const INFO = "  [INFO] ";
const ALERTE = "  [!]    ";
const resultats = []; // { etape, ok, detail }

function titre(n, texte) {
  console.log("");
  console.log("=== [" + n + "/8] " + texte + " " + "=".repeat(Math.max(2, 58 - texte.length)));
}
function ok(txt) { console.log(OK + txt); }
function ko(txt) { console.log(KO + txt); }
function info(txt) { console.log(INFO + txt); }
function alerte(txt) { console.log(ALERTE + txt); }
function masquerCompte(v) {
  const s = String(v || "");
  if (!s) return "(vide)";
  const at = s.indexOf("@");
  if (at <= 0) return s.slice(0, 2) + "***";
  return s.slice(0, Math.min(3, at)) + "***@" + s.slice(at + 1);
}

/* ---------------- Chargement du .env (même mécanique que le portail) ------ */
const env = {};
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
})();
// Les variables déjà présentes dans l'environnement restent prioritaires.
for (const k of Object.keys(env)) if (process.env[k] === undefined) process.env[k] = env[k];

/* ------------------------------------------------------------------------ */
async function main() {
  console.log("DIAGNOSTIC DE LA CONFIGURATION E-MAIL (SMTP / IMAP) — Auto-RH v0.2.167");
  console.log("Dossier : " + ROOT);

  /* ---------------- [1/8] Fichier .env ---------------------------------- */
  titre(1, "Fichier .env");
  const envPath = path.join(ROOT, ".env");
  let etape1 = true;
  if (!fs.existsSync(envPath)) {
    ko("Fichier .env ABSENT à la racine du site.");
    alerte("Solution : relancez le lanceur habituel (DEMARRER-WINDOWS.bat) qui crée le .env automatiquement.");
    etape1 = false;
  } else {
    ok("Fichier .env présent.");
    const dbUrl = env.DATABASE_URL || process.env.DATABASE_URL || "";
    if (!dbUrl) {
      ko("DATABASE_URL absent du .env — l'application ne trouve pas la base.");
      alerte("Solution : relancez le lanceur habituel (il réécrit DATABASE_URL avec le chemin absolu de db/custom.db).");
      etape1 = false;
    } else {
      const dbPath = dbUrl.replace(/^file:/, "");
      const existe = fs.existsSync(dbPath);
      ok("DATABASE_URL = " + dbUrl + (existe ? " (fichier présent)" : "  ← [KO] FICHIER INTROUVABLE"));
      if (!existe) {
        alerte("Solution : vérifiez que db/custom.db existe à l'endroit indiqué (chemin ABSOLU requis).");
        etape1 = false;
      }
    }
    const aKey = env.AUTO_RH_STORAGE_KEY || process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || "";
    const aSecret = env.AUTH_SECRET || process.env.AUTH_SECRET || "";
    if (aKey) info("AUTO_RH_STORAGE_KEY : définie (clé de chiffrement DÉDIÉE — bien).");
    else if (aSecret) info("AUTH_SECRET : défini — la clé de chiffrement est dérivée de ce secret.");
    else info("Ni AUTO_RH_STORAGE_KEY ni AUTH_SECRET : la clé de chiffrement est la valeur PAR DÉFAUT intégrée (normal pour l'environnement livré clé en main).");
    const intervalle = env.AUTO_RH_IMAP_INTERVALLE || process.env.AUTO_RH_IMAP_INTERVALLE || "";
    if (intervalle) info("AUTO_RH_IMAP_INTERVALLE = " + intervalle + " s (relever de la boîte RH).");
  }
  resultats.push({ etape: "Fichier .env", ok: etape1 });

  /* ---------------- [2/8] Dépendances Node ------------------------------ */
  titre(2, "Dépendances (node_modules)");
  let etape2 = true;
  const deps = [
    ["@prisma/client", "@prisma/client"],
    ["nodemailer", "nodemailer"],
    ["imapflow", "imapflow"],
  ];
  for (const [nom, module] of deps) {
    try {
      const m = require(module);
      const version = m.version || (require(module + "/package.json") || {}).version || "?";
      ok(nom + " : installé (v" + version + ")");
    } catch (e) {
      ko(nom + " : ABSENT de node_modules — " + e.message.split("\n")[0]);
      etape2 = false;
    }
  }
  if (!etape2) {
    alerte("Solution : dans le dossier du site, exécutez « npm install » (connexion Internet requise une fois), puis relancez ce diagnostic.");
  }
  resultats.push({ etape: "Dépendances", ok: etape2 });

  /* ---------------- [3/8] Base de données / schéma ---------------------- */
  titre(3, "Base de données et schéma");
  let etape3 = true;
  let db = null;
  let cfg = null;
  try {
    const { PrismaClient } = require("@prisma/client");
    db = new PrismaClient();
    // Client BRUT (sans le middleware de chiffrement de l'application) :
    // on lit les valeurs CHIFFRÉES telles quelles — indispensable pour
    // diagnostiquer la clé indépendamment de l'application.
    cfg = await db.mailConfig.findUnique({ where: { id: "smtp" } });
    ok("Table MailConfig accessible." + (cfg ? "" : " (aucune configuration enregistrée — le panneau de l'administration reste utilisable)"));
    const colonnesAttendues = [
      "host", "port", "secure", "username", "password", "from",
      "rhEmail", "itEmail", "responsablesMap", "parrainageEmail",
      "attestationTravailEmail", "attestationSalaireEmail", "congeEmail", "autorisationEmail",
      "imapActif", "imapHost", "imapPort", "imapSecure", "imapUser", "imapPassword",
    ];
    const cols = await db.$queryRawUnsafe("PRAGMA table_info(MailConfig)");
    const presentes = new Set(cols.map((c) => c.name));
    const manquantes = colonnesAttendues.filter((c) => !presentes.has(c));
    if (manquantes.length) {
      ko("Colonnes MANQUANTES dans la table MailConfig : " + manquantes.join(", "));
      alerte("Solution : mettez la base à jour — « npx prisma db push » (ou relancez le lanceur habituel) — puis redémarrez les services.");
      etape3 = false;
    } else {
      ok("Schéma complet : les " + colonnesAttendues.length + " colonnes attendues sont présentes.");
    }
  } catch (e) {
    ko("Accès à la base impossible : " + String(e.message).split("\n")[0]);
    alerte("Solution : vérifiez DATABASE_URL / le fichier db/custom.db, exécutez « npx prisma db push », puis redémarrez.");
    etape3 = false;
  }
  resultats.push({ etape: "Base de données / schéma", ok: etape3 });

  /* ---------------- [4/8] Clé de chiffrement ---------------------------- */
  titre(4, "Cohérence de la clé de chiffrement (.env ↔ base)");
  let etape4 = true;
  let motDePasseClair = "";
  if (cfg) {
    try {
      const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));
      const champs = ["username", "password", "imapUser", "imapPassword"];
      const clairs = {};
      for (const c of champs) {
        clairs[c] = cfg[c] ? cryptoBd.dechiffrerChamp(cfg[c]) : "";
      }
      ok("Champs chiffrés de la configuration e-mail DÉCHIFFRABLES avec la clé actuelle du .env.");
      motDePasseClair = String(clairs.password || clairs.imapPassword || "");
      info("Compte d'envoi : " + masquerCompte(clairs.username) + " | mot de passe : " + (clairs.password ? "présent" : "(absent)"));
      info("Compte IMAP    : " + masquerCompte(clairs.imapUser || clairs.username) + " | mot de passe : " + (clairs.imapPassword ? "présent" : (clairs.password ? "reprend celui du SMTP" : "(absent)")));
    } catch (e) {
      ko("BASE ILLISIBLE avec la clé actuelle : " + String(e.message).split("\n")[0].slice(0, 160));
      alerte("CAUSE TYPIQUE : le fichier .env a été régénéré (nouvel AUTH_SECRET) alors que la base a été chiffrée avec l'ancienne clé — ou base livrée + .env personnel.");
      alerte("Solution AUTOMATIQUE : exécutez « node scripts/reparer-cle-chiffrement.js » (sauvegarde automatique de la base, puis rechiffrement avec la clé ACTUELLE du .env), puis redémarrez les services.");
      alerte("Solution alternative : restaurez le fichier .env D'ORIGINE (celui qui va avec la base) puis redémarrez.");
      etape4 = false;
    }
  } else {
    info("Aucune configuration e-mail en base : rien à déchiffrer (configurez depuis l'administration).");
  }
  resultats.push({ etape: "Clé de chiffrement", ok: etape4 });

  /* ---------------- [5/8] Configuration lue ----------------------------- */
  titre(5, "Configuration e-mail enregistrée");
  let host = "", port = 0, imapHost = "", imapPort = 993, user = "", imapUser = "";
  if (cfg) {
    host = String(cfg.host || "");
    port = Number(cfg.port) || 0;
    imapHost = String(cfg.imapHost || "");
    imapPort = Number(cfg.imapPort) || 993;
    const secure = port === 465;
    ok("SMTP : " + (host || "(hôte non configuré)") + " : " + port + (host ? (secure ? " (SSL/TLS)" : " (STARTTLS)") : ""));
    ok("IMAP : " + (cfg.imapActif ? "ACTIVÉ — " : "désactivé — ") + (imapHost || "(hôte non configuré)") + " : " + imapPort);
    info("Expéditeur affiché : " + (cfg.from || "(vide)"));
    info("Routage RH : " + (cfg.rhEmail || "(vide)") + " | congé : " + (cfg.congeEmail || "(vide)") + " | autorisation : " + (cfg.autorisationEmail || "(vide)"));
    if (!host) {
      alerte("Le serveur d'envoi n'est pas configuré : remplissez le panneau « Envoi d'e-mails (SMTP) » de l'administration (Accès portail), puis enregistrez.");
    }
    if (cfg.imapActif && !imapHost) {
      alerte("La réception IMAP est activée SANS hôte : saisissez imap.gmail.com (ou équivalent) puis enregistrez.");
    }
  } else {
    info("Aucune configuration enregistrée (première utilisation).");
  }
  resultats.push({ etape: "Configuration lue", ok: Boolean(cfg && cfg.host) });

  /* ---------------- [6/8] Connectivité réseau --------------------------- */
  titre(6, "Connectivité réseau (DNS, port, TLS)");
  async function sondeTcp(hostCible, portCible, delai) {
    return new Promise((resoudre) => {
      const sock = net.connect({ host: hostCible, port: portCible });
      const finir = (r) => { try { sock.destroy(); } catch (_) {} resoudre(r); };
      sock.setTimeout(delai || 12000);
      sock.on("connect", () => finir({ ok: true }));
      sock.on("timeout", () => finir({ ok: false, erreur: "délai dépassé (port filtré ?)" }));
      sock.on("error", (e) => finir({ ok: false, erreur: e.code || e.message }));
    });
  }
  async function sondeTls(hostCible, portCible, delai) {
    return new Promise((resoudre) => {
      const sock = tls.connect({ host: hostCible, port: portCible, rejectUnauthorized: false });
      const finir = (r) => { try { sock.destroy(); } catch (_) {} resoudre(r); };
      sock.setTimeout(delai || 12000);
      sock.on("secureConnect", () => finir({ ok: true, protocole: sock.getProtocol() }));
      sock.on("timeout", () => finir({ ok: false, erreur: "délai dépassé" }));
      sock.on("error", (e) => finir({ ok: false, erreur: e.code || e.message }));
    });
  }
  let etape6 = true;
  async function testerPoint(hostCible, portCible, libelle) {
    if (!hostCible) { info(libelle + " : hôte non configuré — sonde ignorée."); return; }
    let dnsOk = true;
    try { await dns.promises.lookup(hostCible); } catch (e) { dnsOk = false; }
    if (!dnsOk) {
      ko(libelle + " : nom de serveur INTROUVABLE (DNS) — " + hostCible);
      alerte("Vérifiez l'orthographe de l'hôte et la connexion Internet du serveur.");
      etape6 = false;
      return;
    }
    const tcp = await sondeTcp(hostCible, portCible);
    if (!tcp.ok) {
      ko(libelle + " : port " + portCible + " INJOIGNABLE sur " + hostCible + " — " + tcp.erreur);
      alerte("Le pare-feu / proxy / fournisseur d'accès bloque probablement le port " + portCible + ". Essayez un autre réseau, ou ouvrez le port sortant " + portCible + ".");
      etape6 = false;
      return;
    }
    if (portCible === 993 || portCible === 465) {
      const t = await sondeTls(hostCible, portCible);
      if (!t.ok) {
        ko(libelle + " : la poignée de main TLS échoue — " + t.erreur);
        alerte("Port " + portCible + " attend SSL/TLS direct — vérifiez le port saisi (993 IMAP, 465 SMTP).");
        etape6 = false;
        return;
      }
      ok(libelle + " : " + hostCible + ":" + portCible + " joignable, TLS " + t.protocole + " établi.");
    } else {
      ok(libelle + " : " + hostCible + ":" + portCible + " joignable.");
    }
  }
  await testerPoint(host, port, "SMTP");
  if (cfg && cfg.imapActif) await testerPoint(imapHost, imapPort, "IMAP");
  resultats.push({ etape: "Connectivité réseau", ok: etape6 });

  /* ---------------- [7/8] Test SMTP réel -------------------------------- */
  titre(7, "Test SMTP réel (envoi)");
  // (corrigé v0.2.167) parsing robuste : --test-dest adresse OU --test-dest=adresse,
  // sinon CHAÎNE VIDE (l'ancien code prenait process.argv[0] par erreur).
  let testDest = "";
  const idxFlag = process.argv.indexOf("--test-dest");
  if (idxFlag >= 0 && process.argv[idxFlag + 1] && !process.argv[idxFlag + 1].startsWith("--")) {
    testDest = process.argv[idxFlag + 1].trim();
  } else {
    const avecEgal = process.argv.find((a) => a.startsWith("--test-dest="));
    if (avecEgal) testDest = avecEgal.split("=").slice(1).join("=").trim();
  }
  if (testDest && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testDest)) {
    info("Adresse « " + testDest + " » invalide : e-mail de test ignoré (format attendu : nom@domaine.ext).");
    testDest = "";
  }
  let etape7 = true;
  if (cfg && host && motDePasseClair) {
    try {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: host,
        port: port,
        secure: port === 465,
        auth: { user: String(cfg.username ? require(path.join(ROOT, "scripts", "lib-crypto-bd.js")).dechiffrerChamp(cfg.username) : ""), pass: motDePasseClair },
        connectionTimeout: 20000,
        greetingTimeout: 20000,
      });
      await transporter.verify();
      ok("Connexion + authentification SMTP acceptées par " + host + ":" + port + ".");
      if (testDest) {
        try {
          const infos = await transporter.sendMail({
            from: cfg.from || String(require(path.join(ROOT, "scripts", "lib-crypto-bd.js")).dechiffrerChamp(cfg.username)),
            to: testDest,
            subject: "Auto-RH — e-mail de test du diagnostic SMTP",
            text: "Test envoyé par scripts/diagnostic-config-email.js le " + new Date().toLocaleString("fr-FR") + ". Si vous lisez cet e-mail, l'envoi fonctionne.",
          });
          ok("E-mail de test envoyé à " + testDest + " (identifiant message : " + infos.messageId + "). Vérifiez sa réception (dossier Spam si besoin).");
        } catch (e) {
          ko("Envoi refusé par le serveur SMTP : " + String(e.message).split("\n")[0]);
          alerte(indiceSmtp(e.message || ""));
          etape7 = false;
        }
      } else {
        info("Astuce : ajoutez « --test-dest vous@exemple.com » pour aussi envoyer un e-mail de test réel.");
      }
    } catch (e) {
      ko("SMTP : " + String(e.message).split("\n")[0]);
      alerte(indiceSmtp(e.message || ""));
      etape7 = false;
    }
  } else {
    info("Test ignoré : configuration SMTP incomplète en base (hôte ou mot de passe absent).");
  }
  resultats.push({ etape: "Test SMTP réel", ok: etape7 });

  /* ---------------- [8/8] Test IMAP réel -------------------------------- */
  titre(8, "Test IMAP réel (réception des réponses)");
  let etape8 = true;
  if (cfg && cfg.imapActif && imapHost && motDePasseClair) {
    let ImapFlow = null;
    try { ImapFlow = require("imapflow").ImapFlow; } catch (e) { ImapFlow = null; }
    if (!ImapFlow) {
      ko("Paquet imapflow absent — exécutez « npm install ».");
      etape8 = false;
    } else {
      const client = new ImapFlow({
        host: imapHost,
        port: imapPort,
        secure: imapPort === 993,
        auth: {
          user: String(cfg.imapUser ? require(path.join(ROOT, "scripts", "lib-crypto-bd.js")).dechiffrerChamp(cfg.imapUser) : (cfg.username ? require(path.join(ROOT, "scripts", "lib-crypto-bd.js")).dechiffrerChamp(cfg.username) : "")),
          pass: motDePasseClair,
        },
        tls: { rejectUnauthorized: false },
        logger: false,
        connectionTimeout: 20000,
        greetingTimeout: 20000,
      });
      try {
        await client.connect();
        ok("Connexion IMAP établie avec " + imapHost + ":" + imapPort + (imapPort === 993 ? " (SSL/TLS)" : " (STARTTLS)") + ".");
        const lock = await client.getMailboxLock("INBOX");
        let nonLus = 0;
        try {
          const uids = await client.search({ seen: false }, { uid: true });
          nonLus = Array.isArray(uids) ? uids.length : 0;
        } finally { lock.release(); }
        ok("Boîte INBOX ouverte — compte et mot de passe acceptés (" + nonLus + " message(s) non lu(s)).");
        try { await client.logout(); } catch (_) {}
        info("Le portail relèvera cette boîte toutes les " + (Number(env.AUTO_RH_IMAP_INTERVALLE) || 120) + " s pour détecter les réponses RH / manager.");
      } catch (e) {
        const brut = String((e && e.message) || e) + " " + String((e && e.responseText) || "");
        ko("IMAP : " + brut.split("\n")[0].slice(0, 200));
        alerte(indiceImap(brut));
        try { await client.logout(); } catch (_) {}
        etape8 = false;
      }
    }
  } else {
    info("Test ignoré : réception IMAP non activée (ou hôte/mot de passe manquant).");
  }
  resultats.push({ etape: "Test IMAP réel", ok: etape8 });

  try { if (db) await db.$disconnect(); } catch (_) {}

  /* ---------------- RÉSUMÉ ---------------------------------------------- */
  console.log("");
  console.log("================================================================");
  console.log("  RÉSUMÉ DU DIAGNOSTIC");
  console.log("================================================================");
  let globalOk = true;
  for (const r of resultats) {
    if (r.ok) ok(r.etape + " : conforme");
    else { ko(r.etape + " : PROBLÈME (voir les solutions ci-dessus)"); globalOk = false; }
  }
  console.log("");
  if (globalOk) {
    console.log("TOUT EST CONFORME : la configuration SMTP/IMAP est opérationnelle sur");
    console.log("cette machine. Si le panneau de l'administration affiche malgré tout");
    console.log("une erreur, redémarrez les services (node scripts/redemarrer-services-4000-4001.js)");
    console.log("puis videz le cache du navigateur (Ctrl+F5).");
  } else {
    console.log("Un ou plusieurs points sont à corriger — appliquez les « Solution : »");
    console.log("affichées ci-dessus, puis relancez ce diagnostic pour vérifier.");
  }
  process.exit(globalOk ? 0 : 1);
}

/** Indices SMTP (alignés sur le comportement de l'application). */
function indiceSmtp(m) {
  const s = String(m || "");
  const contient = (...mots) => mots.some((x) => s.toLowerCase().includes(x.toLowerCase()));
  if (contient("ENOTFOUND", "EAI_AGAIN")) return "Nom de serveur SMTP introuvable : vérifiez l'orthographe (ex. smtp.gmail.com).";
  if (contient("ECONNREFUSED")) return "Connexion refusée : port probablement faux ou bloqué (465 = SSL/TLS, 587 = STARTTLS).";
  if (contient("ETIMEDOUT", "timeout", "ESOCKETTIMEDOUT")) return "Le serveur SMTP ne répond pas dans le délai : pare-feu / port bloqué sur ce réseau.";
  if (contient("not accepted", "535", "530", "authenticationfailed", "invalid credentials", "badcredentials", "username and password")) return "Identifiant ou mot de passe refusé : pour Gmail, utilisez un MOT DE PASSE D'APPLICATION (compte Google → Sécurité → Validation en deux étapes → Mots de passe d'application) — PAS le mot de passe habituel du compte.";
  if (contient("self signed", "certificate", "ERR_SSL", "wrong version number", "EPROTO")) return "Problème TLS : port 465 attendu pour le SSL/TLS direct (587 = STARTTLS) — ou certificat du serveur interne.";
  if (contient("daily user sending limit", "550-5.4.5")) return "Quota d'envoi Gmail atteint pour aujourd'hui (environ 500 destinataires/jour).";
  return "Vérifiez l'hôte, le port (465 = SSL/TLS, 587 = STARTTLS), le compte et le mot de passe d'application.";
}

/** Indices IMAP — jumeaux de indiceImapLisible() de l'application. */
function indiceImap(m) {
  const s = String(m || "");
  const contient = (...mots) => mots.some((x) => s.toLowerCase().includes(x.toLowerCase()));
  if (contient("ENOTFOUND", "EAI_AGAIN")) return "Nom de serveur IMAP introuvable : vérifiez l'orthographe (ex. imap.gmail.com).";
  if (contient("ECONNREFUSED")) return "Connexion refusée : le port est probablement faux ou bloqué (993 = SSL/TLS, 143 = STARTTLS).";
  if (contient("ETIMEDOUT", "timeout", "ESOCKETTIMEDOUT")) return "Le serveur IMAP ne répond pas dans le délai : vérifiez hôte/port et le pare-feu.";
  if (contient("AUTHENTICATIONFAILED", "authentication failed", "invalid credentials", "login failed", "AUTHORIZATIONFAILED")) return "Identifiant ou mot de passe refusé : pour Gmail et Outlook, utilisez un MOT DE PASSE D'APPLICATION (compte → Sécurité → Validation en deux étapes).";
  if (contient("unsafe login", "plaintext")) return "Le serveur exige une connexion chiffrée : utilisez le port 993 (SSL/TLS).";
  if (contient("certificate", "self-signed", "ERR_SSL", "wrong version number", "EPROTO")) return "Problème TLS : port 993 attendu pour le SSL/TLS direct (143 = STARTTLS).";
  if (contient("no such mailbox", "nonexistent", "invalid mailbox")) return "La boîte INBOX est indisponible : vérifiez qu'il s'agit d'un compte de MESSAGERIE (IMAP) et pas du serveur SMTP seul.";
  if (contient("command failed")) return "Le serveur a refusé une commande IMAP — vérifiez hôte/port et identifiants, puis relancez le diagnostic.";
  return "Vérifiez l'hôte, le port (993 = SSL/TLS, 143 = STARTTLS), le compte et le mot de passe d'application.";
}

main().catch((e) => {
  console.error("ERREUR DU DIAGNOSTIC :", e && e.stack ? e.stack.split("\n").slice(0, 4).join("\n") : e);
  process.exit(2);
});
