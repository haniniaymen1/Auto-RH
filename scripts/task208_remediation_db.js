#!/usr/bin/env node
// ============================================================================
// Task 208 — Remédiation DB : fin de rotation des clés
//  1) SignatureConfig.certMotDePasse : déchiffré (ANCIENNE) → re-chiffré (NOUVELLE)
//  2) ImportLog : suppression des 6 lignes à clé perdue (journaux de test)
//  3) User superadmin à clé perdue : suppression (recréé ensuite par l'outil
//     officiel creer-superadmin.js, qui chiffre avec la NOUVELLE clé)
// Sauvegarde préalable automatique du fichier de base.
// ============================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const ROOT = path.join(__dirname, "..");
const db = new PrismaClient();
const ANCIENNE = "autorh-storage-local-a-changer-dans-env";

// — déchiffrement avec l'ANCIENNE matière (jumelle locale, sels identiques) —
const SELS = { alea: "autorh-db-aleatoire-v1", det: "autorh-db-deterministe-v1" };
function dechiffrerAvec(valeur, materiel, det) {
  const parties = String(valeur).split(":");
  const iv = Buffer.from(parties[1], "base64");
  const tag = Buffer.from(parties[2], "base64");
  const donnees = Buffer.from(parties.slice(3).join(":"), "base64");
  const cle = crypto.scryptSync(materiel, det ? SELS.det : SELS.alea, 32);
  const d = crypto.createDecipheriv("aes-256-gcm", cle, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(donnees), d.final()]).toString("utf8");
}

async function main() {
  // Sauvegarde préalable
  const dbPath = path.join(ROOT, "db", "custom.db");
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const bak = dbPath + ".avant-remediation-" + ts;
  fs.copyFileSync(dbPath, bak);
  console.log("Sauvegarde : " + path.basename(bak));

  // 1) certMotDePasse de SignatureConfig
  const cfg = await db.signatureConfig.findFirst();
  if (cfg && cfg.certMotDePasse && String(cfg.certMotDePasse).startsWith("encbd1")) {
    let clair = null;
    try {
      clair = dechiffrerAvec(cfg.certMotDePasse, ANCIENNE, false);
      console.log("certMotDePasse : déchiffré avec l'ANCIENNE matière (" + clair.length + " car.)");
    } catch (e) {
      console.log("certMotDePasse : ILLISIBLE même avec l'ANCIENNE — sera effacé");
    }
    const data = { certMotDePasse: clair === null ? "" : cryptoBd.chiffrerChamp(clair, false) };
    await db.signatureConfig.update({ where: { id: cfg.id }, data });
    console.log("certMotDePasse : re-chiffré avec la NOUVELLE clé ✔");
  } else {
    console.log("certMotDePasse : rien à faire");
  }

  // 2) ImportLog à clé perdue → suppression (journaux historiques sans valeur)
  const logs = await db.importLog.findMany();
  let supLogs = 0;
  for (const l of logs) {
    const perdu =
      (l.cinDetected && String(l.cinDetected).startsWith("encbd1")) ||
      (l.fileName && String(l.fileName).startsWith("encbd1")) ||
      (l.message && String(l.message).startsWith("encbd1"));
    // si au moins un champ est chiffré, tenter l'ANCIENNE : si échec → ligne perdue
    if (perdu) {
      let lisible = true;
      try {
        for (const c of ["cinDetected", "fileName", "message"]) {
          if (l[c] && String(l[c]).startsWith("encbd1")) dechiffrerAvec(l[c], ANCIENNE, false);
        }
      } catch { lisible = false; }
      if (!lisible) { await db.importLog.delete({ where: { id: l.id } }); supLogs++; }
      else {
        await db.importLog.update({
          where: { id: l.id },
          data: {
            cinDetected: l.cinDetected ? cryptoBd.chiffrerChamp(dechiffrerAvec(l.cinDetected, ANCIENNE, false), false) : l.cinDetected,
            fileName: l.fileName ? cryptoBd.chiffrerChamp(dechiffrerAvec(l.fileName, ANCIENNE, false), false) : l.fileName,
            message: l.message ? cryptoBd.chiffrerChamp(dechiffrerAvec(l.message, ANCIENNE, false), false) : l.message,
          },
        });
      }
    }
  }
  console.log("ImportLog : " + supLogs + " ligne(s) à clé perdue supprimée(s)");

  // 3) User à clé perdue → suppression (superadmin recréé après via l'outil officiel)
  const users = await db.user.findMany();
  let supUsers = 0;
  for (const u of users) {
    let lisible = true;
    try {
      if (u.email && String(u.email).startsWith("encbd1")) dechiffrerAvec(u.email, ANCIENNE, true);
      if (u.name && String(u.name).startsWith("encbd1")) dechiffrerAvec(u.name, ANCIENNE, false);
    } catch { lisible = false; }
    if (!lisible) { await db.user.delete({ where: { id: u.id } }); supUsers++; console.log("User à clé perdue supprimé : id=" + u.id); }
  }
  console.log("Users à clé perdue supprimés : " + supUsers);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
