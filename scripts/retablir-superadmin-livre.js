#!/usr/bin/env node
"use strict";
/**
 * (v0.2.167) RÉTABLIT le compte superadmin@autorh.local dans la base
 * LIVRÉE : la ligne historique était devenue illisible (clé d'une ancienne
 * réparation perdue — Task 178). On réécrit email/nom avec la clé ACTUELLE
 * du .env en conservant le hachage scrypt du mot de passe (verifié : le mot
 * de passe AutoRH-2026!Verif#1 doit rester valable — sinon regénéré).
 * Purge aussi les ImportLog illisibles (lignes mortes historiques).
 * Idempotent. Utilisé uniquement pour préparer la base du ZIP complet.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const cryptoBd = require(__dirname + "/lib-crypto-bd.js");

const EMAIL = "superadmin@autorh.local";
const NOM = "Superadministrateur";
const MDP_ATTENDU = "AutoRH-2026!Verif#1";

function verifierScrypt(password, stocke) {
  try {
    const [scheme, salt, hash] = String(stocke || "").split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidat = crypto.scryptSync(password, salt, 64).toString("hex");
    const a = Buffer.from(candidat, "hex");
    const b = Buffer.from(hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

(async () => {
  const us = await db.user.findMany();
  const morts = [];
  let cible = null;
  for (const u of us) {
    try {
      const email = cryptoBd.dechiffrerChamp(u.email);
      if (String(email).toLowerCase() === EMAIL) { cible = u; continue; }
    } catch { morts.push(u); }
  }
  // La ligne SUPERADMIN illisible EST l'ancien superadmin (role SUPERADMIN).
  const ligneMorte = morts.find((u) => u.role === "SUPERADMIN") || null;

  if (cible) {
    console.log("Compte " + EMAIL + " déjà lisible — rien à faire (id " + cible.id + ").");
  } else if (ligneMorte) {
    let hash = ligneMorte.passwordHash;
    if (!verifierScrypt(MDP_ATTENDU, hash)) {
      const salt = crypto.randomBytes(16).toString("hex");
      hash = "scrypt:" + salt + ":" + crypto.scryptSync(MDP_ATTENDU, salt, 64).toString("hex");
      console.log("Hachage mot de passe régénéré (l'ancien ne correspondait plus).");
    } else {
      console.log("Hachage mot de passe CONSERVÉ (AutoRH-2026!Verif#1 vérifié).");
    }
    await db.user.update({
      where: { id: ligneMorte.id },
      data: {
        email: cryptoBd.chiffrerChamp(EMAIL, true),
        name: cryptoBd.chiffrerChamp(NOM, false),
        passwordHash: hash,
        isActive: true,
        role: "SUPERADMIN",
        passwordChangedAt: new Date(),
        passwordExpiresAt: null,
        activatedAt: new Date(),
      },
    });
    console.log("Compte " + EMAIL + " rétabli (id " + ligneMorte.id + ") — clé du .env actuel.");
  } else {
    console.log("Aucune ligne SUPERADMIN illisible trouvée — création d'un compte neuf.");
    const salt = crypto.randomBytes(16).toString("hex");
    await db.user.create({
      data: {
        email: cryptoBd.chiffrerChamp(EMAIL, true),
        name: cryptoBd.chiffrerChamp(NOM, false),
        passwordHash: "scrypt:" + salt + ":" + crypto.scryptSync(MDP_ATTENDU, salt, 64).toString("hex"),
        role: "SUPERADMIN",
        isActive: true,
        passwordChangedAt: new Date(),
        passwordExpiresAt: null,
        activatedAt: new Date(),
      },
    });
    console.log("Compte " + EMAIL + " créé.");
  }

  // Purge des ImportLog illisibles (lignes mortes, jamais affichables).
  const logs = await db.importLog.findMany();
  let purges = 0;
  for (const l of logs) {
    try { cryptoBd.dechiffrerChamp(l.message); } catch {
      await db.importLog.delete({ where: { id: l.id } });
      purges++;
    }
  }
  console.log("ImportLog illisibles purgés : " + purges + ".");

  // Contrôle final : le compte répond au login (email déterministe + scrypt).
  const recherche = await db.user.findUnique({
    where: { email: cryptoBd.chiffrerChamp(EMAIL, true) },
  });
  if (!recherche) { console.error("ÉCHEC du contrôle final."); process.exit(1); }
  if (!verifierScrypt(MDP_ATTENDU, recherche.passwordHash)) {
    console.error("ÉCHEC : mot de passe non vérifié après réparation."); process.exit(1);
  }
  console.log("CONTRÔLE FINAL OK : " + EMAIL + " / " + MDP_ATTENDU + " utilisable.");
  await db.$disconnect();
})().catch((e) => { console.error("ERREUR :", e && e.stack || e); process.exit(1); });
