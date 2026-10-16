#!/usr/bin/env node
/* ============================================================================
 * TEST DE CONNEXION E-MAIL — SMTP (465 SSL / 587 STARTTLS) + IMAP (993)
 * ----------------------------------------------------------------------------
 * (Task 201 / v0.2.156) Utilitaire de diagnostic : vérifie RÉELLEMENT les
 * identifiants saisis dans l'administration en se connectant au serveur.
 * Testé avec Zoho Mail : smtp.zoho.com (465 ET 587) + imap.zoho.com (993).
 *
 * USAGE :
 *   node scripts/test_zoho_connexion.js moncompte@zohomail.com 'MotDePasse'
 *   node scripts/test_zoho_connexion.js moncompte@zohomail.com 'MotDePasse' smtp.autre.fr imap.autre.fr
 *
 * Sans argument, les variables d'environnement ZOHO_EMAIL / ZOHO_PASS sont
 * utilisées. AUCUNE donnée sensible n'est écrite dans un fichier ni affichée
 * (le mot de passe est masqué dans toutes les sorties).
 *
 * Résultat : un e-mail de test est ENVOYÉ vers votre propre adresse à chaque
 * connexion SMTP réussie — vérifiez la boîte de réception (et les indésirables).
 * ==========================================================================*/
const path = require("path");
const racine = path.join(__dirname, "..");

let nodemailer, ImapFlow;
try {
  nodemailer = require(path.join(racine, "node_modules", "nodemailer"));
} catch (e) {
  console.error("Paquet nodemailer introuvable : lancez « npm install » à la racine du projet d'abord.");
  process.exit(1);
}
try {
  ImapFlow = require(path.join(racine, "node_modules", "imapflow")).ImapFlow;
} catch (e) {
  console.error("Paquet imapflow introuvable : lancez « npm install » à la racine du projet d'abord.");
  process.exit(1);
}

const email = process.argv[2] || process.env.ZOHO_EMAIL || "";
const pass = process.argv[3] || process.env.ZOHO_PASS || "";
const smtpHost = process.argv[4] || "smtp.zoho.com";
const imapHost = process.argv[5] || smtpHost.replace(/^smtp\./, "imap.");

if (!email || !pass) {
  console.log("Usage : node scripts/test_zoho_connexion.js <adresse> <motDePasse> [hôteSMTP] [hôteIMAP]");
  console.log("Exemple Zoho : node scripts/test_zoho_connexion.js rh@zohomail.com 'MonMotDePasse'");
  process.exit(1);
}

function masque(adresse) {
  return String(adresse).replace(/^(.).*(@.*)$/, "$1***$2");
}

const DELAI = 20000; // 20 s max par tentative

function avecDelai(p, libelle) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("DÉLAI DÉPASSÉ (" + libelle + ")")), DELAI)),
  ]);
}

async function testSmtp(host, port) {
  const secure = port === 465;
  const transport = nodemailer.createTransport({
    host, port, secure,
    auth: { user: email, pass },
    tls: { rejectUnauthorized: false },
    connectionTimeout: DELAI,
    greetingTimeout: DELAI,
    socketTimeout: DELAI,
  });
  try {
    await avecDelai(transport.verify(), host + ":" + port);
    const info = await avecDelai(transport.sendMail({
      from: email,
      to: email,
      subject: "Auto-RH — Test SMTP réussi (" + host + " port " + port + ")",
      text: "Cet e-mail prouve que l'envoi SMTP fonctionne avec " + host + " port " + port + ". " +
            "Les e-mails de demandes partiront par ce même canal.",
    }), "envoi " + host + ":" + port);
    return { ok: true, response: info.response || "" };
  } catch (e) {
    return { ok: false, erreur: (e && e.message) ? e.message : String(e) };
  }
}

async function testImap(host, port) {
  const client = new ImapFlow({
    host, port, secure: true,
    auth: { user: email, pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await avecDelai(client.connect(), host + ":" + port);
    const lock = await avecDelai(client.getMailboxLock("INBOX"), "INBOX " + host);
    let statut = null;
    try {
      statut = await client.status("INBOX", { messages: true, unseen: true });
    } finally {
      lock.release();
    }
    await client.logout();
    return { ok: true, messages: statut.messages, nonLus: statut.unseen };
  } catch (e) {
    try { client.close(); } catch (_) {}
    return { ok: false, erreur: (e && e.message) ? e.message : String(e) };
  }
}

(async () => {
  console.log("=== TEST E-MAIL — compte : " + masque(email) + " — SMTP : " + smtpHost + " — IMAP : " + imapHost + " ===");

  console.log("\n--- SMTP (envoi) ---");
  for (const port of [465, 587]) {
    const r = await testSmtp(smtpHost, port);
    if (r.ok) {
      console.log("OK    " + smtpHost + ":" + port + "  → e-mail de test ENVOYÉ à " + masque(email) + " [" + r.response + "]");
    } else {
      console.log("ÉCHEC " + smtpHost + ":" + port + "  → " + r.erreur);
    }
  }

  console.log("\n--- IMAP (réception des réponses) ---");
  const ri = await testImap(imapHost, 993);
  if (ri.ok) {
    console.log("OK    " + imapHost + ":993  → INBOX : " + ri.messages + " message(s), " + ri.nonLus + " non lu(s)");
  } else {
    console.log("ÉCHEC " + imapHost + ":993  → " + ri.erreur);
  }

  console.log("\n=== FIN DU TEST — vérifiez la boîte (et les indésirables) de " + masque(email) + " ===");
  process.exit(0);
})();
