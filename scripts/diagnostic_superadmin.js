#!/usr/bin/env node
/**
 * Diagnostic de connexion du superadministrateur (échec « email ou mot de
 * passe incorrect » rapporté par l'utilisateur). LECTURE SEULE :
 *  - liste les comptes User (email, rôle, actif, passwordChangedAt) ;
 *  - teste les deux mots de passe candidats connus contre le hash stocké ;
 *  - indique si la politique 15 jours rend le changement obligatoire.
 * Aucune modification de la base.
 */
"use strict";
const path = require("path");
const fs = require("fs");

// Chargement du .env (DATABASE_URL)
(function () {
  const envPath = path.join(__dirname, "..", ".env");
  try {
    for (const ligne of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch (e) { /* pas de .env : tant pis */ }
})();

const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient({ log: ["error"] });
const crypto = require("crypto");
// Jumelle JS du chiffrement de la base (User.email est chiffré déterministe).
const cryptoBd = require(path.join(__dirname, "lib-crypto-bd.js"));

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch { return false; }
}

const CANDIDATS = ["AutoRH-2026!Verif#1", "AutoRH-2026!Verif"];

(async () => {
  const users = await db.user.findMany();
  console.log("Comptes User en base :", users.length);
  for (const u of users) {
    let emailLisible = u.email;
    try { emailLisible = cryptoBd.dechiffrerChamp(u.email) || u.email; } catch (e) { /* brut */ }
    const expire = !u.passwordChangedAt ||
      (Date.now() - new Date(u.passwordChangedAt).getTime() >= 15 * 24 * 3600 * 1000);
    console.log("- email:", emailLisible,
      "| role:", u.role,
      "| actif:", u.isActive,
      "| passwordChangedAt:", u.passwordChangedAt ? new Date(u.passwordChangedAt).toISOString() : "null",
      "| expired(15j):", expire);
    for (const c of CANDIDATS) {
      console.log("    mot de passe candidat «", c, "»:", verifyPassword(c, u.passwordHash) ? "VALIDE ✔" : "invalide ✘");
    }
  }
})().catch((e) => { console.error("ERREUR:", e.message); process.exitCode = 1; })
  .finally(() => db.$disconnect());
