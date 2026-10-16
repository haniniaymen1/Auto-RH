#!/usr/bin/env node
/**
 * Task 206 — PRÉP : état de la config mail actuelle + sonde Gmail
 *  1) Lit la ConfigMail en base (mot de passe déchiffré masqué partiellement)
 *  2) Sonde TCP/TLS vers smtp.gmail.com:465/587 + imap.gmail.com:993
 *  3) Test AUTH SMTP avec smtp.test@autorh.tn (mot de passe Zoho réutilisé ?)
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const tls = require("tls");
const net = require("net");

function masquer(s) {
  if (!s) return "(vide)";
  if (s.length <= 4) return "*".repeat(s.length);
  return s.slice(0, 2) + "*".repeat(Math.max(2, s.length - 4)) + s.slice(-2);
}

async function main() {
  // 1) Config mail en base
  const db = new (require("@prisma/client").PrismaClient)();
  const cfg = await db.mailConfig.findFirst({ orderBy: { id: "desc" } });
  console.log("=== CONFIG MAIL ACTUELLE (base sandbox) ===");
  if (!cfg) { console.log("  (aucune)"); }
  else {
    const pass = cryptoBd.dechiffrerChamp ? cryptoBd.dechiffrerChamp(cfg.password) || cfg.password : cfg.password;
    console.log(JSON.stringify({
      id: cfg.id, actif: cfg.actif, host: cfg.host, port: cfg.port, securise: cfg.securise,
      username: cfg.username, password: masquer(pass) + " (réel: " + (pass ? pass.length : 0) + " car.)",
      from: cfg.from, rhEmail: cfg.rhEmail,
      imapActif: cfg.imapActif, imapHost: cfg.imapHost, imapPort: cfg.imapPort,
      imapUsername: cfg.imapUsername, imapPassword: masquer(cryptoBd.dechiffrerChamp ? cryptoBd.dechiffrerChamp(cfg.imapPassword) || cfg.imapPassword : cfg.imapPassword),
      adresseAttestationTravail: cfg.adresseAttestationTravail,
      adresseAttestationSalaire: cfg.adresseAttestationSalaire,
      adresseAutorisationSortie: cfg.adresseAutorisationSortie,
      adresseConge: cfg.adresseConge,
    }, null, 2));
  }
  await db.$disconnect();

  // 2) Sonde TCP/TLS Gmail
  function sonde(nom, host, port, starttls) {
    return new Promise((resolve) => {
      const debut = Date.now();
      const s = starttls
        ? net.connect({ host, port, timeout: 12000 })
        : tls.connect({ host, port, timeout: 12000, rejectUnauthorized: false });
      let texte = "";
      s.on(starttls ? "connect" : "secureConnect", () => {
        if (!starttls) texte = "TLS OK cn=" + (s.getPeerCertificate().subject?.CN || "?");
      });
      s.on("data", (d) => { texte += d.toString().split("\r\n")[0] + " | "; if (texte.length > 200) s.end(); });
      s.on("timeout", () => { s.destroy(); resolve([nom, false, "timeout " + (Date.now() - debut) + " ms"]); });
      s.on("error", (e) => resolve([nom, false, "ERREUR " + e.message + " (" + (Date.now() - debut) + " ms)"]));
      s.on("close", () => resolve([nom, true, texte.trim() + " — " + (Date.now() - debut) + " ms"]));
      setTimeout(() => { try { s.destroy(); } catch {} }, 14000);
    });
  }
  console.log("\n=== SONDE CONNECTIVITÉ GMAIL ===");
  const res = await Promise.all([
    sonde("smtp.gmail.com:465 (SSL)", "smtp.gmail.com", 465, false),
    sonde("smtp.gmail.com:587 (STARTTLS)", "smtp.gmail.com", 587, true),
    sonde("imap.gmail.com:993 (SSL)", "imap.gmail.com", 993, false),
  ]);
  for (const [n, okk, d] of res) console.log("  " + (okk ? "OK  " : "FAIL") + " " + n + " — " + d);

  // 3) Test AUTH SMTP Gmail (candidats de mots de passe)
  const nodemailer = require("nodemailer");
  const candidats = [
    ["smtp.test@autorh.tn", "Chelsea4ever****"],
    ["smtp.test@autorh.tn", "Chelsea4ever"],
  ];
  console.log("\n=== TEST AUTH SMTP GMAIL (réutilisation mot de passe Zoho) ===");
  for (const [user, pass] of candidats) {
    try {
      const t = nodemailer.createTransport({
        host: "smtp.gmail.com", port: 465, secure: true,
        auth: { user, pass }, connectionTimeout: 15000, tls: { rejectUnauthorized: false },
      });
      const rep = await new Promise((r) => t.verify((e, s) => r([e, s])));
      if (rep[0]) console.log("  FAIL AUTH " + user + " / " + masquer(pass) + " → " + (rep[0].message || "").split("\n")[0]);
      else { console.log("  OK AUTH " + user + " / " + masquer(pass) + " → 250 (VRAI accès !)"); break; }
    } catch (e) { console.log("  FAIL AUTH " + user + " / " + masquer(pass) + " → " + (e.message || "").split("\n")[0]); }
  }
}
main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(1); });
