#!/usr/bin/env node
/**
 * Task 174 — PREUVE E2E « Attestations sans formulaire + e-mail d'accès ».
 *
 * Vérifie contre le portail réel (4001) et l'administration réelle (4000) :
 *   A) RESTAURATION — le portail (4001) embarque À NOUVEAU la rubrique
 *      « Demandes administratives » (régression détectée : le fichier
 *      restauré de la Task 173 datait d'avant la Task 116) ;
 *   B) ATTESTATIONS SANS FORMULAIRE :
 *        - la page /demandes n'a PLUS aucun champ de saisie employé pour les
 *          attestations (ni nom, ni prénom, ni e-mail) — seulement un
 *          affichage LECTURE SEULE du nom auto + le bouton « Envoyer » ;
 *        - POST /api/demandes {type: ATTESTATION_TRAVAIL} SANS aucun champ :
 *          la demande est créée et le nom vient AUTOMATIQUEMENT du Portail
 *          Administration (PortalAccess.nomPrenom posé par le RH) ;
 *        - tout champ envoyé par le client (nom/prenom/emailEmploye) est
 *          IGNORÉ côté serveur ;
 *        - sans nomPrenom sur l'accès : repli automatique sur le nom de
 *          référence des fiches de paie du CIN (règle de fréquence) ;
 *        - l'e-mail de notification : adresse du compte portail, sinon la
 *          dernière adresse d'envoi du mot de passe initial (mailEnvoyeA) ;
 *   C) COLONNE « E-MAIL D'ACCÈS » (administration) : GET /api/portal-access
 *      expose mailEnvoyeA = EXACTEMENT l'adresse utilisée pour l'envoi du
 *      mot de passe initial (enregistrée sur le compte de l'employé).
 *
 * Nettoyage complet vérifié (demandes, fiches et accès semés).
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme start-prod.js) -----------------------------
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const crypto = require("crypto");

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";

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

/** Client HTTP minimal avec cookie de session. */
function client(base) {
  let cookie = "";
  return {
    async req(method, path, body) {
      const res = await fetch(base + path, {
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
      const brut = await res.text();
      let json = null;
      try {
        json = JSON.parse(brut);
      } catch {
        /* page HTML ou vide */
      }
      return { status: res.status, json, texte: json ? "" : brut };
    },
    get(p) {
      return this.req("GET", p);
    },
    post(p, b) {
      return this.req("POST", p, b);
    },
  };
}

/** TOTP RFC 6238 (6 chiffres, 30 s, SHA1) — même algorithme que le portail. */
function totpNow(base32) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32) {
    const v = A.indexOf(c.toUpperCase());
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, "0");
  }
  const octets = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) octets.push(parseInt(bits.slice(i, i + 8), 2));
  const cle = Buffer.from(octets);
  const compteur = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(compteur / 2 ** 32), 0);
  buf.writeUInt32BE(compteur >>> 0, 4);
  const hmac = crypto.createHmac("sha1", cle).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) %
    1e6;
  return String(code).padStart(6, "0");
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

const CIN_TEST = "TEST17401";
const NOM_AUTO_RH = "Ben Salah Mohamed";
const NOM_FICHES = "Trabelsi Ali";
const EMAIL_COMPTE = "employe174@test.tn";
const EMAIL_ENVOI = "rh-envoi174@test.tn";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP_PORTAIL = "Test-174!Pass";
const FICHIERS = ["e2e-174-a.pdf", "e2e-174-b.pdf"];

async function main() {
  console.log("== Task 174 — preuve E2E ==");

  // ------------------------------------------------------------------
  // 0) SÉME : 2 fiches (nom de référence) + 1 accès portail COMPLET
  //    (mot de passe, secret TOTP définitif, nomPrenom posé par le RH,
  //    e-mail de compte + dernière adresse d'envoi du mot de passe).
  // ------------------------------------------------------------------
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.payslip.createMany({
    data: [
      {
        fileName: FICHIERS[0],
        storedName: FICHIERS[0],
        fileSize: 100,
        content: "FICHE DE PAIE " + CIN_TEST,
        normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST,
        cinIndex: cinDet,
        employeeName: NOM_FICHES,
        period: "09/2026",
        netSalary: "1 000,00",
      },
      {
        fileName: FICHIERS[1],
        storedName: FICHIERS[1],
        fileSize: 100,
        content: "FICHE DE PAIE " + CIN_TEST,
        normalizedContent: "FICHE DE PAIE " + CIN_TEST,
        cin: CIN_TEST,
        cinIndex: cinDet,
        employeeName: NOM_FICHES,
        period: "10/2026",
        netSalary: "1 000,00",
      },
    ],
  });
  await db.portalAccess.create({
    data: {
      cin: cinDet,
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(Date.now() - 86400000), // inscrit : secret TOTP définitif
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
      nomPrenom: cryptoBd.chiffrerChamp(NOM_AUTO_RH),
      email: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
      mailEnvoyeA: cryptoBd.chiffrerChamp(EMAIL_ENVOI),
      mailEnvoyeLe: new Date(Date.now() - 3600000),
    },
  });
  console.log(`Sémé : 2 fiches (${CIN_TEST} / ${NOM_FICHES}) + 1 accès portail complet.`);

  try {
    // ----------------------------------------------------------------
    // 1) ADMINISTRATION : connexion superadmin + colonne « E-mail d'accès »
    // ----------------------------------------------------------------
    const adm = client(ADMIN);
    // (MODIFIÉ Task 231 — indépendance de l'environnement) connexion via le
    // COMPTE DE TEST TEMPORAIRE (lab226/creer-compte-e2e-116) : le mot de
    // passe du SUPERADMIN RÉEL n'est pas connu des harnesses.
    const { execFileSync } = require("child_process");
    try {
      execFileSync("node", [__dirname + "/lab226/creer-compte-e2e-116.cjs"], { stdio: "ignore" });
    } catch {}
    const COMPTE_231 = JSON.parse(fs.readFileSync("/tmp/lab116-compte.json", "utf8"));
    const loginAdm = await adm.post("/api/auth/login", {
      email: COMPTE_231.email,
      password: COMPTE_231.password,
    });
    check("Connexion superadministrateur", loginAdm.status === 200, `status=${loginAdm.status}`);

    const acces = await adm.get("/api/portal-access");
    const ligne = (acces.json?.items ?? []).find((x) => x.cin === CIN_TEST);
    check(
      "GET /api/portal-access expose la ligne de l'employé",
      Boolean(ligne),
      "ligne introuvable"
    );
    check(
      "Colonne « E-mail d'accès » : mailEnvoyeA = adresse EXACTE de l'envoi du mot de passe initial",
      ligne && ligne.mailEnvoyeA === EMAIL_ENVOI,
      `mailEnvoyeA=${ligne && ligne.mailEnvoyeA}`
    );
    check(
      "La date du dernier envoi accompagne l'adresse (mailEnvoyeLe)",
      ligne && typeof ligne.mailEnvoyeLe === "string",
      JSON.stringify(ligne && ligne.mailEnvoyeLe)
    );
    check(
      "Colonne « Nom et prénom » toujours alimentée (Task 173)",
      ligne && ligne.nomPrenom === NOM_AUTO_RH,
      `nomPrenom=${ligne && ligne.nomPrenom}`
    );

    // ----------------------------------------------------------------
    // 2) PORTAIL : connexion CIN + mot de passe + code OTP (une étape)
    // ----------------------------------------------------------------
    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST,
      password: MDP_PORTAIL,
      otp: totpNow(SECRET_TOTP),
      remember: false,
    });
    check(
      "Connexion portail complète (CIN + mot de passe + OTP)",
      verif.status === 200 && verif.json?.ok && verif.json?.redirect === "/",
      `status=${verif.status} ${JSON.stringify(verif.json)}`
    );

    // ----------------------------------------------------------------
    // 3) RESTAURATION : la rubrique demandes est de retour sur le portail
    // ----------------------------------------------------------------
    const page = await port.get("/demandes");
    const html = page.texte || "";
    check("Page /demandes servie par le portail (restauration)", page.status === 200 && html.includes("Mes demandes"), `status=${page.status}`);
    check(
      "Attestations : AUCUN champ de saisie « nom » (formulaire supprimé)",
      !html.includes('id="att-travail-nom"') && !html.includes('id="att-salaire-nom"')
    );
    check(
      "Attestations : AUCUN champ de saisie « e-mail » (formulaire supprimé)",
      !html.includes('id="att-travail-email"') && !html.includes('id="att-salaire-email"')
    );
    check(
      // (MODIFIÉ Task 231 — comportement v0.2.92+) les affichages lecture-seule
      // sont remplacés par les sous-titres « Aucune saisie — un seul clic » ;
      // l'identité reste 100 % automatique (aucun champ, aucun affichage saisi).
      "Attestations : « Aucune saisie » + nom automatique + bouton « Envoyer » unique",
      (html.match(/Aucune saisie/g) || []).length >= 2 &&
        html.includes("Votre nom et prénom sont récupérés automatiquement depuis le Portail Administration") &&
        (html.match(/<button type="submit">Envoyer<\/button>/g) || []).length === 2
    );

    // ----------------------------------------------------------------
    // 4) ATTESTATION SANS FORMULAIRE : nom récupéré AUTOMATIQUEMENT
    //    (PortalAccess.nomPrenom posé par le RH) — champs clients IGNORÉS.
    // ----------------------------------------------------------------
    const rep1 = await port.post("/api/demandes", {
      type: "ATTESTATION_TRAVAIL",
      nom: "CHAMP CLIENT IGNORÉ",
      prenom: "CHAMP CLIENT IGNORÉ",
      emailEmploye: "junk@junk.tn",
    });
    check(
      "POST attestation travail SANS formulaire → 201 (demande créée)",
      rep1.status === 201 && rep1.json?.ok,
      `status=${rep1.status} ${JSON.stringify(rep1.json)}`
    );
    const d1 = rep1.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: rep1.json.reference } })
      : null;
    const donnees1 = d1 ? JSON.parse(cryptoBd.dechiffrerChamp(d1.donnees) || "{}") : {};
    check(
      "Nom et prénom récupérés AUTOMATIQUEMENT du Portail Administration (nomPrenom du RH)",
      donnees1.nom === NOM_AUTO_RH && !donnees1.prenom,
      `nom=${donnees1.nom}`
    );
    check(
      "Les champs envoyés par le client sont IGNORÉS (ni nom saisi, ni e-mail saisi)",
      donnees1.nom !== "CHAMP CLIENT IGNORÉ" && d1 && !d1.employeEmail?.includes("junk"),
      JSON.stringify(donnees1)
    );
    check(
      "E-mail de notification = adresse du compte portail (aucune saisie)",
      d1 && (cryptoBd.dechiffrerChamp(d1.employeEmail) || "") === EMAIL_COMPTE,
      d1 ? String(cryptoBd.dechiffrerChamp(d1.employeEmail)) : "demande absente"
    );

    // ----------------------------------------------------------------
    // 5) REPLI AUTOMATIQUE : sans nomPrenom sur l'accès → nom de référence
    //    des fiches de paie du CIN (même règle de fréquence que l'admin).
    // ----------------------------------------------------------------
    await db.portalAccess.update({
      where: { cin: cinDet },
      data: { nomPrenom: null },
    });
    const rep2 = await port.post("/api/demandes", { type: "ATTESTATION_SALAIRE" });
    check(
      "POST attestation salaire sans nomPrenom → 201 (repli fiches de paie)",
      rep2.status === 201 && rep2.json?.ok,
      `status=${rep2.status} ${JSON.stringify(rep2.json)}`
    );
    const d2 = rep2.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: rep2.json.reference } })
      : null;
    const donnees2 = d2 ? JSON.parse(cryptoBd.dechiffrerChamp(d2.donnees) || "{}") : {};
    check(
      "Nom récupéré automatiquement depuis les FICHES DE PAIE du CIN",
      donnees2.nom === NOM_FICHES,
      `nom=${donnees2.nom}`
    );

    // ----------------------------------------------------------------
    // 6) CÔTÉ ADMINISTRATION : les demandes arrivent avec le bon nom
    // ----------------------------------------------------------------
    const listeD = await adm.get("/api/demandes");
    const item1 = (listeD.json?.items ?? []).find((x) => x.reference === rep1.json?.reference);
    const item2 = (listeD.json?.items ?? []).find((x) => x.reference === rep2.json?.reference);
    check(
      "Demande travail visible dans l'administration avec le nom auto",
      item1 && (item1.infos || []).some(([k, v]) => k === "Nom" && v === NOM_AUTO_RH),
      JSON.stringify(item1 && item1.infos)
    );
    check(
      "Demande salaire visible dans l'administration avec le nom des fiches",
      item2 && (item2.infos || []).some(([k, v]) => k === "Nom" && v === NOM_FICHES),
      JSON.stringify(item2 && item2.infos)
    );

    // ----------------------------------------------------------------
    // 7) Interface admin : la colonne « E-mail d'accès » est dans le code
    //    (présence du libellé dans le bundle construit).
    // ----------------------------------------------------------------
    const fs2 = require("fs");
    const path = require("path");
    const dossier = path.join(process.cwd(), ".next", "server");
    let trouve = false;
    (function cherche(dir) {
      if (trouve) return;
      for (const f of fs2.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) cherche(p);
        else if (f.name.endsWith(".js")) {
          try {
            if (fs2.readFileSync(p, "utf8").includes("E-mail d'accès")) {
              trouve = true;
              return;
            }
          } catch {}
        }
      }
    })(dossier);
    check("Colonne « E-mail d'accès » présente dans le bundle admin construit", trouve);
  } finally {
    // ----------------------------------------------------------------
    // 8) NETTOYAGE COMPLET
    // ----------------------------------------------------------------
    const cinDet2 = cryptoBd.chiffrerChamp(CIN_TEST, true);
    const dDem = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet2 } });
    const dFich = await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
    const dAcc = await db.portalAccess.deleteMany({ where: { cin: cinDet2 } });
    const restes = await db.portalAccess.count({ where: { cin: cinDet2 } });
    check(
      "Nettoyage : demandes, fiches et accès de test supprimés",
      dDem.count === 2 && dFich.count === 2 && dAcc.count === 1 && restes === 0,
      `demandes=${dDem.count} fiches=${dFich.count} accès=${dAcc.count}`
    );
    await db.$disconnect();
  }

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);
  // (Task 231) suppression du compte de test temporaire utilisé pour le login
  try { require("child_process").execFileSync("node", [__dirname + "/lab226/diag-nettoyage-116.cjs"], { stdio: "ignore" }); } catch {}
  process.exit(KO ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
