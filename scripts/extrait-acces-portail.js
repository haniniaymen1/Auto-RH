#!/usr/bin/env node
/**
 * NOUVEAU (Task 33) : helper de TEST — extrait UN accès portail actif de la
 * base (CIN + secret TOTP déchiffrés) pour les tests E2E « Se souvenir de moi ».
 * Lecture seule : AUCUNE modification de la base.
 * Sortie : une ligne JSON { cin, secret } sur stdout (ou {"cin":null} si aucun).
 */
"use strict";

const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");

// Chargement du .env de la racine (sans écraser l'existant) — comme portail-server.js
(function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  try {
    const contenu = fs.readFileSync(envPath, "utf8");
    for (const ligne of contenu.split(/\r?\n/)) {
      const m = ligne.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  } catch {
    // pas de .env : on continue avec l'environnement courant
  }
})();

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require(path.join(ROOT, "scripts", "lib-crypto-bd.js"));

(async () => {
  const prisma = new PrismaClient({ log: ["error"] });
  try {
    const acc = await prisma.portalAccess.findFirst({
      where: { isActive: true },
      orderBy: { id: "asc" },
    });
    if (!acc) {
      console.log(JSON.stringify({ cin: null }));
      return;
    }
    const cin = cryptoBd.dechiffrerChamp(acc.cin);
    const secret = cryptoBd.dechiffrerChamp(acc.totpSecret);
    console.log(JSON.stringify({ cin, secret }));
  } catch (e) {
    console.log(JSON.stringify({ cin: null, erreur: String(e && e.message) }));
  } finally {
    await prisma.$disconnect();
  }
})();
