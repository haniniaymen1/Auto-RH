#!/usr/bin/env node
/**
 * v0.2.91 — PREUVE E2E « RH et superadministrateur peuvent modifier
 * l'E-MAIL de l'employé » (colonne « E-mail d'accès », accès portail).
 * =====================================================================
 * Vérifie contre l'administration réelle (port 4000) :
 *   - le champ `email` (notification, Task 116, chiffré) est EXPOSÉ dans
 *     GET /api/portal-access (propriété présente, null au départ) ;
 *   - action NOUVELLE « modifier-email » : RH → 200, SUPERADMIN → 200,
 *     IT → 403 (garde serveur), anonyme → 401 ;
 *   - PERSISTANCE EN BASE prouvée par déchiffrement (jumelle crypto) et
 *     par la lecture API successive ;
 *   - le stockage est CHIFFRÉ (la valeur brute en base ≠ e-mail clair) ;
 *   - validations : e-mail invalide → 400, CIN inconnu → 404 ;
 *   - nettoyage complet (accès + comptes de test supprimés).
 *
 * Usage : node scripts/test_v091_modifier_email.js
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();

const BASE = "http://localhost:4000";
const db = new PrismaClient();

let OK = 0;
let KO = 0;
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

/** Client HTTP minimal avec cookie de session. */
function client() {
  let cookie = "";
  return {
    async req(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      let json = null;
      try { json = await res.json(); } catch { /* page HTML */ }
      return { status: res.status, json };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    del(p) { return this.req("DELETE", p); },
  };
}

const CIN_TEST = "TEST91001";
const EMAIL1 = "employe.avant@test-local.tn";
const EMAIL2 = "employe.corrigee@test-local.tn";
const EMAIL3 = "employe.superadmin@test-local.tn";
const RH_EMAIL = "rh-task91001@test.local";
const IT_EMAIL = "it-task91001@test.local";
const MDP = "Test-9101!Pass";

async function main() {
  console.log("== v0.2.91 — modification de l'e-mail de l'employé (RH + superadmin) ==");

  // ------------------------------------------------------------------
  // 0) SEMIS : 1 accès portail pour le CIN de test (CIN chiffré
  //    déterministe, même discipline que les accès créés par le site).
  // ------------------------------------------------------------------
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.create({
    data: { cin: cinDet, isActive: true },
  });
  console.log(`Semé : accès portail ${CIN_TEST} (sans e-mail au départ).`);

  // ------------------------------------------------------------------
  // 1) CONNEXIONS
  // ------------------------------------------------------------------
  const sup = client();
  const rh = client();
  const it = client();
  const ano = client();

  const loginSup = await sup.post("/api/auth/login", {
    email: "superadmin@autorh.local",
    password: "AutoRH-2026!Verif#1",
  });
  check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);

  const creerRh = await sup.post("/api/users", {
    name: "RH v091", email: RH_EMAIL, password: MDP, role: "RH",
  });
  check("Superadmin crée un compte RH", [200, 201].includes(creerRh.status), `status=${creerRh.status}`);
  const creerIt = await sup.post("/api/users", {
    name: "IT v091", email: IT_EMAIL, password: MDP, role: "IT",
  });
  check("Superadmin crée un compte IT", [200, 201].includes(creerIt.status), `status=${creerIt.status}`);

  check("Connexion RH", (await rh.post("/api/auth/login", { email: RH_EMAIL, password: MDP })).status === 200);
  check("Connexion IT", (await it.post("/api/auth/login", { email: IT_EMAIL, password: MDP })).status === 200);

  // (v0.2.91) comptes créés par le superadmin = mot de passe PROVISOIRE :
  // changement OBLIGATOIRE de première connexion avant tout autre appel
  // (même discipline que les autres suites — cf. test_task173_roles.js).
  const MDP_RH = "Test-9101!Rh#8";
  const MDP_IT = "Test-9101!It#9";
  const chgRh = await rh.post("/api/auth/change-password", {
    currentPassword: MDP, newPassword: MDP_RH,
  });
  check("Changement de mot de passe initial (RH)", chgRh.status === 200, `status=${chgRh.status}`);
  const chgIt = await it.post("/api/auth/change-password", {
    currentPassword: MDP, newPassword: MDP_IT,
  });
  check("Changement de mot de passe initial (IT)", chgIt.status === 200, `status=${chgIt.status}`);

  // ------------------------------------------------------------------
  // 2) EXPOSITION DU CHAMP EMAIL DANS LE GET
  // ------------------------------------------------------------------
  console.log("-- GET /api/portal-access : champ email exposé --");
  const get0 = await rh.get("/api/portal-access");
  check("RH : GET accès portail 200", get0.status === 200, `status=${get0.status}`);
  const ligne0 = (get0.json?.items ?? []).find((x) => x.cin === CIN_TEST);
  check("Ligne du CIN de test présente", Boolean(ligne0));
  check("Propriété `email` EXISTE dans la ligne (Task 116 exposée)", "email" in (ligne0 ?? {}), JSON.stringify(ligne0 ?? {}));
  check("E-mail au départ : null (pas encore renseigné)", ligne0?.email === null || ligne0?.email === undefined);

  // ------------------------------------------------------------------
  // 3) LE RH MODIFIE L'E-MAIL — 200 + PERSISTANCE
  // ------------------------------------------------------------------
  console.log("-- RH : modifier-email --");
  const put1 = await rh.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: EMAIL1,
  });
  check("RH : POST modifier-email → 200", put1.status === 200, `status=${put1.status} ${JSON.stringify(put1.json)}`);
  check("Message de confirmation renvoyé", String(put1.json?.message ?? "").includes(CIN_TEST));

  const get1 = await rh.get("/api/portal-access");
  const ligne1 = (get1.json?.items ?? []).find((x) => x.cin === CIN_TEST);
  check("RH : e-mail visible dans le GET = EMAIL1", ligne1?.email === EMAIL1, String(ligne1?.email));

  // Persistance EN BASE (déchiffrement via la jumelle)
  let acc = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check("BASE : e-mail déchiffré = EMAIL1", cryptoBd.dechiffrerChamp(acc?.email) === EMAIL1,
    String(cryptoBd.dechiffrerChamp(acc?.email)));
  check("BASE : stockage CHIFFRÉ (valeur brute ≠ e-mail en clair)", acc?.email && acc.email !== EMAIL1);

  // Modification successive par le RH
  const put2 = await rh.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: EMAIL2,
  });
  check("RH : deuxième modification → 200", put2.status === 200, `status=${put2.status}`);
  acc = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check("BASE : e-mail mis à jour = EMAIL2", cryptoBd.dechiffrerChamp(acc?.email) === EMAIL2,
    String(cryptoBd.dechiffrerChamp(acc?.email)));

  // ------------------------------------------------------------------
  // 4) LE SUPERADMINISTRATEUR MODIFIE AUSSI
  // ------------------------------------------------------------------
  console.log("-- SUPERADMIN : modifier-email --");
  const putSup = await sup.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: EMAIL3,
  });
  check("SUPERADMIN : POST modifier-email → 200", putSup.status === 200, `status=${putSup.status}`);
  acc = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check("BASE : e-mail mis à jour = EMAIL3", cryptoBd.dechiffrerChamp(acc?.email) === EMAIL3,
    String(cryptoBd.dechiffrerChamp(acc?.email)));
  const getSup = await rh.get("/api/portal-access");
  const ligneSup = (getSup.json?.items ?? []).find((x) => x.cin === CIN_TEST);
  check("GET (relecture RH) : email = EMAIL3", ligneSup?.email === EMAIL3, String(ligneSup?.email));

  // ------------------------------------------------------------------
  // 5) L'IT EST REFUSÉ (garde serveur)
  // ------------------------------------------------------------------
  console.log("-- IT : refus (matrice des rôles) --");
  const putIt = await it.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: "pirate@inconnu.tn",
  });
  check("IT : POST modifier-email → 403", putIt.status === 403, `status=${putIt.status}`);
  check("IT : code FONCTIONNALITE_NON_AUTORISEE_IT", putIt.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT", JSON.stringify(putIt.json ?? {}));
  const getIt = await it.get("/api/portal-access");
  check("IT : GET accès portail → 403 (rappel matrice)", getIt.status === 403, `status=${getIt.status}`);
  acc = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check("BASE : e-mail INCHANGÉ après la tentative IT", cryptoBd.dechiffrerChamp(acc?.email) === EMAIL3);

  // ------------------------------------------------------------------
  // 6) VALIDATIONS
  // ------------------------------------------------------------------
  console.log("-- Validations --");
  const bad1 = await rh.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: "pas-une-adresse",
  });
  check("E-mail sans @ → 400", bad1.status === 400, `status=${bad1.status}`);
  const bad2 = await rh.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: "a@b",
  });
  check("E-mail sans domaine valide → 400", bad2.status === 400, `status=${bad2.status}`);
  const bad3 = await rh.post("/api/portal-access", {
    action: "modifier-email", cin: "INCONNU99999", email: EMAIL1,
  });
  check("CIN inconnu → 404 « Accès introuvable. »", bad3.status === 404 && bad3.json?.error === "Accès introuvable.",
    `status=${bad3.status} ${JSON.stringify(bad3.json ?? {})}`);
  const anon = await ano.post("/api/portal-access", {
    action: "modifier-email", cin: CIN_TEST, email: EMAIL1,
  });
  check("Anonyme (sans session) → 401", anon.status === 401, `status=${anon.status}`);
  const anonGet = await ano.get("/api/portal-access");
  check("Anonyme : GET → 401", anonGet.status === 401, `status=${anonGet.status}`);

  // ------------------------------------------------------------------
  // 7) NETTOYAGE COMPLET
  // ------------------------------------------------------------------
  console.log("-- Nettoyage --");
  const delAcc = await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  check("Accès de test supprimé", delAcc.count === 1);

  const listeU = await sup.get("/api/users");
  const users = listeU.json?.users ?? [];
  for (const u of users.filter((x) => x.email === RH_EMAIL || x.email === IT_EMAIL)) {
    await sup.del(`/api/users/${u.id}`);
  }
  const listeFin = await sup.get("/api/users");
  const reste = (listeFin.json?.users ?? []).filter((x) => x.email === RH_EMAIL || x.email === IT_EMAIL);
  check("Comptes de test supprimés", reste.length === 0);
  const accReste = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check("Base vidée de l'accès de test", accReste === null);

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  await db.$disconnect();
  process.exit(KO === 0 ? 0 : 1);
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e); process.exit(2); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); process.exit(2); });
main().catch((e) => { console.error(e); process.exit(2); });
