#!/usr/bin/env node
/**
 * NOUVEAU (Task 34) : suppression d'un compte utilisateur par CLI.
 * Outil d'administration et de secours (équivalent au bouton « Supprimer »
 * de l'onglet Utilisateurs) — utile quand aucun superadministrateur n'est
 * disponible pour se connecter.
 *
 * Utilisation :
 *   node scripts/supprime-utilisateur.js --email a@b.tn             -> demande confirmation
 *   node scripts/supprime-utilisateur.js --email a@b.tn --forcer    -> sans confirmation
 *   node scripts/supprime-utilisateur.js --statut                   -> liste les comptes
 *
 * Garde-fou : refuse de supprimer le DERNIER superadministrateur actif
 * (identique à l'API). La porte de secours --forcer-dernier (à utiliser AVEC
 * --forcer) lève ce refus pour les scénarios de récupération — à manipuler
 * en connaissance de cause.
 */
"use strict";

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const ROOT = path.join(__dirname, "..");

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
    // pas de .env : environnement courant
  }
})();

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient({ log: ["error"] });
// NOUVEAU (Task 34 correctif) : les emails étant chiffrés DÉTERMINISTEMENT dans
// la base (Task 32), la recherche cible la valeur chiffrée PUIS la valeur claire
// (comptes historiques éventuels).
const cryptoBd = require(path.join(__dirname, "lib-crypto-bd.js"));

async function trouverParEmail(email) {
  const emailChiffre = cryptoBd.chiffrerChamp(String(email).toLowerCase(), true);
  return (
    (await prisma.user.findFirst({ where: { email: emailChiffre } })) ||
    (await prisma.user.findFirst({ where: { email: String(email).toLowerCase() } }))
  );
}

(async () => {
  const args = process.argv.slice(2);
  const argVal = (nom) => {
    const i = args.indexOf(nom);
    return i >= 0 ? args[i + 1] : undefined;
  };
  try {
    if (args.includes("--statut")) {
      const users = await prisma.user.findMany({
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        select: { email: true, role: true, isActive: true },
      });
      console.log("Comptes :");
      for (const u of users) {
        console.log(
          `  [${u.role.padEnd(10)}] ${String(u.email).padEnd(30)} ${u.isActive ? "actif" : "DESACTIVE"}`
        );
      }
      return;
    }

    const email = String(argVal("--email") || "").trim().toLowerCase();
    if (!email) {
      console.error("Usage : node scripts/supprime-utilisateur.js --email a@b.tn [--forcer]");
      process.exitCode = 1;
      return;
    }
    const user = await trouverParEmail(email);
    if (!user) {
      console.error(`Aucun compte avec l'email ${email}.`);
      process.exitCode = 1;
      return;
    }
    if (user.role === "SUPERADMIN" && user.isActive && !args.includes("--forcer-dernier")) {
      const nb = await prisma.user.count({ where: { role: "SUPERADMIN", isActive: true } });
      if (nb <= 1) {
        console.error(
          "Refus : c'est le DERNIER superadministrateur actif. Créez-en un autre d'abord (CREER-SUPERADMIN-WINDOWS.bat) ou ajoutez --forcer-dernier pour forcer (récupération)."
        );
        process.exitCode = 1;
        return;
      }
    }

    if (!args.includes("--forcer")) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const rep = await new Promise((r) =>
        rl.question(
          `Supprimer DÉFINITIVEMENT ${user.email} (${user.name}, ${user.role}) ? [oui/N] : `,
          (x) => {
            r(String(x || "").trim().toLowerCase());
          }
        )
      );
      rl.close();
      if (rep !== "oui" && rep !== "o" && rep !== "y" && rep !== "yes") {
        console.log("Abandon — aucune suppression.");
        return;
      }
    }

    await prisma.user.delete({ where: { id: user.id } });
    console.log(`Compte supprimé : ${email} (${user.name}, ${user.role}).`);
  } catch (e) {
    console.error(`Erreur : ${e && e.message ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
