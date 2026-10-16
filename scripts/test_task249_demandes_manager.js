/* Test E2E v0.2.132 — Portail employé, demandes de congé / autorisation :
 *  1. les formulaires NE contiennent PLUS le champ « Responsable N+1 »
 *     (congé : id conge-n1 ; autorisation : id sortie-n1) ;
 *  2. le MANAGER RESPONSABLE est résolu AUTOMATIQUEMENT depuis l'affectation
 *     « Mot de passe initial — CIN » (PortalAccess.managerId, Task 248) ;
 *  3. à la soumission (sans AUCUN champ responsable), la demande part :
 *     → e-mail PRINCIPAL au manager (validation), COPIE au service RH,
 *       CONFIRMATION à l'employé demandeur (arrière-plan, journal) ;
 *  4. sans manager affecté : repli service RH (la demande aboutit) ;
 *  5. les champs `emailN1` / `responsableN1` envoyés par un ancien client
 *     sont IGNORÉS (jamais stockés) ;
 *  6. nettoyage intégral (demandes, accès, config SMTP de test, session).
 * Usage : node scripts/test_task249_demandes_manager.js
 */
"use strict";
process.chdir("/home/z/my-project");
const fs = require("fs");
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const bd = require("/home/z/my-project/scripts/lib-crypto-bd.js");
const ADMIN = "http://127.0.0.1:4000";
const PORTAIL = "http://127.0.0.1:4001";
const EMAIL = "diag132@test.local";
const MDP = "Diag-2026!132";
const CIN_MGR = "TEST1320001";
const CIN_EMP = "TEST1320002";
const CIN_SANS = "TEST1320003";
const EMAIL_MGR = "manager.dem132@test.local";
const EMAIL_EMP = "employe.dem132@test.local";
let ok = 0, ko = 0;
function verif(label, cond, detail) {
  if (cond) { ok++; console.log("  OK  " + label); }
  else { ko++; console.log("  KO  " + label + (detail ? " — " + JSON.stringify(detail).slice(0, 200) : "")); }
}
function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(p, salt, 64).toString("hex")}`;
}
/** Cookie de session portail forgé (même HMAC que portail-server.js). */
function cookiePortail(cin) {
  const secret = fs.readFileSync(".env", "utf8").match(/AUTH_SECRET=(\S+)/)[1];
  const payload = Buffer.from(JSON.stringify({
    cin, exp: Math.floor(Date.now() / 1000) + 1800, rm: 0, pd: 0, ot: 0,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return "portail_session=" + encodeURIComponent(payload + "." + sig);
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
  const journalAvant = fs.existsSync("logs/journal-emails.log")
    ? fs.readFileSync("logs/journal-emails.log", "utf8").split("\n").filter(Boolean).length : 0;

  // ===== Préparation =====
  const emailChiffre = bd.chiffrerChamp(EMAIL, true);
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  await p.user.create({ data: { email: emailChiffre, name: "Diag 132", passwordHash: hashPassword(MDP), role: "RH", isActive: true, passwordChangedAt: new Date() } });
  const login = await fetch(`${ADMIN}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: MDP }) });
  const cookie = (login.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  verif("login session de test", login.status === 200 && Boolean(cookie));
  if (!cookie) process.exit(1);

  // MailConfig de test (sauvegarde/restauration de la ligne existante)
  const cfgAvant = await p.mailConfig.findUnique({ where: { id: "smtp" } });
  const cfgTest = {
    host: "smtp.test.invalid", port: 587, secure: false,
    rhEmail: "rh.dem132@test.local", congeEmail: "conge.dem132@test.local",
    autorisationEmail: "autorisation.dem132@test.local",
  };
  if (cfgAvant) { await p.mailConfig.update({ where: { id: "smtp" }, data: cfgTest }); }
  else { await p.mailConfig.create({ data: { id: "smtp", ...cfgTest } }); }
  verif("MailConfig de test en place", Boolean(await p.mailConfig.findUnique({ where: { id: "smtp" } })));

  // Accès portail : manager + employé (affecté) + employé (sans manager)
  for (const c of [CIN_MGR, CIN_EMP, CIN_SANS]) {
    await p.portalAccess.deleteMany({ where: { cin: bd.chiffrerChamp(c, true) } });
  }
  const c1 = await apiAdmin(cookie, "create", { cin: CIN_MGR });
  const c2 = await apiAdmin(cookie, "create", { cin: CIN_EMP });
  const c3 = await apiAdmin(cookie, "create", { cin: CIN_SANS });
  verif("3 accès portail créés", c1.status === 200 && c2.status === 200 && c3.status === 200);
  const idMgr = c1.data.access.id, idEmp = c2.data.access.id, idSans = c3.data.access.id;
  // Noms + e-mails de notification (chiffrement aléatoire, carte PortalAccess)
  await p.portalAccess.update({ where: { id: idMgr }, data: { nomPrenom: bd.chiffrerChamp("Marc Dupont"), nom: bd.chiffrerChamp("Dupont"), prenom: bd.chiffrerChamp("Marc"), email: bd.chiffrerChamp(EMAIL_MGR), passwordChangedAt: new Date() } });
  await p.portalAccess.update({ where: { id: idEmp }, data: { nomPrenom: bd.chiffrerChamp("Sonia Ben Ali"), email: bd.chiffrerChamp(EMAIL_EMP), passwordChangedAt: new Date() } });
  await p.portalAccess.update({ where: { id: idSans }, data: { nomPrenom: bd.chiffrerChamp("Alex Martin"), passwordChangedAt: new Date() } });
  // Désignations (fenêtre « Mot de passe initial — CIN »)
  const m1 = await apiAdmin(cookie, "modifier-manager", { id: idMgr, isManager: true, managerId: null });
  const m2 = await apiAdmin(cookie, "modifier-manager", { id: idEmp, isManager: false, managerId: idMgr });
  verif("affectations manager (Marc → manager ; Sonia → Marc)", m1.status === 200 && m2.status === 200 && m2.data.access?.managerId === idMgr, m2.data);

  // ===== 1. Formulaires SANS champ « Responsable N+1 » (page /demandes) =====
  const page = await fetch(`${PORTAIL}/demandes`, { headers: { cookie: cookiePortail(CIN_EMP) } });
  const html = await page.text();
  verif("page /demandes accessible (200)", page.status === 200);
  verif("page /demandes contient les 2 formulaires", html.includes('id="form-conge"') && html.includes('id="form-sortie"'));
  verif("page portail accessible (200)", page.status === 200);
  verif("congé : plus de champ conge-n1", !html.includes('id="conge-n1"') && !html.includes("Adresse e-mail du N+1"));
  verif("autorisation : plus de champ sortie-n1", !html.includes('id="sortie-n1"') && !html.includes("<label>Responsable N+1 *</label>"));
  verif("sous-titres : routage manager responsable annoncé", (html.match(/manager responsable pour validation/g) || []).length >= 2);

  // ===== 2-3. Demande de congé (SANS emailN1 + emailN1 legacy ignoré) =====
  const dem1 = await fetch(`${PORTAIL}/api/demandes`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: cookiePortail(CIN_EMP) },
    body: JSON.stringify({ type: "CONGE", typeConge: "Annuel", dateDebut: "2026-11-02", dateFin: "2026-11-06", emailN1: "ancien.client@nplus1.local", commentaire: "Test 132" }),
  });
  const d1 = await dem1.json();
  verif("congé créé (201) sans aucune saisie responsable", dem1.status === 201 && Boolean(d1.reference), d1);
  verif("congé : destinataire PRINCIPAL = e-mail du manager", d1.destinataire === EMAIL_MGR, d1);
  verif("congé : motif routage manager", String(d1.routageMotif || "").includes("Manager responsable"), d1.routageMotif);
  verif("congé : RH en copie (destinataires)", Array.isArray(d1.destinataires) && d1.destinataires.includes(EMAIL_MGR) && d1.destinataires.includes("rh.dem132@test.local"), d1.destinataires);

  // ===== 2-3. Autorisation de sortie (SANS responsableN1 + legacy ignoré) =====
  const dem2 = await fetch(`${PORTAIL}/api/demandes`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: cookiePortail(CIN_EMP) },
    body: JSON.stringify({ type: "AUTORISATION_SORTIE", date: "2026-11-03", responsableN1: "ancien.client@nplus1.local", motif: "Démarche bancaire", nombreHeures: "2", heureSortie: "09:00", heureRetour: "11:00", compensation: "NON" }),
  });
  const d2 = await dem2.json();
  verif("autorisation créée (201) sans aucune saisie responsable", dem2.status === 201 && Boolean(d2.reference), d2);
  verif("autorisation : destinataire PRINCIPAL = e-mail du manager", d2.destinataire === EMAIL_MGR, d2);

  // ===== 4. Employé SANS manager → repli service RH =====
  const dem3 = await fetch(`${PORTAIL}/api/demandes`, {
    method: "POST", headers: { "Content-Type": "application/json", cookie: cookiePortail(CIN_SANS) },
    body: JSON.stringify({ type: "CONGE", typeConge: "Maladie", dateDebut: "2026-11-10", dateFin: "2026-11-11" }),
  });
  const d3 = await dem3.json();
  verif("congé sans manager : repli RH (la demande aboutit)", dem3.status === 201 && d3.destinataire === "rh.dem132@test.local" && String(d3.routageMotif || "").includes("aucun manager"), d3);

  // ===== 5. Contrôles en base (champs legacy NON stockés, managerNom résolu) =====
  const ref1 = await p.demandeAdministrative.findUnique({ where: { reference: d1.reference } });
  const ref2 = await p.demandeAdministrative.findUnique({ where: { reference: d2.reference } });
  const donnees1 = JSON.parse(bd.dechiffrerChamp(ref1.donnees) || "{}");
  const donnees2 = JSON.parse(bd.dechiffrerChamp(ref2.donnees) || "{}");
  verif("congé : emailN1 legacy NON stocké", donnees1.emailN1 === undefined, donnees1);
  verif("congé : managerNom résolu automatiquement (Marc Dupont)", donnees1.managerNom === "Marc Dupont", donnees1);
  verif("autorisation : responsableN1 legacy NON stocké", donnees2.responsableN1 === undefined, donnees2);
  verif("autorisation : managerNom résolu automatiquement", donnees2.managerNom === "Marc Dupont", donnees2);
  verif("congé : destinataire (chiffré) = manager", bd.dechiffrerChamp(ref1.destinataire) === EMAIL_MGR);
  verif("congé : copie employé figée (employeEmail)", bd.dechiffrerChamp(ref1.employeEmail) === EMAIL_EMP);

  // ===== 5bis. « Mes demandes » : affichage manager, pas de champ legacy =====
  const mes = await fetch(`${PORTAIL}/api/mes-demandes`, { headers: { cookie: cookiePortail(CIN_EMP) } });
  const mesD = await mes.json();
  const maConge = (mesD.items || []).find((i) => i.reference === d1.reference);
  verif("mes-demandes : managerNom affiché, emailN1 absent", maConge && maConge.donnees.managerNom === "Marc Dupont" && maConge.donnees.emailN1 === undefined, maConge && maConge.donnees);

  // ===== 3ter. Journal : 3 e-mails par demande (manager / RH / employé) =====
  await new Promise((r) => setTimeout(r, 1200)); // laisse l'arrière-plan journaliser
  const journal = fs.readFileSync("logs/journal-emails.log", "utf8").split("\n").filter(Boolean);
  const nouveaux = journal.slice(journalAvant).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const deRef1 = nouveaux.filter((e) => e.reference === d1.reference);
  const actionDe = (arr, action) => arr.find((e) => e.action === action);
  const e1a = actionDe(deRef1, "demande-creation");
  const e1b = actionDe(deRef1, "demande-creation-copie-dediee") || actionDe(deRef1, "demande-creation-copie-rh");
  const e1c = actionDe(deRef1, "demande-creation-confirmation-demandeur");
  verif("journal congé : e-mail PRINCIPAL parti au manager", e1a && e1a.dest === EMAIL_MGR, e1a);
  verif("journal congé : COPIE au service RH (adresse dédiée congé)", e1b && e1b.dest === "conge.dem132@test.local", e1b);
  verif("journal congé : CONFIRMATION à l'employé demandeur", e1c && e1c.dest === EMAIL_EMP, e1c);
  const deRef2 = nouveaux.filter((e) => e.reference === d2.reference);
  const e2a = actionDe(deRef2, "demande-creation");
  const e2b = actionDe(deRef2, "demande-creation-copie-dediee") || actionDe(deRef2, "demande-creation-copie-rh");
  const e2c = actionDe(deRef2, "demande-creation-confirmation-demandeur");
  verif("journal autorisation : manager / RH dédiée / employé", e2a && e2a.dest === EMAIL_MGR && e2b && e2b.dest === "autorisation.dem132@test.local" && e2c && e2c.dest === EMAIL_EMP, [e2a, e2b, e2c]);

  // ===== Nettoyage intégral =====
  await p.demandeAdministrative.deleteMany({ where: { reference: { in: [d1.reference, d2.reference, d3.reference] } } });
  await p.portalAccess.deleteMany({ where: { id: { in: [idMgr, idEmp, idSans] } } });
  if (cfgAvant) {
    await p.mailConfig.update({ where: { id: "smtp" }, data: {
      host: cfgAvant.host, port: cfgAvant.port, secure: cfgAvant.secure,
      rhEmail: cfgAvant.rhEmail, congeEmail: cfgAvant.congeEmail, autorisationEmail: cfgAvant.autorisationEmail,
    } });
  } else {
    await p.mailConfig.delete({ where: { id: "smtp" } });
  }
  await p.user.deleteMany({ where: { email: { in: [emailChiffre, EMAIL] } } });
  const reste = await p.portalAccess.count({ where: { cin: { in: [bd.chiffrerChamp(CIN_MGR, true), bd.chiffrerChamp(CIN_EMP, true), bd.chiffrerChamp(CIN_SANS, true)] } } });
  verif("nettoyage : 0 accès/demande/compte de test restants", reste === 0 && !(await p.demandeAdministrative.findUnique({ where: { reference: d1.reference } })));

  await p.$disconnect();
  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} KO ===`);
  process.exit(ko ? 1 : 0);
}
main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(1); });
