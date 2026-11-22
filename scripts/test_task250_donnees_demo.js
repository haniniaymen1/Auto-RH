/* Préparation données de démonstration pour la VÉRIFICATION NAVIGATEUR
 * Task 250 (bouton « Manager » — fenêtre dédiée sans réinitialisation).
 * Crée : 1 session RH de test + accès A « Marc Testa » (manager) +
 * accès B « Sonia Testb » (subordonnée). Affiche les identifiants.
 * Usage : node scripts/test_task250_donnees_demo.js */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const ADMIN = "http://127.0.0.1:4000";
const EMAIL = "diag250nav@test.local";
const MDP = "Diag-2026!250nav";
const CINA = "TEST250NAV01";
const CINB = "TEST250NAV02";
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
async function apiAdmin(cookie, action, body) {
  const res = await fetch(`${ADMIN}/api/portal-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function main() {
  const p = new PrismaClient();
  try {
    const emailChiffre = bd.chiffrerChamp(EMAIL, true);
    await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
    await p.user.create({ data: { email: emailChiffre, name: "Diag 250 Nav", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
    const login = await fetch(`${ADMIN}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) });
    const cookies = login.headers.getSetCookie?.() || [];
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("login impossible");
    // accès propres (noms définis pour des libellés lisibles)
    for (const [cin, prenom, nom] of [[CINA, "Marc", "Testa"], [CINB, "Sonia", "Testb"]]) {
      await p.portalAccess.deleteMany({ where: { cin: bd.chiffrerChamp(cin, true) } });
      const c = await apiAdmin(cookie, "create", { cin });
      if (c.status !== 200) throw new Error("create " + cin + " : " + JSON.stringify(c.data));
      await p.portalAccess.update({ where: { id: c.data.access.id }, data: { nom: nom, prenom: prenom } });
      console.log(`ACCÈS ${cin} → ${prenom} ${nom} (mdp initial ${c.data.initialPassword})`);
    }
    const items = await (await fetch(`${ADMIN}/api/portal-access`, { headers: { cookie } })).json();
    const a = (items.items || []).find((i) => i.cin === bd.chiffrerChamp(CINA, true) || (i.prenom === "Marc" && i.nom === "Testa"));
    const b = (items.items || []).find((i) => i.prenom === "Sonia" && i.nom === "Testb");
    // Marc est coché « Manager »
    const m = await apiAdmin(cookie, "modifier-manager", { id: a.id, isManager: true, managerId: null });
    if (m.status !== 200) throw new Error("cochage manager impossible");
    console.log("SESSION_EMAIL=" + EMAIL);
    console.log("SESSION_MDP=" + MDP);
    console.log("OK - données de démonstration prêtes");
  } finally {
    await p.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
