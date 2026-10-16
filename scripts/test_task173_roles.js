#!/usr/bin/env node
/**
 * Task 173 — PREUVE E2E « Permissions du rôle IT / Rôle RH / Nom et prénom /
 * suppression de l'inscription par code d'activation ».
 *
 * Vérifie contre l'administration réelle (port 4000) :
 *   IT  : SMTP consultable + modifiable (GET/PUT/POST 200),
 *         signature/QR RETIRÉE à l'IT (Task 176 : GET/PUT/POST 403),
 *         Demandes INTERDITES (403 sur liste, détail, traitement),
 *         utilisateurs en CONSULTATION SEULE (GET 200 ; PATCH/DELETE/POST/
 *         password/role → 403), fiches/portail toujours 403 ;
 *   RH  : aucun droit de gestion des comptes (users → 403 partout),
 *         SMTP lisible = booléen seul (PUT/POST 403), signature OK,
 *         fiches/portail OK ;
 *   Nom et prénom : action « modifier-nom » (RH 200 + PERSISTANCE en base :
 *         toutes les fiches du CIN mises à jour + accès portail), IT 403 ;
 *   Suppression de l'inscription : /api/auth/signup 404, page /signup absente.
 *
 * Nettoyage complet vérifié (comptes de test, fiches et accès semés).
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme start-prod.js) -----------------------------
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
  if (cond) {
    OK++;
    console.log(`  OK   ${label}`);
  } else {
    KO++;
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`);
  }
}

/** Client HTTP minimal avec cookie de session par rôle. */
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
      try {
        json = await res.json();
      } catch {
        /* page HTML ou vide */
      }
      return { status: res.status, json };
    },
    get(p) {
      return this.req("GET", p);
    },
    post(p, b) {
      return this.req("POST", p, b);
    },
    put(p, b) {
      return this.req("PUT", p, b);
    },
    patch(p, b) {
      return this.req("PATCH", p, b);
    },
    del(p) {
      return this.req("DELETE", p);
    },
  };
}

const CIN_TEST = "TEST17301";
const NOM_ANCIEN = "Ancien Nom";
const NOM_NOUVEAU = "Nouveau Nom Corrigé";

async function main() {
  console.log("== Task 173 — preuve E2E ==");

  // ------------------------------------------------------------------
  // 0) SÉME : 2 fiches + 1 accès portail pour le CIN de test (via la
  //    jumelle crypto JS : mêmes empreintes déterministes que le site).
  // ------------------------------------------------------------------
  const cinIndex = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.payslip.deleteMany({ where: { fileName: { in: ["e2e-173-a.pdf", "e2e-173-b.pdf"] } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.payslip.createMany({
    data: [
      {
        fileName: "e2e-173-a.pdf",
        storedName: "e2e-173-a.pdf",
        fileSize: 100,
        content: "FICHE DE PAIE " + CIN_TEST,
        normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST,
        cinIndex,
        employeeName: NOM_ANCIEN,
        period: "09/2026",
        netSalary: "1 000,00",
      },
      {
        fileName: "e2e-173-b.pdf",
        storedName: "e2e-173-b.pdf",
        fileSize: 100,
        content: "FICHE DE PAIE " + CIN_TEST,
        normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST,
        cinIndex,
        employeeName: NOM_ANCIEN,
        period: "10/2026",
        netSalary: "1 000,00",
      },
    ],
  });
  await db.portalAccess.create({
    data: { cin: cinDet, isActive: true }, // cin chiffré déterministe (carte PortalAccess)
  });
  console.log(`Sémé : 2 fiches (${CIN_TEST} / ${NOM_ANCIEN}) + 1 accès portail.`);

  // ------------------------------------------------------------------
  // 1) Connexions
  // ------------------------------------------------------------------
  const sup = client();
  const it = client();
  const rh = client();

  // (MODIFIÉ Task 231 — indépendance de l'environnement) compte de test
  // temporaire (lab226/creer-compte-e2e-116) à la place du SUPERADMIN réel.
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" }); } catch {}
  const ADMIN_231 = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
  const loginSup = await sup.post("/api/auth/login", {
    email: ADMIN_231.email,
    password: ADMIN_231.password,
  });
  check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);

  // Création des comptes de test IT et RH (superadmin — Task 172)
  const MDP = "Test-173!Pass";
  // (Task 231) purge des résidus d'exécutions antérieures (409 doublon) —
  // les e-mails User sont chiffrés de façon DÉTERMINISTE.
  try {
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("it-task173@test.local", true) } });
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("rh-task173@test.local", true) } });
  } catch {}
  const creerIt = await sup.post("/api/users", {
    name: "IT Task173",
    email: "it-task173@test.local",
    password: MDP,
    role: "IT",
  });
  check("Superadmin crée un compte IT", [200, 201].includes(creerIt.status), `status=${creerIt.status} ${JSON.stringify(creerIt.json)}`);
  const creerRh = await sup.post("/api/users", {
    name: "RH Task173",
    email: "rh-task173@test.local",
    password: MDP,
    role: "RH",
  });
  check("Superadmin crée un compte RH", [200, 201].includes(creerRh.status), `status=${creerRh.status}`);

  const liste0 = await sup.get("/api/users");
  const uIt = (liste0.json?.users ?? []).find((u) => u.email === "it-task173@test.local");
  const uRh = (liste0.json?.users ?? []).find((u) => u.email === "rh-task173@test.local");
  check("Comptes de test présents dans la liste", Boolean(uIt && uRh));

  const loginIt = await it.post("/api/auth/login", {
    email: "it-task173@test.local",
    password: MDP,
  });
  const loginRh = await rh.post("/api/auth/login", {
    email: "rh-task173@test.local",
    password: MDP,
  });
  check("Connexion IT", loginIt.status === 200);
  check("Connexion RH", loginRh.status === 200);

  // (Task 231) v0.2.111+ : le mot de passe posé par le superadmin est
  // PROVISOIRE (passwordChangedAt antidaté) — changement OBLIGATOIRE à la
  // première connexion avant tout autre appel API.
  const chIt = await it.post("/api/auth/change-password", {
    currentPassword: MDP,
    newPassword: MDP + "2",
  });
  check("IT change son mot de passe provisoire (v0.2.111+)", chIt.status === 200, `status=${chIt.status} ${JSON.stringify(chIt.json || {})}`);
  const chRh = await rh.post("/api/auth/change-password", {
    currentPassword: MDP,
    newPassword: MDP + "2",
  });
  check("RH change son mot de passe provisoire (v0.2.111+)", chRh.status === 200, `status=${chRh.status} ${JSON.stringify(chRh.json || {})}`);

  // ------------------------------------------------------------------
  // 2) IT — SMTP : CONSULTABLE et MODIFIABLE
  // ------------------------------------------------------------------
  console.log("-- IT : configuration mail (SMTP) --");
  const itMailGet = await it.get("/api/mail-config");
  check("IT GET /api/mail-config → 200 (consulter)", itMailGet.status === 200, `status=${itMailGet.status}`);
  check(
    "IT reçoit la configuration COMPLÈTE (host présent)",
    typeof itMailGet.json?.config?.host === "string",
    JSON.stringify(itMailGet.json?.config ?? {}).slice(0, 120)
  );
  const cfg = itMailGet.json?.config ?? {};
  const itMailPut = await it.put("/api/mail-config", {
    host: cfg.host || "smtp.test.local",
    port: cfg.port || 587,
    username: cfg.username || "",
    from: cfg.from || "",
    serveurAdresse: cfg.serveurAdresse || "",
    sitePort: cfg.sitePort || "",
    portailUrl: cfg.portailUrl || "",
    rhEmail: cfg.rhEmail || "",
    itEmail: cfg.itEmail || "",
    responsablesMap: cfg.responsablesMap || "",
    parrainageEmail: cfg.parrainageEmail || "",
    imapActif: Boolean(cfg.imapActif),
    imapHost: cfg.imapHost || "",
    imapPort: cfg.imapPort || 993,
    imapUser: cfg.imapUser || "",
  });
  check("IT PUT /api/mail-config → 200 (modifier)", itMailPut.status === 200, `status=${itMailPut.status} ${JSON.stringify(itMailPut.json ?? {}).slice(0, 120)}`);
  const itMailTest = await it.post("/api/mail-config", { action: "test", dest: "test@exemple.tn" });
  check("IT POST test SMTP → PAS de 403 (diagnostic autorisé)", itMailTest.status !== 403, `status=${itMailTest.status}`);

  // ------------------------------------------------------------------
  // 3) IT — QR code / signature électronique : RETIRÉE (Task 176)
  // ------------------------------------------------------------------
  console.log("-- IT : QR code et signature électronique (retirés) --");
  const itSigGet = await it.get("/api/signature-config");
  check("IT GET /api/signature-config → 403 (Task 176)", itSigGet.status === 403, `status=${itSigGet.status}`);
  check(
    "IT GET signature → code FONCTIONNALITE_NON_AUTORISEE_IT",
    itSigGet.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT",
    JSON.stringify(itSigGet.json ?? {})
  );
  const itSigPut = await it.put("/api/signature-config", { actif: false });
  check("IT PUT /api/signature-config → 403 (Task 176)", itSigPut.status === 403, `status=${itSigPut.status}`);
  const itSigApercu = await it.post("/api/signature-config", { action: "apercu" });
  check("IT POST aperçu tampon → 403 (Task 176)", itSigApercu.status === 403, `status=${itSigApercu.status}`);

  // ------------------------------------------------------------------
  // 4) IT — DEMANDES : INTERDITES
  // ------------------------------------------------------------------
  console.log("-- IT : demandes administratives (refusées) --");
  const itDem = await it.get("/api/demandes");
  check("IT GET /api/demandes → 403", itDem.status === 403, `status=${itDem.status}`);
  const itDemId = await it.get("/api/demandes/task173-inexistant");
  check("IT GET /api/demandes/[id] → 403", itDemId.status === 403, `status=${itDemId.status}`);
  const itDemTrait = await it.post("/api/demandes/task173-inexistant", { statut: "ACCEPTEE" });
  check("IT POST traitement demande → 403", itDemTrait.status === 403, `status=${itDemTrait.status}`);

  // ------------------------------------------------------------------
  // 5) IT — UTILISATEURS : CONSULTATION SEULE
  // ------------------------------------------------------------------
  console.log("-- IT : liste des utilisateurs (lecture seule) --");
  const itUsers = await it.get("/api/users");
  check("IT GET /api/users → 200 (consulter la liste)", itUsers.status === 200, `status=${itUsers.status}`);
  const itPatchSelf = await it.patch(`/api/users/${uIt.id}`, { isActive: false });
  check("IT PATCH activer/désactiver → 403", itPatchSelf.status === 403, `status=${itPatchSelf.status}`);
  const itDeleteRh = await it.del(`/api/users/${uRh.id}`);
  check("IT DELETE compte → 403", itDeleteRh.status === 403, `status=${itDeleteRh.status}`);
  const itCreate = await it.post("/api/users", {
    name: "X",
    email: "x173@test.local",
    password: MDP,
    role: "RH",
  });
  check("IT POST créer un compte (RH) → 403", itCreate.status === 403, `status=${itCreate.status}`);
  const itPwd = await it.post(`/api/users/${uRh.id}/password`, { password: "Autre-173!Pass" });
  check("IT POST réinitialiser mot de passe → 403", itPwd.status === 403, `status=${itPwd.status}`);
  const itRole = await it.post(`/api/users/${uRh.id}/role`, { role: "IT" });
  check("IT POST changer le rôle → 403", itRole.status === 403, `status=${itRole.status}`);

  // ------------------------------------------------------------------
  // 6) IT — toujours interdit : fiches, import, accès portail, nom/prénom
  // ------------------------------------------------------------------
  console.log("-- IT : interdits persistants --");
  const itFiches = await it.get("/api/payslips");
  check("IT GET /api/payslips → 403", itFiches.status === 403, `status=${itFiches.status}`);
  const itPortal = await it.get("/api/portal-access");
  check("IT GET /api/portal-access → 403", itPortal.status === 403, `status=${itPortal.status}`);
  const itNom = await it.post("/api/portal-access", {
    action: "modifier-nom",
    cin: CIN_TEST,
    nom: NOM_NOUVEAU,
  });
  check("IT modifier-nom → 403", itNom.status === 403, `status=${itNom.status}`);
  const itStats = await it.get("/api/stats");
  check("IT GET /api/stats → 200 (inchangé)", itStats.status === 200, `status=${itStats.status}`);
  const itJournal = await it.get("/api/demandes/journal");
  check("IT GET journal d'envoi → 200 (outil de diagnostic mail)", itJournal.status === 200, `status=${itJournal.status}`);

  // ------------------------------------------------------------------
  // 7) RH — AUCUN droit de gestion des comptes ; SMTP limité au booléen
  // ------------------------------------------------------------------
  console.log("-- RH : aucun droit de gestion des comptes --");
  const rhUsers = await rh.get("/api/users");
  check("RH GET /api/users → 403", rhUsers.status === 403, `status=${rhUsers.status}`);
  const rhPatch = await rh.patch(`/api/users/${uIt.id}`, { isActive: false });
  check("RH PATCH → 403", rhPatch.status === 403, `status=${rhPatch.status}`);
  const rhDelete = await rh.del(`/api/users/${uIt.id}`);
  check("RH DELETE → 403", rhDelete.status === 403, `status=${rhDelete.status}`);
  const rhCreate = await rh.post("/api/users", {
    name: "Y",
    email: "y173@test.local",
    password: MDP,
    role: "IT",
  });
  check("RH POST créer → 403", rhCreate.status === 403, `status=${rhCreate.status}`);

  console.log("-- RH : SMTP (usage RH inchangé) --");
  const rhMail = await rh.get("/api/mail-config");
  check("RH GET /api/mail-config → 200", rhMail.status === 200, `status=${rhMail.status}`);
  check(
    "RH ne reçoit QUE le booléen « configuree »",
    rhMail.json?.config && Object.keys(rhMail.json.config).every((k) => k === "configuree"),
    JSON.stringify(rhMail.json?.config ?? {})
  );
  const rhMailPut = await rh.put("/api/mail-config", { host: "smtp.hack.local", port: 25 });
  check("RH PUT /api/mail-config → 403", rhMailPut.status === 403, `status=${rhMailPut.status}`);

  console.log("-- RH : fonctionnalités métier conservées --");
  const rhFiches = await rh.get("/api/payslips");
  check("RH GET /api/payslips → 200", rhFiches.status === 200, `status=${rhFiches.status}`);
  const rhPortal = await rh.get("/api/portal-access");
  check("RH GET /api/portal-access → 200", rhPortal.status === 200, `status=${rhPortal.status}`);
  const rhSig = await rh.get("/api/signature-config");
  check("RH GET /api/signature-config → 200", rhSig.status === 200, `status=${rhSig.status}`);
  const rhDem = await rh.get("/api/demandes");
  check("RH GET /api/demandes → 200", rhDem.status === 200, `status=${rhDem.status}`);

  // ------------------------------------------------------------------
  // 8) NOM ET PRÉNOM — RH modifie ; PERSISTANCE dans les données employé
  // ------------------------------------------------------------------
  console.log("-- Nom et prénom : modification RH + persistance --");
  const rhNom = await rh.post("/api/portal-access", {
    action: "modifier-nom",
    cin: CIN_TEST,
    nom: NOM_NOUVEAU,
  });
  check("RH modifier-nom → 200", rhNom.status === 200, `status=${rhNom.status} ${JSON.stringify(rhNom.json ?? {})}`);
  check("RH modifier-nom signale les 2 fiches mises à jour", rhNom.json?.fichesModifiees === 2, JSON.stringify(rhNom.json ?? {}));

  // Vérification EN BASE (déchiffrement via la jumelle — la mise à jour
  // étant passée par le middleware applicatif, les valeurs sont chiffrées)
  const fiches = await db.payslip.findMany({
    where: { fileName: { in: ["e2e-173-a.pdf", "e2e-173-b.pdf"] } },
    select: { fileName: true, employeeName: true, nomIndex: true },
  });
  const noms = fiches.map((f) => cryptoBd.dechiffrerChamp(f.employeeName));
  check(
    "LES 2 FICHES du CIN portent le nouveau nom (données employé mises à jour)",
    noms.length === 2 && noms.every((n) => n === NOM_NOUVEAU),
    JSON.stringify(noms)
  );
  const nomIndexAttendu = cryptoBd.chiffrerChamp(NOM_NOUVEAU, true);
  check(
    "nomIndex recalculé pour les 2 fiches (index déterministe)",
    fiches.length === 2 && fiches.every((f) => f.nomIndex === nomIndexAttendu),
    JSON.stringify(fiches.map((f) => f.nomIndex))
  );
  const acc = await db.portalAccess.findUnique({ where: { cin: cinDet } });
  check(
    "Accès portail : nomPrenom mémorisé = nouveau nom",
    cryptoBd.dechiffrerChamp(acc?.nomPrenom) === NOM_NOUVEAU,
    String(cryptoBd.dechiffrerChamp(acc?.nomPrenom))
  );

  // L'accès modifié apparaît dans la liste avec son nom (colonne « Nom et prénom »)
  const rhPortal2 = await rh.get("/api/portal-access");
  const ligne = (rhPortal2.json?.items ?? []).find((x) => x.cin === CIN_TEST);
  check("GET /api/portal-access expose nomPrenom sur la ligne", ligne?.nomPrenom === NOM_NOUVEAU, JSON.stringify(ligne ?? {}));

  // Validation : nom invalide refusé
  const rhNomInvalide = await rh.post("/api/portal-access", {
    action: "modifier-nom",
    cin: CIN_TEST,
    nom: "N0m-1nvalide#123",
  });
  check("modifier-nom avec caractères interdits → 400", rhNomInvalide.status === 400, `status=${rhNomInvalide.status}`);

  // ------------------------------------------------------------------
  // 9) SUPERADMIN — gestion complète conservée
  // ------------------------------------------------------------------
  console.log("-- Superadmin : gestion complète --");
  const supPatch = await sup.patch(`/api/users/${uIt.id}`, { isActive: false });
  check("SUPERADMIN désactive le compte IT → 200", supPatch.status === 200, `status=${supPatch.status}`);
  const supPatch2 = await sup.patch(`/api/users/${uIt.id}`, { isActive: true });
  check("SUPERADMIN réactive le compte IT → 200", supPatch2.status === 200, `status=${supPatch2.status}`);
  const supRole = await sup.post(`/api/users/${uIt.id}/role`, { role: "RH" });
  check("SUPERADMIN change le rôle → 200", supRole.status === 200, `status=${supRole.status}`);
  const supRole2 = await sup.post(`/api/users/${uIt.id}/role`, { role: "IT" });
  check("SUPERADMIN remet le rôle IT → 200", supRole2.status === 200, `status=${supRole2.status}`);

  // ------------------------------------------------------------------
  // 10) INSCRIPTION PAR CODE D'ACTIVATION — SUPPRIMÉE
  // ------------------------------------------------------------------
  console.log("-- Suppression de l'inscription (code d'activation) --");
  const signupApi = await client().post("/api/auth/signup", {
    name: "Z",
    email: "z173@test.local",
    password: MDP,
    role: "RH",
    code: "PAIESAGE-2026",
  });
  check("POST /api/auth/signup → 404 (route supprimée)", signupApi.status === 404, `status=${signupApi.status}`);
  const page = await fetch(BASE + "/signup", { redirect: "manual" });
  check("Page /signup absente (307/404, PAS 200)", page.status !== 200, `status=${page.status}`);

  // ------------------------------------------------------------------
  // 11) NETTOYAGE VÉRIFIÉ
  // ------------------------------------------------------------------
  console.log("-- Nettoyage --");
  const delIt = await sup.del(`/api/users/${uIt.id}`);
  const delRh = await sup.del(`/api/users/${uRh.id}`);
  check("Suppression des comptes de test (superadmin)", delIt.status === 200 && delRh.status === 200);
  const dFiches = await db.payslip.deleteMany({ where: { fileName: { in: ["e2e-173-a.pdf", "e2e-173-b.pdf"] } } });
  const dAcces = await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  // (Task 231) le compte de test TEMPORAIRE utilisé pour la connexion
  // (lab-e2e-116, créé par creer-compte-e2e-116) est supprimé aussi.
  try {
    await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp("lab-e2e-116@autorh.local", true) } });
  } catch {}
  check(`Fiches de test supprimées (deleted=${dFiches.count})`, dFiches.count === 2);
  check(`Accès de test supprimé (deleted=${dAcces.count})`, dAcces.count === 1);
  const resteUsers = await db.user.count();
  const resteFiches = await db.payslip.count({ where: { cinIndex } });
  const resteAcces = await db.portalAccess.count({ where: { cin: cinDet } });
  check("Base rendue à l'état initial (1 compte, 0 fiche/accès test)", resteUsers === 1 && resteFiches === 0 && resteAcces === 0, `users=${resteUsers} fiches=${resteFiches} acces=${resteAcces}`);

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/diag-nettoyage-116.cjs"], { stdio: "ignore" }); } catch {}
  process.exitCode = KO === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("ERREUR FATALE:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
