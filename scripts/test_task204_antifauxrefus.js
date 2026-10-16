#!/usr/bin/env node
/* Traite la réponse anti-faux-refus de DEM-2026-00019 par invocation directe
 * (le poller du déploiement réel vole les messages injectés — course connue).
 * Vérifie : « pas encore validée » → NON_RECONNU → statut inchangé + historique. */
process.chdir(__dirname + "/..");
const fs = require("fs");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");

const message = ({ sujet, de, inReplyTo, texte }) => ({
  subject: sujet,
  from: { value: [{ address: de, name: "RH Test" }] },
  inReplyTo,
  references: inReplyTo ? [inReplyTo] : undefined,
  text: texte,
  html: null,
  attachments: [],
});

(async () => {
  const ref = "DEM-2026-00019";
  const d = await portail.prisma.demandeAdministrative.findUnique({ where: { reference: ref } });
  const avant = d.statut;
  const r = await portail.traiterMessageRecu(message({
    sujet: "Re: AutoRH - Demande de conge " + ref + " (traitement requis)",
    de: "smtp.test@autorh.tn",
    inReplyTo: d.messageIdEnvoi,
    texte: "Votre demande n'est pas encore validée, j'attends le retour du service.",
  }));
  console.log("retour:", JSON.stringify(r, null, 1).slice(0, 400));
  const apres = await portail.prisma.demandeAdministrative.findUnique({ where: { reference: ref } });
  console.log("statut avant:", avant, "| après:", apres.statut, "| identique:", avant === apres.statut ? "OUI" : "NON");
  let hist = [];
  try { hist = JSON.parse(cryptoBd.dechiffrerChamp(apres.reponsesRecues) || "[]"); } catch (e) {}
  console.log("historique:", hist.length, "entrée(s)");
  for (const h of hist) console.log("   - rôle:", h.role, "| décision:", h.decision, "| texte:", String(h.texte || "").slice(0, 70));
  process.exit(avant === apres.statut && hist.length > 0 ? 0 : 1);
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
