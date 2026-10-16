#!/usr/bin/env node
/** Test de candidats de mot de passe contre le hash scrypt du superadmin
 *  (diagnostic Task 178 — lecture seule, aucune modification). */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const CANDIDATS = [
  "AutoRH-2026!Verif#1",
  "AutoRH-2026!Verif",
  "Auto-RH-2026!Verif#1",
  "Auto-RH-2026!Verif",
  "AutoRH-2026!",
  "Auto-RH-2026!",
  "Auto-RH2026!",
  "Auto-RH@2026!",
  "AutoRH-2026",
  "Auto-RH@2026",
  "auto-rh2026",
  "Verif-2026!Auto-RH",
  "AutoRH-2026!Verif#2",
  "AutoRH-2026!Verif!1",
  "Admin-2026!Auto-RH",
  "Superadmin-2026!",
  "AutoRH-2026#Verif",
];

function verifier(hashStocke, password) {
  const [scheme, salt, hash] = String(hashStocke).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const cand = crypto.scryptSync(password, salt, 64);
  const attendu = Buffer.from(hash, "hex");
  return cand.length === attendu.length && crypto.timingSafeEqual(cand, attendu);
}

db.user.findMany().then(async (users) => {
  for (const u of users) {
    console.log("Compte:", u.email.startsWith("encb") ? "(e-mail chiffré)" : u.email, "rôle:", u.role);
    for (const c of CANDIDATS) {
      if (verifier(u.passwordHash, c)) console.log("  >>> CORRESPONDANCE :", c);
    }
  }
  console.log("Test terminé.");
  await db.$disconnect();
});
