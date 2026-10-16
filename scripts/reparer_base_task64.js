#!/usr/bin/env node
/**
 * Task 64 — RÉPARATION de la base de développement (base de démo uniquement).
 *
 * Contexte : les champs chiffrés (emails, noms, fiches) ont été chiffrés avec
 * une ANCIENNE AUTO_RH_STORAGE_KEY — le .env actuel ne peut plus les lire
 * (constat : login 401 sur le site réel, fiches illisibles côté portail).
 * État préexistant à la Task 64, indépendant de ses modifications.
 *
 * Actions (la base est sauvegardée AVANT par le shell appelant) :
 *  1. comptes User : ré-encodage email/name avec la clé ACTUELLE, hash scrypt
 *     conservé (vérification demo1234), passwordChangedAt = NOW ;
 *  2. fiches Payslip illisibles : SUPPRESSION des lignes (les PDF chiffrés
 *     orphelins restent sur disque — non-suppressif).
 * Le contenu de démonstration est ensuite ré-importé via l'API (specimens).
 */
"use strict";
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");

const prisma = new PrismaClient({ log: ["error"] });

function hacher(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return "scrypt:" + salt + ":" + hash;
}

function verifier(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

(async () => {
  // ---- 1) Comptes ----
  const users = await prisma.user.findMany();
  const cibles = [
    { role: "IT", email: "it@demo.tn", name: "Utilisateur Informatique (démo)" },
    { role: "RH", email: "rh@demo.tn", name: "Utilisateur RH (démo)" },
  ];
  for (const u of users) {
    const c = cibles.find((x) => x.role === u.role);
    if (!c) continue;
    const motDePasseDemo = verifier("demo1234", u.passwordHash);
    await prisma.user.update({
      where: { id: u.id },
      data: {
        email: cryptoBd.chiffrerChamp(c.email, true),
        name: cryptoBd.chiffrerChamp(c.name),
        // Hash conservé s'il correspond à demo1234, sinon ré-haché (démo)
        passwordHash: motDePasseDemo ? u.passwordHash : hacher("demo1234"),
        passwordChangedAt: new Date(), // (Task 64) repart pour 15 jours pleins
        isActive: true,
      },
    });
    console.log(`Compte ${c.role} réparé : ${c.email} (demo1234 : ${motDePasseDemo ? "hash conservé" : "ré-haché"}).`);
  }

  // ---- 2) Fiches illisibles -> suppression des lignes ----
  const fiches = await prisma.payslip.findMany({ select: { id: true, cin: true } });
  let illisibles = 0;
  for (const f of fiches) {
    let ok = true;
    try {
      cryptoBd.dechiffrerChamp(f.cin || "");
    } catch {
      ok = false;
    }
    if (!ok) illisibles++;
  }
  if (illisibles > 0) {
    // Toutes les lignes de la base proviennent de la même époque de chiffrement :
    // une seule clé était utilisée. On supprime les lignes illisibles.
    await prisma.payslip.deleteMany({});
    console.log(`Fiches supprimées (illisibles avec la clé actuelle) : ${fiches.length}/${fiches.length} (dont ${illisibles} confirmées illisibles).`);
  } else {
    console.log("Fiches toutes lisibles : aucune suppression.");
  }

  await prisma.$disconnect();
  console.log("RÉPARATION TERMINÉE.");
})().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
