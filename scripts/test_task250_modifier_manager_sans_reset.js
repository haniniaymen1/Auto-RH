/* Test E2E v0.2.133 — MODIFIER LE MANAGER D'UN EMPLOYÉ SANS RÉINITIALISER
 * SON MOT DE PASSE (bouton « Manager » du tableau Accès portail → fenêtre
 * dédiée → action serveur « modifier-manager ») :
 *  1. session RH de test + création de 2 accès (A manager, B subordonné) ;
 *  2. B CHOISIT SON PROPRE MOT DE PASSE (portail /api/premiere) ;
 *  3. modification du manager de B → action « modifier-manager » ;
 *  4. PREUVE « sans réinitialisation » :
 *     - la réponse ne contient AUCUN initialPassword ;
 *     - mustChangePassword reste FALSE (un reset le repasse à true) ;
 *     - passwordChangedAt INCHANGÉ (un reset le repasse à null) ;
 *     - hasPassword reste true ;
 *     - B SE CONNECTE ENCORE avec son propre mot de passe (200 portail) ;
 *     - un mauvais mot de passe échoue toujours (401) ;
 *  5. non-régressions : auto-référence 400, responsable inconnu 400,
 *     décochage du manager → subordonné remis à « Aucun » ;
 *  6. nettoyage intégral (accès + session de test).
 * Usage : node scripts/test_task250_modifier_manager_sans_reset.js */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const ADMIN = "http://127.0.0.1:4000";
const PORTAIL = "http://127.0.0.1:4001";
const EMAIL = "diag250@test.local";
const MDP = "Diag-2026!250";
const CINA = "TEST2500001";
const CINB = "TEST2500002";
const MDP_PROPRE_B = "Mot-Propre-B!250";
let ok = 0, ko = 0;
function verif(label, cond, detail) {
  if (cond) { ok++; console.log("  OK  " + label); }
  else { ko++; console.log("  KO  " + label + (detail ? " — " + JSON.stringify(detail).slice(0, 200) : "")); }
}
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
async function getAcces(cookie) {
  const res = await fetch(`${ADMIN}/api/portal-access`, { headers: { cookie } });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function main() {
  const p = new PrismaClient();
  try {
    // --- session de test ---
    const emailChiffre = bd.chiffrerChamp(EMAIL, true);
    await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
    await p.user.create({ data: { email: emailChiffre, name: "Diag 250", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
    const login = await fetch(`${ADMIN}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) });
    const cookies = login.headers.getSetCookie?.() || [];
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    verif("login session de test", login.status === 200 && Boolean(cookie));
    if (!cookie) process.exit(1);

    // --- 1. accès A (futur manager) + B (subordonné) ---
    const cinAChiffre = bd.chiffrerChamp(CINA, true);
    const cinBChiffre = bd.chiffrerChamp(CINB, true);
    await p.portalAccess.deleteMany({ where: { OR: [{ cin: cinAChiffre }, { cin: cinBChiffre }] } });
    const cA = await apiAdmin(cookie, "create", { cin: CINA });
    verif("create accès A (200 + initialPassword)", cA.status === 200 && Boolean(cA.data.initialPassword) && Boolean(cA.data.access?.id), cA.data);
    const cB = await apiAdmin(cookie, "create", { cin: CINB });
    verif("create accès B (200)", cB.status === 200 && Boolean(cB.data.access?.id), cB.data);
    const idA = cA.data.access.id, idB = cB.data.access.id;

    // A est coché « Manager »
    const mA = await apiAdmin(cookie, "modifier-manager", { id: idA, isManager: true, managerId: null });
    verif("A coché Manager (200)", mA.status === 200 && mA.data.access?.isManager === true, mA.data);

    // --- 2. B choisit SON PROPRE mot de passe (portail) ---
    const prem = await fetch(`${PORTAIL}/api/premiere`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cin: CINB, password: cB.data.initialPassword, newPassword: MDP_PROPRE_B, confirm: MDP_PROPRE_B }),
    });
    const premData = await prem.json().catch(() => ({}));
    verif("B : changement du mot de passe initial vers SON mot de passe (portail 200)", prem.status === 200, premData);
    const g0 = await getAcces(cookie);
    const b0 = (g0.data.items || []).find((i) => i.id === idB);
    verif("B : mustChangePassword=false après son choix", b0?.mustChangePassword === false, b0);
    verif("B : passwordChangedAt posé (non null)", Boolean(b0?.passwordChangedAt), b0?.passwordChangedAt);

    // --- 3. MODIFICATION DU MANAGER DE B (la fenêtre dédiée appelle exactement ceci) ---
    const mB = await apiAdmin(cookie, "modifier-manager", { id: idB, isManager: false, managerId: idA });
    verif("B : manager responsable = A (200)", mB.status === 200 && mB.data.access?.managerId === idA, mB.data);

    // --- 4. PREUVES « SANS RÉINITIALISATION » ---
    verif("PREUVE 1 : réponse SANS initialPassword (aucun nouveau mot de passe)", mB.data.initialPassword === undefined, Object.keys(mB.data));
    const g1 = await getAcces(cookie);
    const b1 = (g1.data.items || []).find((i) => i.id === idB);
    verif("PREUVE 2 : mustChangePassword reste FALSE", b1?.mustChangePassword === false, b1);
    verif("PREUVE 3 : passwordChangedAt INCHANGÉ", b1?.passwordChangedAt === b0?.passwordChangedAt, { avant: b0?.passwordChangedAt, apres: b1?.passwordChangedAt });
    verif("PREUVE 4 : hasPassword reste true", b1?.hasPassword === true, b1);
    verif("B : managerNom résolu dans la liste", typeof b1?.managerNom === "string" && b1.managerNom.length > 0, b1?.managerNom);
    // B se connecte ENCORE avec son propre mot de passe
    const verifOk = await fetch(`${PORTAIL}/api/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cin: CINB, password: MDP_PROPRE_B }) });
    verif("PREUVE 5 : B SE CONNECTE ENCORE avec son mot de passe (200, défi OTP attendu)", verifOk.status === 200, verifOk.status);
    const verifKo = await fetch(`${PORTAIL}/api/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cin: CINB, password: "Faux-Mot-De-Passe!999" }) });
    verif("CONTRÔLE : mauvais mot de passe toujours refusé (401)", verifKo.status === 401, verifKo.status);
    // revalidation du bon mot de passe (remet le compteur d'échecs à zéro)
    await fetch(`${PORTAIL}/api/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cin: CINB, password: MDP_PROPRE_B }) });

    // --- 5. non-régressions ---
    const auto = await apiAdmin(cookie, "modifier-manager", { id: idB, isManager: false, managerId: idB });
    verif("auto-référence refusée (400)", auto.status === 400, auto.data);
    const inconnu = await apiAdmin(cookie, "modifier-manager", { id: idB, isManager: false, managerId: "id-inexistant-250" });
    verif("responsable inconnu refusé (400)", inconnu.status === 400, inconnu.data);
    const mOff = await apiAdmin(cookie, "modifier-manager", { id: idA, isManager: false, managerId: null });
    verif("décochage Manager de A (200)", mOff.status === 200 && mOff.data.access?.isManager === false, mOff.data);
    const g2 = await getAcces(cookie);
    const b2 = (g2.data.items || []).find((i) => i.id === idB);
    verif("décochage de A → B remis à « Aucun » (cohérence Task 248 conservée)", b2?.managerId === null, b2?.managerId);

    // --- 6. nettoyage ---
    await apiAdmin(cookie, "delete", { id: idA });
    await apiAdmin(cookie, "delete", { id: idB });
    const g3 = await getAcces(cookie);
    const restes = (g3.data.items || []).filter((i) => i.id === idA || i.id === idB);
    verif("nettoyage : 0 accès de test restant", restes.length === 0, restes.length);
    await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
    console.log(`\nRÉSULTAT : ${ok} OK / ${ko} KO`);
    process.exit(ko === 0 ? 0 : 1);
  } catch (e) {
    console.error("ERREUR FATALE:", e);
    process.exit(1);
  } finally {
    await p.$disconnect();
  }
}
main();
