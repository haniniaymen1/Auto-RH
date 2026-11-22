#!/usr/bin/env node
/**
 * Task 79 — SONDE : recalcule sur une COPIE de la base réelle le nombre de
 * CIN DISTINCTS (même normalisation que /api/stats Task 79) pour annoncer
 * les chiffres exacts que le tableau de bord va afficher.
 * Usage : DATABASE_URL=file:<copie> node scripts/sonde79_cin_reels.js
 */
"use strict";
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({ log: ["error"] });

function normaliser(cin) {
  return String(cin || "").trim().toUpperCase().replace(/[\s./\-]/g, "");
}

(async () => {
  const total = await prisma.payslip.count();
  const avecCin = await prisma.payslip.count({ where: { cin: { not: null } } });
  const lignes = await prisma.payslip.findMany({ where: { cin: { not: null } }, select: { cin: true } });
  const distincts = new Set();
  for (const l of lignes) {
    const cle = normaliser(l.cin);
    if (cle) distincts.add(cle);
  }
  console.log(JSON.stringify({
    fichesTotal: total,
    fichesAvecCin: avecCin,
    cinsDistincts: distincts.size,
    fichesSansCin: total - avecCin,
  }));
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
