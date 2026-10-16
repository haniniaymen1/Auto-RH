#!/usr/bin/env node
/**
 * Task 176 — PREUVE E2E « Retrait au rôle IT de la configuration du tampon
 * et de la signature électronique ».
 *
 * Vérifie contre l'administration réelle (port 4000) :
 *   IT          : GET/PUT/POST /api/signature-config → 403 avec le code
 *                 FONCTIONNALITE_NON_AUTORISEE_IT (refusIT) ; SMTP conservé
 *                 (GET /api/mail-config → 200 — non-régression Task 173) ;
 *   RH          : signature électronique CONSERVÉE (GET 200 + tamponActif,
 *                 PUT 200 réécrivant la configuration à l'identique sans
 *                 toucher aux images, aperçu tamponné POST → 200 PDF) ;
 *   SUPERADMIN  : GET 200 (accès complet conservé).
 *
 * Aucune donnée persistante semée (comptes de test créés puis supprimés ;
 * la configuration du tampon est réécrite à l'identique).
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme start-prod.js) -----------------------------
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");

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

/** Client HTTP minimal avec cookie de session ; req() pour le JSON,
 *  reqBrut() pour les réponses binaires (aperçu PDF tamponné). */
function client() {
  let cookie = "";
  async function entetes() {
    return { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) };
  }
  return {
    async req(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: await entetes(),
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* page HTML, PDF ou vide */
      }
      return { status: res.status, json, headers: res.headers };
    },
    async reqBrut(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: await entetes(),
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const tampon = Buffer.from(await res.arrayBuffer());
      return { status: res.status, tampon, headers: res.headers };
    },
    get(p) {
      return this.req("GET", p);
    },
    post(p, b) {
      return this.req("POST", p, b);
    },
    postBrut(p, b) {
      return this.reqBrut("POST", p, b);
    },
    put(p, b) {
      return this.req("PUT", p, b);
    },
    del(p) {
      return this.req("DELETE", p);
    },
  };
}

async function main() {
  console.log("== Task 176 — preuve E2E (tampon / signature électronique retirés à l'IT) ==");

  // ------------------------------------------------------------------
  // 1) Connexion superadministrateur + création des comptes de test
  // ------------------------------------------------------------------
  const sup = client();
  const it = client();
  const rh = client();

  let loginSup = await sup.post("/api/auth/login", {
    email: "superadmin@autorh.local",
    password: "AutoRH-2026!Verif#1",
  });
  if (loginSup.status !== 200) {
    loginSup = await sup.post("/api/auth/login", {
      email: "superadmin@autorh.local",
      password: "AutoRH-2026!Verif",
    });
  }
  check("Connexion superadministrateur", loginSup.status === 200, `status=${loginSup.status}`);

  const MDP = "Test-176!Pass";
  const creerIt = await sup.post("/api/users", {
    name: "IT Task176",
    email: "it-task176@test.local",
    password: MDP,
    role: "IT",
  });
  check("Superadmin crée un compte IT", [200, 201].includes(creerIt.status), `status=${creerIt.status} ${JSON.stringify(creerIt.json ?? {})}`);
  const creerRh = await sup.post("/api/users", {
    name: "RH Task176",
    email: "rh-task176@test.local",
    password: MDP,
    role: "RH",
  });
  check("Superadmin crée un compte RH", [200, 201].includes(creerRh.status), `status=${creerRh.status}`);

  const liste0 = await sup.get("/api/users");
  const uIt = (liste0.json?.users ?? []).find((u) => u.email === "it-task176@test.local");
  const uRh = (liste0.json?.users ?? []).find((u) => u.email === "rh-task176@test.local");
  check("Comptes de test présents dans la liste", Boolean(uIt && uRh));

  const loginIt = await it.post("/api/auth/login", {
    email: "it-task176@test.local",
    password: MDP,
  });
  const loginRh = await rh.post("/api/auth/login", {
    email: "rh-task176@test.local",
    password: MDP,
  });
  check("Connexion IT", loginIt.status === 200, `status=${loginIt.status}`);
  check("Connexion RH", loginRh.status === 200, `status=${loginRh.status}`);

  // (CORRECTIF Task 244 — alignement sur la politique Task 64) le mot de
  // passe fixé par le SuperAdmin est PROVISOIRE : changement OBLIGATOIRE à
  // la première connexion, avant tout autre appel API (sinon toutes les
  // routes répondent 403 MOT_DE_PASSE_EXPIRE et le reste du test est
  // inopérant). Les comptes créés via POST /api/users sont ANTIDATÉS.
  const MDP_IT2 = "Test-176!PassIT+2";
  const MDP_RH2 = "Test-176!PassRH+2";
  const chgIt = await it.post("/api/auth/change-password", {
    currentPassword: MDP,
    newPassword: MDP_IT2,
  });
  check(
    "IT : changement de mot de passe obligatoire à la 1re connexion",
    chgIt.status === 200,
    `status=${chgIt.status} ${JSON.stringify(chgIt.json ?? {}).slice(0, 160)}`
  );
  const chgRh = await rh.post("/api/auth/change-password", {
    currentPassword: MDP,
    newPassword: MDP_RH2,
  });
  check(
    "RH : changement de mot de passe obligatoire à la 1re connexion",
    chgRh.status === 200,
    `status=${chgRh.status} ${JSON.stringify(chgRh.json ?? {}).slice(0, 160)}`
  );

  // ------------------------------------------------------------------
  // 2) IT — tampon / signature électronique : REFUSÉS (403 refusIT)
  // ------------------------------------------------------------------
  console.log("-- IT : tampon / signature électronique refusés --");
  const itGet = await it.get("/api/signature-config");
  check("IT GET /api/signature-config → 403", itGet.status === 403, `status=${itGet.status}`);
  check(
    "IT GET → code FONCTIONNALITE_NON_AUTORISEE_IT",
    itGet.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT",
    JSON.stringify(itGet.json ?? {}).slice(0, 200)
  );
  check(
    "IT GET → message explicite (tampon/signature réservés RH + superadmin)",
    String(itGet.json?.error ?? "").includes("tampon et de la signature"),
    JSON.stringify(itGet.json ?? {}).slice(0, 200)
  );
  const itPut = await it.put("/api/signature-config", { actif: false, sigActif: false });
  check("IT PUT /api/signature-config → 403", itPut.status === 403, `status=${itPut.status}`);
  check(
    "IT PUT → code FONCTIONNALITE_NON_AUTORISEE_IT",
    itPut.json?.code === "FONCTIONNALITE_NON_AUTORISEE_IT",
    JSON.stringify(itPut.json ?? {}).slice(0, 200)
  );
  const itApercu = await it.postBrut("/api/signature-config", { action: "apercu" });
  check("IT POST aperçu tamponné → 403", itApercu.status === 403, `status=${itApercu.status}`);

  // Non-régression : le SMTP reste la fonctionnalité technique de l'IT
  const itMail = await it.get("/api/mail-config");
  check("Non-régression : IT GET /api/mail-config → 200 (SMTP conservé)", itMail.status === 200, `status=${itMail.status}`);

  // ------------------------------------------------------------------
  // 3) RH — la configuration du tampon reste ENTIÈRE (consulter + modifier)
  // ------------------------------------------------------------------
  console.log("-- RH : tampon / signature électronique conservés --");
  const rhGet = await rh.get("/api/signature-config");
  check("RH GET /api/signature-config → 200", rhGet.status === 200, `status=${rhGet.status}`);
  check(
    "RH GET → configuration complète + état tamponActif",
    typeof rhGet.json?.config?.sigTaille === "number" && typeof rhGet.json?.tamponActif === "boolean",
    JSON.stringify(rhGet.json ?? {}).slice(0, 160)
  );
  const cfgAvant = rhGet.json?.config ?? {};

  // Réécriture À L'IDENTIQUE sans les images (champs absents → inchangées) :
  // prouve le droit d'ÉCRITURE du RH sans toucher aux copies de contrôle.
  const { sigImage, qrImage, ...cfgReecrire } = cfgAvant;
  const rhPut = await rh.put("/api/signature-config", cfgReecrire);
  check("RH PUT /api/signature-config → 200 (réécriture à l'identique)", rhPut.status === 200, `status=${rhPut.status} ${JSON.stringify(rhPut.json ?? {}).slice(0, 120)}`);
  const rhGet2 = await rh.get("/api/signature-config");
  const cfgApres = rhGet2.json?.config ?? {};
  check(
    "Persistance : configuration inchangée après la réécriture",
    cfgApres.actif === cfgAvant.actif &&
      cfgApres.sigActif === cfgAvant.sigActif &&
      cfgApres.qrActif === cfgAvant.qrActif &&
      cfgApres.sigTexte === cfgAvant.sigTexte &&
      cfgApres.sigImage === cfgAvant.sigImage,
    "delta config après PUT"
  );

  const rhApercu = await rh.postBrut("/api/signature-config", { action: "apercu", ...cfgAvant });
  const mimeApercu = String(rhApercu.headers?.get("content-type") ?? "");
  check(
    "RH POST aperçu tamponné → 200 (PDF ou image)",
    rhApercu.status === 200 && (mimeApercu.includes("pdf") || mimeApercu.includes("image")),
    `status=${rhApercu.status} mime=${mimeApercu}`
  );
  check(
    "Aperçu : contenu binaire non vide",
    rhApercu.tampon?.length > 500,
    `taille=${rhApercu.tampon?.length ?? 0}`
  );

  // ------------------------------------------------------------------
  // 4) SUPERADMIN — accès complet conservé
  // ------------------------------------------------------------------
  console.log("-- Superadmin : accès complet conservé --");
  const supGet = await sup.get("/api/signature-config");
  check("SUPERADMIN GET /api/signature-config → 200", supGet.status === 200, `status=${supGet.status}`);

  // ------------------------------------------------------------------
  // 5) NETTOYAGE VÉRIFIÉ
  // ------------------------------------------------------------------
  console.log("-- Nettoyage --");
  const delIt = await sup.del(`/api/users/${uIt.id}`);
  const delRh = await sup.del(`/api/users/${uRh.id}`);
  check("Suppression des comptes de test (superadmin)", delIt.status === 200 && delRh.status === 200, `it=${delIt.status} rh=${delRh.status}`);
  const resteUsers = await db.user.count();
  check("Base rendue à l'état initial (1 compte)", resteUsers === 1, `users=${resteUsers}`);

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  process.exitCode = KO === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("ERREUR FATALE:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
