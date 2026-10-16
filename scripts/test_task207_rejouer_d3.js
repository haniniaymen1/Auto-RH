// Task 207 — Reprise : rejoue la réponse manager de D3 (jamais traitée — le
// script de test a été tué par le sandbox pendant l'attente du poller) et
// diagnostique pourquoi le poller l'a marquée LUE sans décision.
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new (require("@prisma/client").PrismaClient)();
const { simpleParser } = require("mailparser");

async function main() {
  const ref = process.argv[2] || "DEM-2026-00048";
  const d = await db.demandeAdministrative.findUnique({ where: { reference: ref } });
  if (!d) { console.log("demande introuvable"); process.exit(1); }
  console.log("Demande " + ref + " : statut=" + d.statut + " decisionManager=" + (d.decisionManager || "-") + " destAttendu=" + (d.destinataire ? String(cryptoBd.dechiffrerChamp(d.destinataire)) : "?"));

  const sujet = "Re: AutoRH — " + (d.type === "CONGE" ? "Congé" : "Autorisation de sortie") + " " + ref + " (traitement requis)";
  const eml = [
    "Message-ID: <task207-mgr-reprise-" + Date.now() + "@gmail.com>",
    "Date: " + new Date().toUTCString(),
    "From: \"RH Test (Manager)\" <smtp.test@autorh.tn>",
    "To: <employe.test@autorh.tn>",
    "Subject: " + sujet,
    "In-Reply-To: " + (d.messageIdEnvoi || ""),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    "OK pour moi, à valider par les RH.",
    "",
  ].join("\r\n");
  const parsed = await simpleParser(Buffer.from(eml, "utf8"));
  const portail = require("./portail-server.js");
  const r = await portail.traiterMessageRecu(parsed);
  console.log("RÉSULTAT traiterMessageRecu:", JSON.stringify(r, null, 2));
  const d2 = await db.demandeAdministrative.findUnique({ where: { reference: ref } });
  console.log("APRÈS : statut=" + d2.statut + " decisionManager=" + (d2.decisionManager || "-") + " decisionRh=" + (d2.decisionRh || "-"));
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error("ERREUR:", e && e.stack || e); process.exit(1); });
