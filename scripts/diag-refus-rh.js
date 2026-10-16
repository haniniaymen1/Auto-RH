#!/usr/bin/env node
/* DIAGNOSTIC : reproduction du refus RH sur demande EN_ATTENTE (cas 17304)
 * — capture INTÉGRALE de la sortie console (erreurs Prisma/nodemailer…). */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
// Tee console vers /tmp/diag-refus-rh.log
const TEE = fs.createWriteStream("/tmp/diag-refus-rh.log", { flags: "w" });
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);
function tee(str, ch) {
  TEE.write(str);
  (ch === "e" ? origErr : origOut)(str);
}
process.stdout.write = (s) => { tee(String(s), "o"); return true; };
process.stderr.write = (s) => { tee(String(s), "e"); return true; };

const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const nodemailer = require("nodemailer");
const portail = require("./portail-server.js");

const GMAIL = { user: "employe.test@autorh.tn", pass: "xxxx xxxx xxxx xxxx" };
const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };
const REF = "DEM-2026-17305";

async function main() {
  await db.demandeAdministrative.deleteMany({ where: { reference: REF } });
  const donnees = { nom: "Employé Diagnostic", date: "2027-06-02", departement: "IT", motif: "Démarche administrative", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" };
  const d = await db.demandeAdministrative.create({
    data: {
      reference: REF, type: "AUTORISATION_SORTIE", statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp("TS173DIAG175", true),
      destinataire: cryptoBd.chiffrerChamp(ZOHO.user),
      employeEmail: cryptoBd.chiffrerChamp(ZOHO.user),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(donnees)),
      messageIdEnvoi: "diag-refus-rh-" + Date.now() + "@auto-rh.test",
    },
  });
  console.log("[DIAG] Demande " + REF + " créée EN_ATTENTE — messageIdEnvoi=" + d.messageIdEnvoi);

  const poller = setInterval(() => { portail.verifierBoiteDemandes().catch((e) => { console.log("[DIAG] ERREUR POLLER (attrapée silencieusement en prod) : " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join(" | ") : e)); }); }, 10 * 1000);

  await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL.user, pass: GMAIL.pass }, tls: { rejectUnauthorized: false } }).sendMail({
    from: GMAIL.user, to: GMAIL.user,
    subject: "RE: AutoRH — Autorisation de sortie " + REF + " (traitement requis)",
    text: "Refusée",
    inReplyTo: "<" + d.messageIdEnvoi + ">", references: "<" + d.messageIdEnvoi + ">",
  });
  console.log("[DIAG] [" + new Date().toISOString().slice(11, 19) + "] Réponse RH « Refusée » envoyée (Gmail→Gmail)");

  // Attente : statut REFUSEE + 15 s de marge pour l'envoi de la notification
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const cur = await db.demandeAdministrative.findFirst({ where: { reference: REF } });
    if (cur && cur.statut === "REFUSEE" && i * 4 > 8) {
      console.log("[DIAG] statut=" + cur.statut + " refuseePar=" + cur.refuseePar + " decisionRh=" + cur.decisionRh);
      console.log("[DIAG] +15 s de marge pour la notification…");
      await new Promise((r) => setTimeout(r, 15000));
      break;
    }
    console.log("[DIAG] attente… " + i);
  }
  clearInterval(poller);

  const fin = await db.demandeAdministrative.findFirst({ where: { reference: REF } });
  console.log("[DIAG] ÉTAT FINAL : statut=" + fin.statut + " refuseePar=" + fin.refuseePar + " decisionRh=" + fin.decisionRh);
  console.log("[DIAG] docRefusChemin=" + fin.docRefusChemin + " docRefusNom=" + fin.docRefusNom + " docRefusEnvoiLe=" + fin.docRefusEnvoiLe + " docRefusErreur=" + fin.docRefusErreur);
  // Historique des réponses
  try {
    const hist = JSON.parse(cryptoBd.dechiffrerChamp(fin.reponsesRecues) || "[]");
    for (const e of hist) console.log("[DIAG] HIST le=" + e.le + " role=" + e.role + " decision=" + e.decision + " statutAvant=" + e.statutAvant + " statutApres=" + e.statutApres);
  } catch (e) { console.log("[DIAG] hist illisible: " + e.message.slice(0, 60)); }
  await db.demandeAdministrative.deleteMany({ where: { reference: REF } });
  console.log("[DIAG] demande de diagnostic supprimée.");
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.log("[DIAG] ERREUR FATALE : " + (e && e.stack || e)); process.exit(1); });
