#!/usr/bin/env node
/**
 * Task 81 — INSPECTION READ-ONLY de la base RÉELLE (aucune écriture).
 * Reconstitue l'état des accès portail : dates, échecs, verrou, QR, scellement.
 */
"use strict";
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
const prisma = new PrismaClient({ log: ["error"] });

(async () => {
  const rows = await prisma.portalAccess.findMany({
    select: {
      id: true, cin: true, isActive: true, passwordHash: true,
      mustChangePassword: true, passwordChangedAt: true,
      lastLoginAt: true, qrPresente: true, failedAttempts: true,
      lockedUntil: true, createdAt: true,
      totpSecret: true, lastUsedWindow: true,
    },
  });
  console.log("TOTAL PortalAccess:", rows.length);
  for (const r of rows) {
    const cin = (() => {
      try { return cryptoBd.dechiffrerChamp(r.cin); } catch { return "<ILLISIBLE>"; }
    })();
    const mdp = r.passwordHash ? (String(r.passwordHash).startsWith("encbd1:") ? "présent(chiffré)" : "présent(clair?)") : "ABSENT";
    const secret = r.totpSecret ? (String(r.totpSecret).startsWith("encbd1:") ? "chiffré" : "clair") : "absent";
    console.log(JSON.stringify({
      cin, isActive: r.isActive, mdp, mustChange: r.mustChangePassword,
      passwordChangedAt: r.passwordChangedAt, lastLoginAt: r.lastLoginAt,
      qrPresente: r.qrPresente, failedAttempts: r.failedAttempts,
      lockedUntil: r.lockedUntil, createdAt: r.createdAt, updatedAt: r.updatedAt,
      totpSecret: secret, lastUsedWindow: r.lastUsedWindow,
    }, null, 0));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
