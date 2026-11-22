/* Test E2E v0.2.131 — Case « Manager » + liste « Manager responsable » dans
 * la fenêtre « Mot de passe initial — CIN » (accès portail) :
 *  1. création de deux accès de test (RH → API, CIN uniques) ;
 *  2. désignation employé 1 comme Manager (action modifier-manager) ;
 *  3. GET : employé 1 isManager=true, présent dans la liste ;
 *  4. employé 2 : managerId = employé 1 (validé) ;
 *  5. refus : employé 2 comme responsable de lui-même (400) ;
 *  6. refus : responsable non-manager (400) ;
 *  7. décochage de l'employé 1 → subordonnés remis à « Aucun » + hors liste ;
 *  8. re-cochage employé 1 + affectation employé 2 → état final cohérent ;
 *  9. nettoyage complet (suppression des 2 accès de test).
 * Usage : node scripts/test_task248_manager_portail.js
 * Prérequis : session superadmin — créée/supprimée ici (email déterministe). */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const BASE = "http://127.0.0.1:4000";
const EMAIL = "diag131@test.local";
const MDP = "Diag-2026!131";
const CIN1 = "TEST1310001";
const CIN2 = "TEST1310002";
let ok = 0, ko = 0;
function verif(label, cond, detail) {
  if (cond) { ok++; console.log("  OK  " + label); }
  else { ko++; console.log("  KO  " + label + (detail ? " — " + JSON.stringify(detail).slice(0, 160) : "")); }
}
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
async function api(cookie, action, body) {
  const res = await fetch(`${BASE}/api/portal-access`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ action, ...body }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function main() {
  const p = new PrismaClient();
  // --- session de test ---
  const emailChiffre = bd.chiffrerChamp(EMAIL, true);
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  await p.user.create({ data: { email: emailChiffre, name: "Diag 131", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
  const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) });
  const cookies = login.headers.getSetCookie?.() || [];
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  verif("login session de test", login.status === 200 && Boolean(cookie));
  if (!cookie) process.exit(1);

  // --- 1. création des deux accès (la fenêtre « Mot de passe initial — CIN » s'ouvre sur ces réponses) ---
  const c1 = await api(cookie, "create", { cin: CIN1 });
  verif("create accès 1 (200 + initialPassword + access)", c1.status === 200 && Boolean(c1.data.initialPassword) && Boolean(c1.data.access?.id), c1.data);
  verif("create accès 1 : état Manager initial false/null", c1.data.access?.isManager === false && (c1.data.access?.managerId ?? null) === null);
  const c2 = await api(cookie, "create", { cin: CIN2 });
  verif("create accès 2 (200)", c2.status === 200 && Boolean(c2.data.access?.id), c2.data);
  const id1 = c1.data.access.id, id2 = c2.data.access.id;

  // --- 2. désignation employé 1 comme Manager (case cochée dans la fenêtre) ---
  const m1 = await api(cookie, "modifier-manager", { id: id1, isManager: true, managerId: null });
  verif("employé 1 coché Manager (200)", m1.status === 200 && m1.data.access?.isManager === true, m1.data);

  // --- 3. GET : l'employé 1 apparaît dans la liste des managers ---
  const g1 = await fetch(`${BASE}/api/portal-access`, { headers: { cookie } });
  const d1 = await g1.json();
  const l1 = (d1.items || []).find((i) => i.id === id1);
  verif("GET : employé 1 isManager=true", g1.status === 200 && l1?.isManager === true, l1);

  // --- 4. employé 2 : managerId = employé 1 ---
  const m2 = await api(cookie, "modifier-manager", { id: id2, isManager: false, managerId: id1 });
  verif("employé 2 : responsable = employé 1 (200)", m2.status === 200 && m2.data.access?.managerId === id1, m2.data);
  const g2 = await fetch(`${BASE}/api/portal-access`, { headers: { cookie } });
  const d2 = await g2.json();
  const l2 = (d2.items || []).find((i) => i.id === id2);
  verif("GET : managerNom de l'employé 2 résolu (nom affichable)", g2.status === 200 && typeof l2?.managerNom === "string" && l2.managerNom.length > 0, l2);

  // --- 5. refus : auto-référence ---
  const auto = await api(cookie, "modifier-manager", { id: id2, isManager: false, managerId: id2 });
  verif("refus auto-référence (400)", auto.status === 400, auto.data);

  // --- 6. refus : responsable non-manager (accès 2 n'est pas manager) ---
  const nonManager = await api(cookie, "modifier-manager", { id: id1, isManager: true, managerId: id2 });
  verif("refus responsable non coché Manager (400)", nonManager.status === 400, nonManager.data);

  // --- 7. décochage employé 1 → subordonné remis à Aucun ---
  const off = await api(cookie, "modifier-manager", { id: id1, isManager: false, managerId: null });
  verif("décochage employé 1 (200)", off.status === 200 && off.data.access?.isManager === false, off.data);
  const g3 = await fetch(`${BASE}/api/portal-access`, { headers: { cookie } });
  const d3 = await g3.json();
  const l2b = (d3.items || []).find((i) => i.id === id2);
  verif("subordonné remis à « Aucun » (managerId null)", l2b?.managerId === null, l2b);

  // --- 8. état final : re-cochage + affectation ---
  await api(cookie, "modifier-manager", { id: id1, isManager: true, managerId: null });
  const fin = await api(cookie, "modifier-manager", { id: id2, isManager: false, managerId: id1 });
  verif("état final : employé 2 rattaché à l'employé 1", fin.status === 200 && fin.data.access?.managerId === id1, fin.data);

  // --- 9. nettoyage ---
  const del1 = await api(cookie, "delete", { id: id1 });
  const del2 = await api(cookie, "delete", { id: id2 });
  verif("suppression des accès de test", del1.status === 200 && del2.status === 200);
  const reste = await p.portalAccess.count({ where: { OR: [{ cin: CIN1 }, { cin: CIN2 }] } });
  verif("base sans les accès de test", reste === 0, { reste });
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  console.log("Session de test supprimée.");
  await p.$disconnect();
  console.log(`\nRÉSULTAT : ${ok} OK / ${ko} KO`);
  process.exit(ko === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
