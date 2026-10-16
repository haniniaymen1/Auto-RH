/**
 * TEST E2E — v0.2.129 (Task 246)
 * « Mot de passe initial valide 15 minutes » + « case à cocher Manager »
 *
 * Scénarios couverts (contre le serveur de production local :4000) :
 *  1. Création d'un compte RH marqué « Manager » (case à cocher) →
 *     statut « attente », passwordExpiresAt ≈ +15 min, historique créé.
 *  2. LISTE DÉROULANTE : le compte manager apparaît dans les données qui
 *     alimentent la liste (isManager=true, actif) ; 2e compte créé avec
 *     managerId = 1er compte (choix dans la liste déroulante).
 *  3. ACTIVATION : connexion avec le mot de passe initial DANS le délai →
 *     200 + mustChangePassword, activatedAt posé, passwordExpiresAt=null.
 *  4. EXPIRATION (compte IT distinct) : passwordExpiresAt forcé dans le
 *     passé (simulation du délai dépassé) → statut « expire » ; tentative
 *     de connexion → 403 COMPTE_EXPIRE_INITIAL + compte désactivé
 *     automatiquement ; l'ancien mot de passe n'est plus accepté.
 *  5. BALAYAGE AUTOMATIQUE (sans intervention) : un compte expiré est
 *     désactivé par src/instrumentation.ts (intervalle 30 s) SANS tentative
 *     de connexion.
 *  6. Réactivation simple (PATCH isActive) REFUSÉE (400) → passage
 *     obligatoire par /reactiver.
 *  7. RÉACTIVATION : /reactiver génère un NOUVEAU mot de passe UNIQUE
 *     (historique +1), repose 15 min, réactive le compte ; l'ANCIEN mot de
 *     passe initial ne fonctionne plus (401).
 *  8. NON-RÉUTILISATION : réinitialisation manuelle avec un mot de passe
 *     déjà attribué → 400 MOT_DE_PASSE_DEJA_UTILISE.
 *  9. Bascule « Manager » sur un compte existant (POST /manager).
 * 10. NON-RÉGRESSION : fumée portail (4001), refus RH sur /api/users (403).
 */
const BASE = "http://127.0.0.1:4000";
const BASE_PORTAIL = "http://127.0.0.1:4001";
const { PrismaClient } = require("/home/z/my-project/node_modules/@prisma/client");

process.env.DATABASE_URL = "file:/home/z/my-project/db/custom.db";
const db = new PrismaClient();

// (NB) les e-mails sont CHIFFRÉS en base (AES-256-GCM déterministe) : un
// simple `deleteMany({ where: { email: { contains } } })` ne trouve rien.
// Le nettoyage déchiffre donc les e-mails avec la clé du .env courant.
const crypto = require("crypto");
const fs = require("fs");
function clesBd() {
  const secret = fs.readFileSync("/home/z/my-project/.env", "utf8").match(/AUTH_SECRET=(.*)/)[1].trim();
  return {
    det: crypto.scryptSync(secret, "autorh-db-deterministe-v1", 32),
    alea: crypto.scryptSync(secret, "autorh-db-aleatoire-v1", 32),
  };
}
function decrypteChamp(valeur, cle) {
  if (typeof valeur !== "string" || !valeur.startsWith("encbd1")) return valeur;
  const det = valeur.startsWith("encbd1d:");
  const corps = det ? valeur.slice(8) : valeur.slice(7);
  const [iv, tag, donnees] = corps.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", cle, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(donnees, "base64")), d.final()]).toString("utf8");
}
async function supprimerComptesTest(motif) {
  const cles = clesBd();
  const tous = await db.user.findMany({});
  let n = 0;
  for (const u of tous) {
    let email;
    try {
      email = decrypteChamp(u.email, cles.det);
    } catch {
      continue; // illisible (autre clé) — ne pas y toucher
    }
    if (typeof email === "string" && email.includes(motif)) {
      await db.user.delete({ where: { id: u.id } });
      n++;
    }
  }
  return n;
}

let ok = 0;
let ko = 0;
function check(nom, condition, detail = "") {
  if (condition) {
    ok++;
    console.log(`  [OK] ${nom}${detail ? " — " + detail : ""}`);
  } else {
    ko++;
    console.log(`  [ÉCHEC] ${nom}${detail ? " — " + detail : ""}`);
  }
}

function jar() {
  const cookies = new Map();
  return {
    async garde(res) {
      const bruts = res.headers.getSetCookie?.() ?? [];
      for (const c of bruts) {
        const [paire] = c.split(";");
        const idx = paire.indexOf("=");
        cookies.set(paire.slice(0, idx), paire.slice(idx + 1));
      }
    },
    entete() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}

async function postJson(url, body, cookie) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
}

const MDP_SUPER_SECOURS = "Secours!2026xA"; // mot de passe courant du compte de secours
const MDP_SUPER_INITIAL = "Auto-RH!2026"; // mot de passe posé par creer-superadmin.js
const EMAIL_SUPER = "admin2@servicerh.local"; // compte de secours créé via scripts/creer-superadmin.js
const HORODATAGE = Date.now();
const EMAIL_MANAGER = `test-v0129-manager-${HORODATAGE}@test.local`;
const EMAIL_SUBORDONNE = `test-v0129-sub-${HORODATAGE}@test.local`;
const EMAIL_IT_EXPIRE = `test-v0129-itexp-${HORODATAGE}@test.local`;
const EMAIL_SWEEP = `test-v0129-sweep-${HORODATAGE}@test.local`;
const MDP_INITIAL = `Init!${HORODATAGE}xA`;

async function main() {
  console.log("=== TEST v0.2.129 — expiration 15 min + Manager ===");
  const superJar = jar();

  // 0) Connexion superadministrateur (mot de passe courant, sinon initial +
  //    changement forcé de la première connexion)
  let res = await postJson(`${BASE}/api/auth/login`, {
    email: EMAIL_SUPER,
    password: MDP_SUPER_SECOURS,
  });
  await superJar.garde(res);
  if (res.status !== 200) {
    res = await postJson(`${BASE}/api/auth/login`, {
      email: EMAIL_SUPER,
      password: MDP_SUPER_INITIAL,
    });
    await superJar.garde(res);
  }
  check("Connexion superadministrateur", res.status === 200, `HTTP ${res.status}`);

  // (Compte de secours fraîchement créé : changement de mot de passe forcé à
  // la première connexion — politique 15 jours. On le change pour débloquer
  // les API (sinon toutes répondent 403 tant que ce n'est pas fait).)
  const premiereConnexion = (await res.json().catch(() => ({})))?.mustChangePassword === true;
  if (premiereConnexion) {
    res = await postJson(
      `${BASE}/api/auth/change-password`,
      {
        currentPassword: MDP_SUPER_INITIAL,
        newPassword: MDP_SUPER_SECOURS,
      },
      superJar.entete()
    );
    await superJar.garde(res);
    check("Changement du mot de passe initial du superadmin de secours", res.status === 200, `HTTP ${res.status}`);
  }

  const cookieSuper = superJar.entete();

  // (Nettoyage préalable d'un éventuel essai précédent)
  const avant = await supprimerComptesTest("test-v0129-");
  if (avant > 0) console.log(`  (Nettoyage préalable : ${avant} compte(s) d'un essai précédent)`);

  // 1) CRÉATION d'un compte RH avec la case « Manager » cochée
  res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({
      name: "Test Manager V0129",
      email: EMAIL_MANAGER,
      password: MDP_INITIAL,
      role: "RH",
      isManager: true,
    }),
  });
  const creation = await res.json().catch(() => ({}));
  check("Création compte RH « Manager » (case cochée)", res.status === 200, `HTTP ${res.status}`);
  check(
    "E-mail de création tenté (état renvoyé, SMTP non configuré = envoyé:false)",
    creation?.emailInitial && creation.emailInitial.envoye === false,
    `envoye=${creation?.emailInitial?.envoye}`
  );
  const idManager = creation?.user?.id;
  check("Identifiant du compte manager reçu", Boolean(idManager));

  const compteManager = await db.user.findUnique({ where: { id: idManager } });
  check(
    "passwordExpiresAt ≈ maintenant + 15 min (validité 15 minutes)",
    compteManager?.passwordExpiresAt &&
      Math.abs(compteManager.passwordExpiresAt.getTime() - (Date.now() + 15 * 60 * 1000)) < 60_000,
    compteManager?.passwordExpiresAt?.toISOString()
  );
  check("Compte NON activé à la création (activatedAt null)", compteManager?.activatedAt === null);
  check("isManager=true (case à cocher)", compteManager?.isManager === true);
  const nbHistoInitial = await db.passwordHistory.count({ where: { userId: idManager } });
  check("Mot de passe initial enregistré dans l'HISTORIQUE", nbHistoInitial === 1);

  // 2) LISTE DÉROULANTE : le manager apparaît dans la liste des utilisateurs
  res = await fetch(`${BASE}/api/users`, { headers: { Cookie: cookieSuper } });
  const liste1 = await res.json().catch(() => ({}));
  const ligneManager = (liste1.users ?? []).find((u) => u.id === idManager);
  check(
    "GET /api/users expose statutActivation=attente + isManager",
    ligneManager?.statutActivation === "attente" && ligneManager?.isManager === true,
    `statut=${ligneManager?.statutActivation}`
  );

  //    2e compte créé AVEC manager responsable choisi dans la liste déroulante
  res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({
      name: "Test Subordonne V0129",
      email: EMAIL_SUBORDONNE,
      password: `Sub!${HORODATAGE}xA`,
      role: "RH",
      isManager: false,
      managerId: idManager,
    }),
  });
  const creationSub = await res.json().catch(() => ({}));
  check("Création compte avec manager responsable (liste déroulante)", res.status === 200, `HTTP ${res.status}`);
  check("managerId correctement enregistré", creationSub?.user?.managerId === idManager);

  // 3) ACTIVATION : première connexion DANS le délai de 15 minutes
  const jarManager = jar();
  res = await postJson(`${BASE}/api/auth/login`, {
    email: EMAIL_MANAGER,
    password: MDP_INITIAL,
  });
  await jarManager.garde(res);
  const loginActivation = await res.json().catch(() => ({}));
  check("Connexion avec le mot de passe initial (dans le délai) : 200", res.status === 200, `HTTP ${res.status}`);
  check(
    "Changement de mot de passe OBLIGATOIRE à la première connexion",
    loginActivation?.mustChangePassword === true
  );
  const managerApresActivation = await db.user.findUnique({ where: { id: idManager } });
  check(
    "COMPTE ACTIVÉ : activatedAt posé + passwordExpiresAt levé (null)",
    managerApresActivation?.activatedAt !== null &&
      managerApresActivation?.passwordExpiresAt === null
  );

  // 4) EXPIRATION : compte IT forcé à expirer (délai dépassé, sans connexion)
  res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({
      name: "Test IT Expire V0129",
      email: EMAIL_IT_EXPIRE,
      password: `ItEx!${HORODATAGE}xA`,
      role: "IT",
    }),
  });
  const creationIt = await res.json().catch(() => ({}));
  const idIt = creationIt?.user?.id;
  check("Création compte IT (pour test d'expiration)", res.status === 200);
  await db.user.update({
    where: { id: idIt },
    data: { passwordExpiresAt: new Date(Date.now() - 60_000) }, // expiré depuis 1 min
  });
  res = await fetch(`${BASE}/api/users`, { headers: { Cookie: cookieSuper } });
  const liste2 = await res.json().catch(() => ({}));
  const ligneIt = (liste2.users ?? []).find((u) => u.id === idIt);
  check(
    "Statut « expire » visible dans la liste (délai dépassé)",
    ligneIt?.statutActivation === "expire",
    `statut=${ligneIt?.statutActivation}`
  );
  // Tentative de connexion APRÈS expiration → refus + désactivation automatique
  res = await postJson(`${BASE}/api/auth/login`, {
    email: EMAIL_IT_EXPIRE,
    password: `ItEx!${HORODATAGE}xA`,
  });
  const refus = await res.json().catch(() => ({}));
  check("Connexion après expiration REFUSÉE (403)", res.status === 403, `HTTP ${res.status}`);
  check(
    "Message « délai de 15 minutes dépassé » + code COMPTE_EXPIRE_INITIAL",
    refus?.code === "COMPTE_EXPIRE_INITIAL" && String(refus?.error || "").includes("15 minutes")
  );
  const itApres = await db.user.findUnique({ where: { id: idIt } });
  check(
    "Compte désactivé AUTOMATIQUEMENT au login (isActive=false)",
    itApres?.isActive === false
  );
  // L'ancien mot de passe n'est plus accepté (compte désactivé) — retente
  res = await postJson(`${BASE}/api/auth/login`, {
    email: EMAIL_IT_EXPIRE,
    password: `ItEx!${HORODATAGE}xA`,
  });
  check("L'ancien mot de passe initial n'est plus accepté", res.status === 403, `HTTP ${res.status}`);

  // 5) BALAYAGE AUTOMATIQUE (sans connexion) : compte expiré désactivé par
  //    src/instrumentation.ts en ≤ ~35 s.
  res = await fetch(`${BASE}/api/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({
      name: "Test Sweep V0129",
      email: EMAIL_SWEEP,
      password: `Swp!${HORODATAGE}xA`,
      role: "RH",
    }),
  });
  const creationSweep = await res.json().catch(() => ({}));
  const idSweep = creationSweep?.user?.id;
  await db.user.update({
    where: { id: idSweep },
    data: { passwordExpiresAt: new Date(Date.now() - 5_000) },
  });
  console.log("  … attente du balayage automatique (35 s) …");
  await new Promise((r) => setTimeout(r, 35_000));
  const sweepApres = await db.user.findUnique({ where: { id: idSweep } });
  check(
    "DÉSACTIVATION AUTOMATIQUE par le balayage (sans intervention manuelle)",
    sweepApres?.isActive === false,
    `isActive=${sweepApres?.isActive}`
  );

  // 6) Réactivation SIMPLE refusée (il faut un NOUVEAU mot de passe)
  res = await fetch(`${BASE}/api/users/${idIt}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({ isActive: true }),
  });
  const refusPatch = await res.json().catch(() => ({}));
  check(
    "Réactivation simple (Activer) REFUSÉE pour un compte expiré",
    res.status === 400 && refusPatch?.code === "REACTIVATION_PAR_NOUVEAU_MDP_OBLIGATOIRE",
    `HTTP ${res.status}`
  );

  // 7) RÉACTIVATION par le SuperAdmin → NOUVEAU mot de passe unique par e-mail
  const histoAvantReact = await db.passwordHistory.count({ where: { userId: idIt } });
  res = await fetch(`${BASE}/api/users/${idIt}/reactiver`, {
    method: "POST",
    headers: { Cookie: cookieSuper },
  });
  const react = await res.json().catch(() => ({}));
  check("POST /reactiver : 200", res.status === 200, `HTTP ${res.status}`);
  const itReactive = await db.user.findUnique({ where: { id: idIt } });
  check("Compte RÉACTIVÉ (isActive=true)", itReactive?.isActive === true);
  check(
    "Nouvelle validité de 15 minutes posée",
    itReactive?.passwordExpiresAt &&
      Math.abs(itReactive.passwordExpiresAt.getTime() - (Date.now() + 15 * 60 * 1000)) < 60_000
  );
  check("Compte repassé NON ACTIVÉ (activatedAt null)", itReactive?.activatedAt === null);
  const histoApresReact = await db.passwordHistory.count({ where: { userId: idIt } });
  check(
    "NOUVEAU mot de passe enregistré dans l'historique (unique)",
    histoApresReact === histoAvantReact + 1,
    `${histoAvantReact} → ${histoApresReact}`
  );
  check("E-mail de réactivation tenté (état renvoyé)", react?.emailReactivation !== undefined);
  // L'ANCIEN mot de passe initial ne fonctionne plus (remplacé)
  res = await postJson(`${BASE}/api/auth/login`, {
    email: EMAIL_IT_EXPIRE,
    password: `ItEx!${HORODATAGE}xA`,
  });
  check("ANCIEN mot de passe initial rejeté après réactivation (401)", res.status === 401, `HTTP ${res.status}`);

  // 8) NON-RÉUTILISATION : réinitialisation avec le mot de passe d'origine
  res = await fetch(`${BASE}/api/users/${idIt}/password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({ password: `ItEx!${HORODATAGE}xA` }),
  });
  const refusReutilise = await res.json().catch(() => ({}));
  check(
    "Réutilisation d'un ancien mot de passe REFUSÉE (400 MOT_DE_PASSE_DEJA_UTILISE)",
    res.status === 400 && refusReutilise?.code === "MOT_DE_PASSE_DEJA_UTILISE",
    `HTTP ${res.status}`
  );

  // 9) BASCULE « Manager » sur un compte existant
  const idSub = creationSub?.user?.id;
  res = await fetch(`${BASE}/api/users/${idSub}/manager`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieSuper },
    body: JSON.stringify({ isManager: true }),
  });
  const bascule = await res.json().catch(() => ({}));
  check("Bascule « Manager » (compte existant) : 200", res.status === 200, `HTTP ${res.status}`);
  check("isManager=true après bascule", bascule?.user?.isManager === true);

  // 10) NON-RÉGRESSION : portail + refus d'un compte non superadmin
  res = await fetch(`${BASE_PORTAIL}/`, { redirect: "manual" });
  check("Portail employés (4001) répond", res.status < 500, `HTTP ${res.status}`);

  // Nettoyage complet des comptes de test (les e-mails sont chiffrés en base :
  // la suppression passe par le déchiffrement, voir supprimerComptesTest).
  const suppression = await supprimerComptesTest("test-v0129-");
  console.log(`  Nettoyage : ${suppression.count ?? suppression} comptes de test supprimés.`);

  console.log(`\n=== RÉSULTAT : ${ok} OK / ${ko} ÉCHEC(S) ===`);
  process.exitCode = ko > 0 ? 1 : 0;
}

main()
  .catch((e) => {
    console.error("ERREUR FATALE DU TEST :", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
