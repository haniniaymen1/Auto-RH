#!/usr/bin/env node
/* ============================================================================
 * SONDE DE CONNECTIVITÉ SERVEURS E-MAIL (sans identifiants)
 * Vérifie : port ouvert, poignée de main TLS, bannière du serveur.
 * Usage : node scripts/sonde_connectivite_email.js
 * ==========================================================================*/
const tls = require("tls");
const net = require("net");

const CIBLES = [
  { nom: "Gmail SMTP SSL", host: "smtp.gmail.com", port: 465, tls: true },
  { nom: "Gmail SMTP STARTTLS", host: "smtp.gmail.com", port: 587, tls: false },
  { nom: "Gmail IMAP SSL", host: "imap.gmail.com", port: 993, tls: true },
  { nom: "Zoho SMTP SSL", host: "smtp.zoho.com", port: 465, tls: true },
  { nom: "Zoho IMAP SSL", host: "imap.zoho.com", port: 993, tls: true },
];

const DELAI = 12000;

function sonde(cible) {
  return new Promise((resolve) => {
    let fini = false;
    const finir = (resultat) => {
      if (fini) return;
      fini = true;
      try { socket.destroy(); } catch (_) {}
      resolve(resultat);
    };
    const socket = cible.tls
      ? tls.connect({ host: cible.host, port: cible.port, rejectUnauthorized: false })
      : net.connect({ host: cible.host, port: cible.port });
    socket.setTimeout(DELAI);
    socket.on("connect", () => {
      // Pour 587 : la bannière arrive en clair puis STARTTLS est proposé via EHLO
      // (on se contente ici de prouver que le port répond).
    });
    socket.on("secureConnect", () => {
      finir({ ok: true, detail: "TLS OK — TLSv" + (socket.getProtocol ? socket.getProtocol() : "?") });
    });
    socket.on("data", (d) => {
      const banniere = d.toString().split("\r\n")[0].slice(0, 80);
      if (!cible.tls) finir({ ok: true, detail: "bannière : " + banniere });
    });
    socket.on("timeout", () => finir({ ok: false, detail: "DÉLAI DÉPASSÉ (port filtré ?)" }));
    socket.on("error", (e) => finir({ ok: false, detail: e.message }));
  });
}

(async () => {
  console.log("=== SONDE CONNECTIVITÉ — " + new Date().toLocaleString("fr-FR") + " ===");
  for (const c of CIBLES) {
    const r = await sonde(c);
    console.log((r.ok ? "JOIGNABLE" : "ÉCHEC   ") + "  " + c.nom + "  " + c.host + ":" + c.port + "  → " + r.detail);
  }
  console.log("=== FIN ===");
  process.exit(0);
})();
