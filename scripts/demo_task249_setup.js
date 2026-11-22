/* Préparation d'un accès de démonstration pour la vérification navigateur
 * Task 249 : employé Sonia Test (CIN TEST1320002) affectée au manager
 * Marc Test (TEST1320001). Mot de passe portail connu (pas de parcours
 * initial/OTP). Usage : node scripts/demo_task249_setup.js [clean] */
"use strict";
process.chdir("/home/z/my-project");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const ADMIN = "http://127.0.0.1:4000";
const EMAIL = "diag132b@test.local";
const MDP = "Diag-2026!132b";
const CIN_MGR = "TEST1321001";
const CIN_EMP = "TEST1321002";
const MDP_PORTAIL = "Portail!2026x";
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
async function main() {
  const p = new PrismaClient();
  const cinMgr = bd.chiffrerChamp(CIN_MGR, true);
  const cinEmp = bd.chiffrerChamp(CIN_EMP, true);
  if (process.argv[2] === "clean") {
    await p.portalAccess.deleteMany({ where: { cin: { in: [cinMgr, cinEmp] } } });
    const e = bd.chiffrerChamp(EMAIL, true);
    await p.user.deleteMany({ where: { email: { in: [e, EMAIL] } } });
    console.log("Nettoyage démo Task 249 : OK");
    await p.$disconnect();
    return;
  }
  // Session admin de test
  const e = bd.chiffrerChamp(EMAIL, true);
  await p.user.deleteMany({ where: { email: { in: [e, EMAIL] } } });
  await p.user.create({ data: { email: e, name: "Diag 132b", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
  const login = await fetch(`${ADMIN}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) });
  const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  if (login.status !== 200 || !cookie) { console.error("login admin KO"); process.exit(1); }
  // Accès manager + employé (mots de passe portail DÉFINIS — pas de parcours initial)
  await p.portalAccess.deleteMany({ where: { cin: { in: [cinMgr, cinEmp] } } });
  const mgr = await p.portalAccess.create({ data: {
    cin: cinMgr, nomPrenom: bd.chiffrerChamp("Marc Test"), nom: bd.chiffrerChamp("Test"), prenom: bd.chiffrerChamp("Marc"),
    email: bd.chiffrerChamp("marc.test@demo132.local"), passwordHash: bd.chiffrerChamp(MDP_PORTAIL),
    passwordChangedAt: new Date(), isActive: true, isManager: true,
  } });
  const emp = await p.portalAccess.create({ data: {
    cin: cinEmp, nomPrenom: bd.chiffrerChamp("Sonia Test"),
    email: bd.chiffrerChamp("sonia.test@demo132.local"), passwordHash: bd.chiffrerChamp(MDP_PORTAIL),
    passwordChangedAt: new Date(), isActive: true, managerId: mgr.id,
  } });
  console.log("Démo prête : CIN " + CIN_EMP + " / " + MDP_PORTAIL + " (manager : Marc Test — " + mgr.id + ", employée : " + emp.id + ")");
  await p.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
