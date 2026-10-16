#!/usr/bin/env node
/**
 * Task 175 — PREUVE E2E « Suppression des champs redondants ».
 *
 * Modules DEMANDES DE CONGÉ, PARRAINAGE et AUTORISATION (DE SORTIE) :
 *   A) FORMULAIRES (portail 4001, page /demandes) :
 *        - plus AUCUN champ « E-mail de l'employé », « Nom », « Prénom » ;
 *        - affichage LECTURE SEULE du nom auto (récupéré du Portail
 *          Administration — section « Accès portail par mot de passe ») ;
 *   B) SERVEUR (POST /api/demandes) :
 *        - tout champ d'identité envoyé par le client est IGNORÉ ;
 *        - nom et prénom récupérés AUTOMATIQUEMENT (PortalAccess.nomPrenom
 *          posé par le RH, sinon nom de référence des fiches de paie) ;
 *        - e-mail de notification résolu automatiquement (compte portail,
 *          sinon DERNIÈRE adresse de l'envoi du mot de passe initial —
 *          mailEnvoyeA) ;
 *        - les validations métier restantes sont conservées (400) ;
 *   C) ADMINISTRATION (4000) :
 *        - les demandes arrivent avec le nom auto (« Nom et prénom ») et,
 *          pour le parrainage, l'e-mail du parrain résolu automatiquement.
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

const CIN_TEST = "TEST17501";
const NOM_AUTO_RH = "Ben Salah Mohamed";
const NOM_FICHES = "Trabelsi Ali";
const EMAIL_COMPTE = "employe175@test.tn";
const EMAIL_ENVOI = "rh-envoi175@test.tn";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const MDP_PORTAIL = "Test-175!Pass";
const FICHIERS = ["e2e-175-a.pdf", "e2e-175-b.pdf"];

async function main() {
  console.log("== Task 175 — preuve E2E (champs redondants supprimés) ==");

  // ------------------------------------------------------------------
  // 0) SÉME : 2 fiches (nom de référence) + 1 accès portail COMPLET
  //    (nomPrenom posé par le RH, e-mail de compte + dernière adresse
  //    d'envoi du mot de passe initial).
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
    // 1) ADMINISTRATION : connexion superadministrateur
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
    let loginAdm = await adm.post("/api/auth/login", {
      email: COMPTE_231.email,
      password: COMPTE_231.password,
    });
    if (loginAdm.status !== 200) {
      loginAdm = await adm.post("/api/auth/login", {
        email: "superadmin@autorh.local",
        password: "AutoRH-2026!Verif#1",
      });
    }
    check("Connexion superadministrateur", loginAdm.status === 200, `status=${loginAdm.status}`);

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
    // 3) FORMULAIRES : plus AUCUN champ redondant (E-mail / Nom / Prénom)
    // ----------------------------------------------------------------
    const page = await port.get("/demandes");
    const html = page.texte || "";
    check("Page /demandes servie par le portail", page.status === 200 && html.includes("Mes demandes"), `status=${page.status}`);
    check(
      "CONGÉ : champ « E-mail de l'employé » SUPPRIMÉ",
      !html.includes('id="conge-email"')
    );
    check(
      "AUTORISATION : champs « Nom », « Prénom » et « E-mail » SUPPRIMÉS",
      !html.includes('id="sortie-nom"') &&
        !html.includes('id="sortie-prenom"') &&
        !html.includes('id="sortie-email"')
    );
    check(
      "PARRAINAGE : champs « Nom et prénom du parrain » et « E-mail du parrain » SUPPRIMÉS",
      !html.includes('id="parr-nom"') && !html.includes('id="parr-email"')
    );
    check(
      // (MODIFIÉ Task 231 — comportement v0.2.92+) les affichages lecture-seule
      // sont remplacés par les sous-titres « récupérés automatiquement » ;
      // AUCUN champ de saisie identité n'existe plus dans les 3 panneaux.
      "AUTORISATION + PARRAINAGE : identité automatique (sous-titres) et AUCUN champ de saisie",
      html.includes("récupérés automatiquement depuis le Portail Administration") &&
        !html.includes('id="sortie-nom"') &&
        !html.includes('id="parr-nom"') &&
        !html.includes('id="parr-email"')
    );
    check(
      "NON-RÉGRESSION attestations (Task 174) : « Aucune saisie — un seul bouton Envoyer »",
      (html.match(/Aucune saisie/g) || []).length >= 2 &&
        (html.match(/<button type="submit">Envoyer<\/button>/g) || []).length === 2
    );
    check(
      // (MODIFIÉ Task 231 — v0.2.88/92+) le parrainage n'a plus de N+1 et
      // l'autorisation porte le Responsable N+1 (e-mail) au lieu du département.
      "NON-RÉGRESSION : champs métier restants intacts (N+1 congé, responsable sortie, filleul)",
      html.includes('id="conge-n1"') &&
        html.includes('id="parr-filleul"') &&
        html.includes('id="sortie-n1"') &&
        html.includes('id="sortie-motif"')
    );

    // ----------------------------------------------------------------
    // 4) CONGÉ : champs d'identité client IGNORÉS, notification automatique
    // ----------------------------------------------------------------
    const repC = await port.post("/api/demandes", {
      type: "CONGE",
      typeConge: "Annuel",
      dateDebut: "2026-11-02",
      dateFin: "2026-11-05",
      emailN1: "n1-175@test.tn",
      commentaire: "Congé annuel planifié.",
      nom: "CHAMP CLIENT IGNORÉ",
      prenom: "CHAMP CLIENT IGNORÉ",
      email: "junk@junk.tn",
    });
    check(
      "POST congé → 201 (demande créée malgré les champs d'identité envoyés)",
      repC.status === 201 && repC.json?.ok,
      `status=${repC.status} ${JSON.stringify(repC.json)}`
    );
    const dC = repC.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: repC.json.reference } })
      : null;
    const dCj = dC ? JSON.parse(cryptoBd.dechiffrerChamp(dC.donnees) || "{}") : {};
    check(
      "CONGÉ : aucune identité stockée dans la demande (ni nom, ni prénom, ni e-mail)",
      dC && !dCj.nom && !dCj.prenom && !dCj.email,
      JSON.stringify(dCj)
    );
    check(
      "CONGÉ : champs métier conservés (type, dates, N+1, commentaire)",
      dCj.typeConge === "Annuel" && dCj.dateDebut === "2026-11-02" && dCj.emailN1 === "n1-175@test.tn",
      JSON.stringify(dCj)
    );
    check(
      "CONGÉ : e-mail de notification = adresse du COMPTE PORTAIL (aucune saisie)",
      dC && (cryptoBd.dechiffrerChamp(dC.employeEmail) || "") === EMAIL_COMPTE,
      dC ? String(cryptoBd.dechiffrerChamp(dC.employeEmail)) : "demande absente"
    );

    // ----------------------------------------------------------------
    // 5) AUTORISATION DE SORTIE : nom auto, client IGNORÉ
    // ----------------------------------------------------------------
    const repS = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE",
      date: "2026-11-03",
      departement: "COMPTABILITE",
      motif: "Rendez-vous bancaire",
      nombreHeures: "2",
      heureSortie: "09:00",
      heureRetour: "11:00",
      compensation: "OUI",
      nom: "CHAMP CLIENT IGNORÉ",
      prenom: "CHAMP CLIENT IGNORÉ",
      email: "junk@junk.tn",
    });
    check(
      "POST autorisation de sortie → 201 (nom/prénom/e-mail envoyés IGNORÉS)",
      repS.status === 201 && repS.json?.ok,
      `status=${repS.status} ${JSON.stringify(repS.json)}`
    );
    const dS = repS.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: repS.json.reference } })
      : null;
    const dSj = dS ? JSON.parse(cryptoBd.dechiffrerChamp(dS.donnees) || "{}") : {};
    check(
      "SORTIE : nom complet récupéré AUTOMATIQUEMENT (nomPrenom posé par le RH)",
      dSj.nom === NOM_AUTO_RH,
      `nom=${dSj.nom}`
    );
    check(
      "SORTIE : plus de prénom ni d'e-mail stockés (anciennes clés supprimées)",
      dS && !dSj.prenom && !dSj.email,
      JSON.stringify(dSj)
    );
    check(
      "SORTIE : e-mail de notification automatique (compte portail)",
      dS && (cryptoBd.dechiffrerChamp(dS.employeEmail) || "") === EMAIL_COMPTE,
      dS ? String(cryptoBd.dechiffrerChamp(dS.employeEmail)) : "demande absente"
    );

    // ----------------------------------------------------------------
    // 6) PARRAINAGE : parrain = employé connecté, identité auto
    // ----------------------------------------------------------------
    const repP = await port.post("/api/demandes", {
      type: "PARRAINAGE",
      emailN1: "n1-175@test.tn",
      dateParrainage: "2026-11-04",
      operation: "OPÉRATION COMMERCIALE",
      nomFilleul: "Karim Filleul",
      telFilleul: "+216 20 111 222",
      nomParrain: "CHAMP CLIENT IGNORÉ",
      emailParrain: "junk@junk.tn",
    });
    check(
      "POST parrainage → 201 (nomParrain/emailParrain envoyés IGNORÉS)",
      repP.status === 201 && repP.json?.ok,
      `status=${repP.status} ${JSON.stringify(repP.json)}`
    );
    const dP = repP.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: repP.json.reference } })
      : null;
    const dPj = dP ? JSON.parse(cryptoBd.dechiffrerChamp(dP.donnees) || "{}") : {};
    check(
      "PARRAINAGE : nom du parrain récupéré AUTOMATIQUEMENT (employé connecté)",
      dPj.nomParrain === NOM_AUTO_RH,
      `nomParrain=${dPj.nomParrain}`
    );
    check(
      "PARRAINAGE : e-mail du parrain = adresse du compte portail (automatique)",
      dPj.emailParrain === EMAIL_COMPTE,
      `emailParrain=${dPj.emailParrain}`
    );
    check(
      // (MODIFIÉ Task 231 — v0.2.92+) l'e-mail du N+1 n'est PLUS DEMANDÉ pour
      // le parrainage : tout emailN1 envoyé par un ancien client est IGNORÉ,
      // le routage est automatique vers l'adresse DÉDIÉE du parrainage.
      "PARRAINAGE : champs métier conservés (date, opération, filleul) + emailN1 ignoré",
      dPj.nomFilleul === "Karim Filleul" && dPj.dateParrainage === "2026-11-04" &&
        dPj.operation === "OPÉRATION COMMERCIALE" && !dPj.emailN1,
      JSON.stringify(dPj)
    );

    // ----------------------------------------------------------------
    // 7) ADMINISTRATION : les demandes arrivent avec l'identité automatique
    //    (jumelle pairesInfosDemande — nouveau format « Nom et prénom »)
    // ----------------------------------------------------------------
    const listeD = await adm.get("/api/demandes");
    const itemS = (listeD.json?.items ?? []).find((x) => x.reference === repS.json?.reference);
    const itemP = (listeD.json?.items ?? []).find((x) => x.reference === repP.json?.reference);
    check(
      "Admin — sortie affichée sous « Nom et prénom » = nom automatique",
      itemS && (itemS.infos || []).some(([k, v]) => k === "Nom et prénom" && v === NOM_AUTO_RH),
      JSON.stringify(itemS && itemS.infos)
    );
    check(
      "Admin — parrainage affiché avec nom + e-mail du parrain AUTOMATIQUES",
      itemP &&
        (itemP.infos || []).some(([k, v]) => k === "Nom et prénom du parrain" && v === NOM_AUTO_RH) &&
        (itemP.infos || []).some(([k, v]) => k === "E-mail du parrain" && v === EMAIL_COMPTE),
      JSON.stringify(itemP && itemP.infos)
    );

    // ----------------------------------------------------------------
    // 8) REPLIS AUTOMATIQUES : sans nomPrenom → fiches de paie ;
    //    sans e-mail de compte → DERNIÈRE adresse du mot de passe initial.
    // ----------------------------------------------------------------
    await db.portalAccess.update({
      where: { cin: cinDet },
      data: { nomPrenom: null, email: null },
    });
    const repS2 = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE",
      date: "2026-11-06",
      departement: "PRODUCTION",
      motif: "Mission externe",
      nombreHeures: "3",
      heureSortie: "08:00",
      heureRetour: "11:00",
      compensation: "NON",
    });
    const dS2 = repS2.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: repS2.json.reference } })
      : null;
    const dS2j = dS2 ? JSON.parse(cryptoBd.dechiffrerChamp(dS2.donnees) || "{}") : {};
    check(
      "SORTIE sans nomPrenom → nom de référence des FICHES DE PAIE (repli auto)",
      dS2j.nom === NOM_FICHES,
      `nom=${dS2j.nom}`
    );
    const repP2 = await port.post("/api/demandes", {
      type: "PARRAINAGE",
      emailN1: "n1-175@test.tn",
      dateParrainage: "2026-11-07",
      operation: "OPÉRATION COMMERCIALE",
      nomFilleul: "Sonia Filleul",
      telFilleul: "+216 20 333 444",
    });
    const dP2 = repP2.json?.reference
      ? await db.demandeAdministrative.findUnique({ where: { reference: repP2.json.reference } })
      : null;
    check(
      "PARRAINAGE sans e-mail de compte → notification = DERNIÈRE adresse du mot de passe initial (mailEnvoyeA)",
      dP2 && (cryptoBd.dechiffrerChamp(dP2.employeEmail) || "") === EMAIL_ENVOI,
      dP2 ? String(cryptoBd.dechiffrerChamp(dP2.employeEmail)) : "demande absente"
    );

    // ----------------------------------------------------------------
    // 9) VALIDATIONS MÉTIER CONSERVÉES (400)
    // ----------------------------------------------------------------
    const bad1 = await port.post("/api/demandes", {
      type: "AUTORISATION_SORTIE",
      departement: "COMPTABILITE",
      motif: "x",
      nombreHeures: "2",
      heureSortie: "09:00",
      heureRetour: "11:00",
    });
    check("SORTIE sans date → 400 (validation conservée)", bad1.status === 400, `status=${bad1.status}`);
    const bad2 = await port.post("/api/demandes", {
      type: "PARRAINAGE",
      emailN1: "n1-175@test.tn",
      operation: "OPÉRATION",
      nomFilleul: "X Y",
      telFilleul: "+216 20 555 666",
    });
    check("PARRAINAGE sans date du parrainage → 400 (validation conservée)", bad2.status === 400, `status=${bad2.status}`);
    const bad3 = await port.post("/api/demandes", {
      type: "CONGE",
      typeConge: "Annuel",
      dateDebut: "2026-11-02",
      dateFin: "2026-11-05",
      emailN1: "pas-un-email",
    });
    check("CONGÉ avec N+1 invalide → 400 (validation conservée)", bad3.status === 400, `status=${bad3.status}`);
  } finally {
    // ----------------------------------------------------------------
    // 10) NETTOYAGE COMPLET
    // ----------------------------------------------------------------
    const cinDet2 = cryptoBd.chiffrerChamp(CIN_TEST, true);
    const dDem = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet2 } });
    const dFich = await db.payslip.deleteMany({ where: { fileName: { in: FICHIERS } } });
    const dAcc = await db.portalAccess.deleteMany({ where: { cin: cinDet2 } });
    const restes = await db.portalAccess.count({ where: { cin: cinDet2 } });
    check(
      "Nettoyage : demandes, fiches et accès de test supprimés",
      dDem.count === 5 && dFich.count === 2 && dAcc.count === 1 && restes === 0,
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
