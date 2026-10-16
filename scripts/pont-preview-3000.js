#!/usr/bin/env node
/**
 * ============================================================
 *  AutoRH — PONT D'APERÇU (port 3000 -> administration 4000)
 * ============================================================
 *  (NOUVEAU — suite v0.2.109, demande « où est le zip / la route
 *  publique n'existe pas »)
 *
 *  CONSTAT : la plateforme d'hébergement expose l'application via
 *  un proxy d'APERÇU (Caddy, port 81) qui redirige vers le port
 *  3000 — le port standard des applications de cette plateforme.
 *  AutoRH, lui, écoute par convention sur 4000 (administration)
 *  et 4001 (portail employés). Après une restauration
 *  d'environnement, plus rien n'écoutait sur 3000 : l'aperçu
 *  répondait 502 « Bad Gateway » et l'utilisateur ne voyait NI
 *  l'application NI les routes publiques de téléchargement
 *  (/api/download-scripts, /api/download-readme, ...).
 *
 *  RÔLE DE CE PONT : un relais HTTP minimaliste, SANS état et SANS
 *  journalisation de contenu, qui recopie octet pour octet les
 *  requêtes entrantes sur 3000 vers l'administration (4000) et
 *  renvoie les réponses à l'identique (y compris les téléchargements).
 *  - Aucun identifiant technique de AutoRH n'est modifié :
 *    l'administration reste sur 4000, le portail sur 4001 ;
 *    le pont est un simple aiguillage réseau au-dessus du service.
 *  - Si l'administration est arrêtée, le pont répond 502 avec un
 *    message explicite en français (mieux que la page Caddy brute).
 *  - Démarré et surveillé par scripts/auto-rh.js
 *    (fonction assurerPont), PID enregistré dans
 *    logs/auto-rh-processus.json ; journal : logs/auto-rh-pont.log
 *
 *  Variables d'environnement (toutes facultatives) :
 *    AUTO_RH_PORT_PONT   port d'écoute du pont (défaut 3000)
 *    AUTO_RH_PORT_ADMIN  port cible (défaut 4000)
 *    AUTO_RH_PONT_CIBLE_HOST  hôte cible (défaut 127.0.0.1)
 * ============================================================
 */
"use strict";

const http = require("http");

const PORT_PONT = Number(process.env.AUTO_RH_PORT_PONT || 3000);
const PORT_CIBLE = Number(process.env.AUTO_RH_PORT_ADMIN || 4000);
const HOTE_CIBLE = process.env.AUTO_RH_PONT_CIBLE_HOST || "127.0.0.1";

const serveur = http.createServer((req, res) => {
  // Recopie la requête telle quelle vers l'administration (flux, sans
  // mise en mémoire : les imports de fiches peuvent faire des centaines
  // de Mo et ne doivent jamais gonfler la RAM du pont).
  const enTetes = Object.assign({}, req.headers);
  const prox = http.request(
    {
      host: HOTE_CIBLE,
      port: PORT_CIBLE,
      path: req.url,
      method: req.method,
      headers: enTetes,
    },
    (rep) => {
      res.writeHead(rep.statusCode || 502, rep.headers);
      rep.pipe(res);
    }
  );
  prox.on("error", (e) => {
    try {
      if (!res.headersSent) {
        res.writeHead(502, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
      }
      res.end(
        "AutoRH : l'administration (port " + PORT_CIBLE +
        ") ne repond pas actuellement. " +
        "Relancez le service : node scripts/auto-rh.js start. " +
        "Detail technique : " + (e && e.message ? e.message : "erreur reseau")
      );
    } catch (_) { /* socket deja fermee */ }
  });
  req.pipe(prox);
});

// Next.js (administration) n'utilise pas de WebSocket ici : on referme
// proprement toute tentative d'upgrade au lieu de la laisser pendre.
serveur.on("upgrade", (_req, socket) => {
  try { socket.destroy(); } catch (_) { /* deja fermee */ }
});

// Client qui part brutalement (fermeture d'onglet, timeout proxy) :
// ne JAMAIS laisser l'exception remonter et tuer le pont.
serveur.on("clientError", (_err, socket) => {
  try { socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); } catch (_) { /* ignore */ }
});

serveur.on("error", (e) => {
  // Port deja pris (pont deja lance, ou autre application) : on quitte
  // silencieusement — le moteur de service saura que 3000 repond.
  console.error("[pont-apercu] impossible d'ecouter sur " + PORT_PONT + " : " +
    (e && e.code ? e.code : e && e.message ? e.message : "erreur"));
  process.exit(0);
});

serveur.listen(PORT_PONT, "0.0.0.0", () => {
  console.log("[pont-apercu] ecoute sur 0.0.0.0:" + PORT_PONT +
    " -> " + HOTE_CIBLE + ":" + PORT_CIBLE + " (administration)");
});
