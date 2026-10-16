#!/usr/bin/env node
/**
 * v0.2.177 — PREUVE E2E « Confidentialité de la décision finale dans le
 * portail employé » (règle utilisateur : afficher le statut final UNIQUEMENT
 * après les réponses des RH ET du manager, ainsi que les pièces jointes
 * envoyées).
 *
 * Vérifie contre le portail RÉEL (4001) :
 *   1) CONGÉ manager-a-d'abord accepté (EN_ATTENTE, decisionManager=ACCEPTEE,
 *      PJ du manager reçue) → TOUT masqué : statut « En attente », décisions
 *      d'étape « En attente », commentaire vide, 0 document exposé,
 *      decisionMasquee=true ;
 *   2) CONGÉ RH-d'abord accepté (EN_ATTENTE, decisionRh=ACCEPTEE, PJ RH) →
 *      idem : TOUT masqué ;
 *   3) CONGÉ tout début (EN_ATTENTE, aucune décision) → masqué (naturel) ;
 *   4) CONGÉ matrice complète (decisionManager=ACCEPTEE + decisionRh=ACCEPTEE
 *      → ACCEPTEE) → TOUT révélé d'un coup : statut « Acceptée », décisions
 *      visibles, 2 documents (PDF signé + PJ) exposés, decisionMasquee=false ;
 *   5) AUTORISATION refus immédiat (decisionManager=REFUSEE → REFUSEE,
 *      refuseePar=MANAGER) → révélé (« Refusée par le Manager », document de
 *      refus exposé) : par conception, la décision qui refuse ACHÈVE la
 *      validation (aucune réponse RH ne suivra) ;
 *   6) ATTESTATION (une seule étape, hors périmètre) → affichage historique
 *      INCHANGÉ (documents exposés même en attente, decisionMasquee=false) ;
 *   7) page /demandes : note « Décision finale communiquée après les réponses
 *      du manager et du service RH » + CSS .d-note + code decisionMasquee
 *      présents.
 *
 * Nettoyage complet vérifié (demandes + documents + accès + fiches semés).
 */

process.chdir(__dirname + "/..");

// ---- Chargement du .env (comme portail-server.js) --------------------------
const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const crypto = require("crypto");

const PORTAIL = process.env.PORTAIL_BASE || "http://localhost:4001";
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

// ---- Données de test --------------------------------------------------------
const CIN_TEST = "TEST17701";
const MDP_PORTAIL = "Test-177!Pass";
const SECRET_TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const EMAIL_COMPTE = "employe177@test.tn";

const REFS = {
  d1: "DEM-2026-17701", // congé manager a accepté → masqué
  d2: "DEM-2026-17702", // congé RH a accepté → masqué
  d3: "DEM-2026-17703", // congé tout début → masqué
  d4: "DEM-2026-17704", // congé matrice complète → révélé
  d5: "DEM-2026-17705", // autorisation refus manager → révélé
  d6: "DEM-2026-17706", // attestation (1 étape) → inchangé
};

function donneesConge() {
  return JSON.stringify({ typeConge: "Congé annuel", du: "01/11/2026", au: "05/11/2026", responsableN1: "Manager Test" });
}
function donneesAutorisation() {
  return JSON.stringify({ motif: "Rendez-vous médical", du: "02/11/2026 09:00", au: "02/11/2026 12:00", responsableN1: "Manager Test" });
}

async function semer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: ["e2e-177-a.pdf"] } } });

  await db.payslip.create({
    data: {
      fileName: "e2e-177-a.pdf",
      storedName: "e2e-177-a.pdf",
      fileSize: 100,
      content: "FICHE DE PAIE " + CIN_TEST,
      normalizedContent: "FICHE DE PAIE " + CIN_TEST,
      cin: CIN_TEST,
      cinIndex: cinDet,
      employeeName: "Employe Test 177",
      period: "10/2026",
      netSalary: "1 000,00",
    },
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
      nomPrenom: cryptoBd.chiffrerChamp("Employe Test 177"),
      email: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
    },
  });

  const j = (n) => new Date(Date.now() - n * 3600000);

  // D1 — CONGÉ : le manager a DÉJÀ accepté (RH pas encore répondu) + sa PJ
  const d1 = await db.demandeAdministrative.create({
    data: {
      reference: REFS.d1,
      type: "CONGE",
      cin: cinDet,
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
      decisionManager: "ACCEPTEE",
      decisionManagerLe: j(3),
      decisionManagerPar: "Manager (réponse e-mail)",
      commentaire:
        "Acceptée par le manager — transmise automatiquement au service RH pour validation.",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d1.id,
      nomFichier: "justificatif-manager.pdf",
      chemin: "pj-e2e-177-manager.pdf",
      taille: 1234,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-manager",
      recuDe: "manager.test@example.tn",
      recuLe: j(3),
    },
  });

  // D2 — CONGÉ : les RH ont DÉJÀ accepté (manager pas encore répondu) + leur PJ
  const d2 = await db.demandeAdministrative.create({
    data: {
      reference: REFS.d2,
      type: "CONGE",
      cin: cinDet,
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
      decisionRh: "ACCEPTEE",
      decisionRhLe: j(2),
      decisionRhPar: "Auto-RH (réponse e-mail)",
      commentaire:
        "Acceptée par le service RH (réponse e-mail) — en attente de la validation du manager.",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d2.id,
      nomFichier: "note-auto-rh.pdf",
      chemin: "pj-e2e-177-rh.pdf",
      taille: 2345,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-rh",
      recuDe: "rh.test@example.tn",
      recuLe: j(2),
    },
  });

  // D3 — CONGÉ : aucune décision (véritable début)
  await db.demandeAdministrative.create({
    data: {
      reference: REFS.d3,
      type: "CONGE",
      cin: cinDet,
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
    },
  });

  // D4 — CONGÉ : matrice COMPLÈTE (manager + RH ont accepté) → ACCEPTEE
  const d4 = await db.demandeAdministrative.create({
    data: {
      reference: REFS.d4,
      type: "CONGE",
      cin: cinDet,
      statut: "ACCEPTEE",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesConge()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
      decisionManager: "ACCEPTEE",
      decisionManagerLe: j(5),
      decisionManagerPar: "Manager (réponse e-mail)",
      decisionRh: "ACCEPTEE",
      decisionRhLe: j(1),
      decisionRhPar: "Auto-RH (réponse e-mail)",
      traitePar: "Auto-RH (réponse e-mail)",
      traiteLe: j(1),
      commentaire:
        "Acceptée par le manager — transmise automatiquement au service RH pour validation. — Validation à deux étapes complète : manager ET service RH ont accepté.",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d4.id,
      nomFichier: "Acceptation_conge_DEM-2026-17704.pdf",
      chemin: "doc-e2e-177-accepte.pdf",
      taille: 3792,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-accepte",
      recuDe: "Génération automatique (document signé)",
      recuLe: j(1),
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d4.id,
      nomFichier: "ordre-mission.pdf",
      chemin: "pj-e2e-177-ordre.pdf",
      taille: 3456,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-ordre",
      recuDe: "rh.test@example.tn",
      recuLe: j(1),
    },
  });

  // D5 — AUTORISATION : refus IMMÉDIAT du manager (aucune réponse RH à venir)
  const d5 = await db.demandeAdministrative.create({
    data: {
      reference: REFS.d5,
      type: "AUTORISATION_SORTIE",
      cin: cinDet,
      statut: "REFUSEE",
      refuseePar: "MANAGER",
      destinataire: cryptoBd.chiffrerChamp("manager.test@example.tn"),
      donnees: cryptoBd.chiffrerChamp(donneesAutorisation()),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
      decisionManager: "REFUSEE",
      decisionManagerLe: j(4),
      decisionManagerPar: "Manager (réponse e-mail)",
      traitePar: "Manager (réponse e-mail)",
      traiteLe: j(4),
      commentaire:
        "Refusée par le manager — décision immédiate et définitive (aucune transmission aux RH).",
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d5.id,
      nomFichier: "Refus_autorisation_DEM-2026-17705.pdf",
      chemin: "doc-e2e-177-refus.pdf",
      taille: 3373,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-refus",
      recuDe: "Génération automatique (document de refus)",
      recuLe: j(4),
    },
  });

  // D6 — ATTESTATION (UNE seule étape, hors périmètre de la règle)
  const d6 = await db.demandeAdministrative.create({
    data: {
      reference: REFS.d6,
      type: "ATTESTATION_TRAVAIL",
      cin: cinDet,
      statut: "EN_ATTENTE",
      destinataire: cryptoBd.chiffrerChamp("rh@test.example.tn"),
      donnees: cryptoBd.chiffrerChamp("{}"),
      employeEmail: cryptoBd.chiffrerChamp(EMAIL_COMPTE),
    },
  });
  await db.documentDemande.create({
    data: {
      demandeId: d6.id,
      nomFichier: "attestation-travail.pdf",
      chemin: "doc-e2e-177-att.pdf",
      taille: 2211,
      typeMime: "application/pdf",
      empreinte: "sha-e2e-177-att",
      recuDe: "rh.test@example.tn",
      recuLe: j(6),
    },
  });

  console.log(`Semé : accès portail ${CIN_TEST} + 6 demandes (17701→17706) + 6 documents.`);
}

async function nettoyer() {
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const suppr = await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.payslip.deleteMany({ where: { fileName: { in: ["e2e-177-a.pdf"] } } });
  console.log(`Nettoyage : ${suppr.count} demande(s) supprimée(s) (+ documents en cascade), accès et fiche supprimés.`);
}

/** Retrouve un item par référence dans la réponse /api/mes-demandes. */
function parRef(items, ref) {
  return (items || []).find((x) => x.reference === ref);
}

async function main() {
  console.log("== v0.2.177 — confidentialité de la décision finale (portail employé) ==");
  await semer();

  try {
    // 1) Connexion portail CIN + mot de passe + OTP (une étape)
    const port = client(PORTAIL);
    const verif = await port.post("/api/verify", {
      cin: CIN_TEST,
      password: MDP_PORTAIL,
      otp: totpNow(SECRET_TOTP),
      remember: false,
    });
    check(
      "Connexion portail complète (CIN + mot de passe + OTP)",
      verif.status === 200 && verif.json?.ok,
      `status=${verif.status} ${JSON.stringify(verif.json)}`
    );

    // 2) Liste des demandes (API réelle du portail)
    const rep = await port.get("/api/mes-demandes");
    check("GET /api/mes-demandes → 200", rep.status === 200, `status=${rep.status}`);
    const items = rep.json?.items || [];
    check("6 demandes semées visibles", items.length === 6, `items=${items.length}`);

    const d1 = parRef(items, REFS.d1);
    const d2 = parRef(items, REFS.d2);
    const d3 = parRef(items, REFS.d3);
    const d4 = parRef(items, REFS.d4);
    const d5 = parRef(items, REFS.d5);
    const d6 = parRef(items, REFS.d6);

    // ---- D1 : manager a accepté, RH pas encore → MASQUÉ --------------------
    console.log("-- D1 congé « manager a accepté » (EN_ATTENTE) — doit être MASQUÉ");
    check("D1 statut affiché = EN_ATTENTE", d1?.statut === "EN_ATTENTE", `statut=${d1?.statut}`);
    check("D1 libellé affiché = « En attente »", d1?.statutLibelle === "En attente", `libellé=${d1?.statutLibelle}`);
    check("D1 décision manager MASQUÉE (null)", d1?.decisionManager === null, `decisionManager=${d1?.decisionManager}`);
    check("D1 libellé étape manager = « En attente »", d1?.decisionManagerLibelle === "En attente", `lib=${d1?.decisionManagerLibelle}`);
    check("D1 décision RH MASQUÉE (null)", d1?.decisionRh === null, `decisionRh=${d1?.decisionRh}`);
    check("D1 libellé étape RH = « En attente »", d1?.decisionRhLibelle === "En attente", `lib=${d1?.decisionRhLibelle}`);
    check("D1 commentaire de traitement MASQUÉ", (d1?.commentaire || "") === "", `commentaire=${d1?.commentaire}`);
    check("D1 date de traitement MASQUÉE", d1?.traiteLe === null, `traiteLe=${d1?.traiteLe}`);
    check("D1 AUCUN document exposé (PJ du manager masquée)", (d1?.documents || []).length === 0, `docs=${(d1?.documents || []).length}`);
    check("D1 decisionMasquee = true", d1?.decisionMasquee === true, `decisionMasquee=${d1?.decisionMasquee}`);

    // ---- D2 : RH a accepté, manager pas encore → MASQUÉ --------------------
    console.log("-- D2 congé « RH a accepté » (EN_ATTENTE) — doit être MASQUÉ");
    check("D2 statut affiché = EN_ATTENTE + « En attente »", d2?.statut === "EN_ATTENTE" && d2?.statutLibelle === "En attente", `${d2?.statut}/${d2?.statutLibelle}`);
    check("D2 décision RH MASQUÉE (null)", d2?.decisionRh === null, `decisionRh=${d2?.decisionRh}`);
    check("D2 décision manager MASQUÉE (null)", d2?.decisionManager === null, `decisionManager=${d2?.decisionManager}`);
    check("D2 commentaire de traitement MASQUÉ", (d2?.commentaire || "") === "", `commentaire=${d2?.commentaire}`);
    check("D2 AUCUN document exposé (PJ des RH masquée)", (d2?.documents || []).length === 0, `docs=${(d2?.documents || []).length}`);
    check("D2 decisionMasquee = true", d2?.decisionMasquee === true, `decisionMasquee=${d2?.decisionMasquee}`);

    // ---- D3 : tout début → MASQUÉ (naturel) --------------------------------
    console.log("-- D3 congé « tout début » (EN_ATTENTE) — doit être MASQUÉ");
    check("D3 statut + libellé = En attente", d3?.statut === "EN_ATTENTE" && d3?.statutLibelle === "En attente", `${d3?.statut}/${d3?.statutLibelle}`);
    check("D3 decisionMasquee = true", d3?.decisionMasquee === true, `decisionMasquee=${d3?.decisionMasquee}`);

    // ---- D4 : matrice complète (ACCEPTEE) → TOUT RÉVÉLÉ --------------------
    console.log("-- D4 congé « matrice complète » (ACCEPTEE) — doit être RÉVÉLÉ");
    check("D4 statut affiché = ACCEPTEE", d4?.statut === "ACCEPTEE", `statut=${d4?.statut}`);
    check("D4 libellé affiché = « Acceptée »", d4?.statutLibelle === "Acceptée", `libellé=${d4?.statutLibelle}`);
    check("D4 décision manager VISIBLE = ACCEPTEE", d4?.decisionManager === "ACCEPTEE", `decisionManager=${d4?.decisionManager}`);
    check("D4 décision RH VISIBLE = ACCEPTEE", d4?.decisionRh === "ACCEPTEE", `decisionRh=${d4?.decisionRh}`);
    check("D4 date de traitement VISIBLE", typeof d4?.traiteLe === "string" && d4?.traiteLe.length > 0, `traiteLe=${d4?.traiteLe}`);
    check("D4 commentaire VISIBLE (2 étapes)", (d4?.commentaire || "").includes("deux étapes"), `commentaire=${d4?.commentaire}`);
    check("D4 2 documents exposés (PDF signé + PJ RH)", (d4?.documents || []).length === 2, `docs=${(d4?.documents || []).length}`);
    check("D4 les noms de documents sont corrects", (d4?.documents || []).some((x) => x.nomFichier === "Acceptation_conge_DEM-2026-17704.pdf") && (d4?.documents || []).some((x) => x.nomFichier === "ordre-mission.pdf"), JSON.stringify((d4?.documents || []).map((x) => x.nomFichier)));
    check("D4 decisionMasquee = false", d4?.decisionMasquee === false, `decisionMasquee=${d4?.decisionMasquee}`);

    // ---- D5 : refus immédiat manager (REFUSEE) → RÉVÉLÉ --------------------
    console.log("-- D5 autorisation « refus immédiat manager » (REFUSEE) — doit être RÉVÉLÉ");
    check("D5 statut affiché = REFUSEE", d5?.statut === "REFUSEE", `statut=${d5?.statut}`);
    check("D5 libellé affiché = « Refusée par le Manager »", d5?.statutLibelle === "Refusée par le Manager", `libellé=${d5?.statutLibelle}`);
    check("D5 décision manager VISIBLE = REFUSEE", d5?.decisionManager === "REFUSEE", `decisionManager=${d5?.decisionManager}`);
    check("D5 document de refus exposé", (d5?.documents || []).length === 1 && d5.documents[0].nomFichier === "Refus_autorisation_DEM-2026-17705.pdf", `docs=${JSON.stringify((d5?.documents || []).map((x) => x.nomFichier))}`);
    check("D5 decisionMasquee = false", d5?.decisionMasquee === false, `decisionMasquee=${d5?.decisionMasquee}`);

    // ---- D6 : attestation (1 étape) → AFFICHAGE HISTORIQUE INCHANGÉ --------
    console.log("-- D6 attestation (1 étape, hors périmètre) — affichage INCHANGÉ");
    check("D6 statut = EN_ATTENTE + « En attente »", d6?.statut === "EN_ATTENTE" && d6?.statutLibelle === "En attente", `${d6?.statut}/${d6?.statutLibelle}`);
    check("D6 decisionMasquee = false (hors périmètre)", d6?.decisionMasquee === false, `decisionMasquee=${d6?.decisionMasquee}`);
    check("D6 document exposé même en attente (comportement historique)", (d6?.documents || []).length === 1, `docs=${(d6?.documents || []).length}`);

    // ---- AUCUNE FUITE GLOBALE ----------------------------------------------
    console.log("-- Contrôle global : aucune fuite dans les demandes MASQUÉES");
    // (NB : la réponse complète de D4 — demande TERMINÉE, légitimement révélée
    // — peut retracer l'historique « Acceptée par le manager — transmise
    // automatiquement au service RH » : c'est l'historique final voulu. Le
    // contrôle anti-fuite porte sur les demandes EN_ATTENTE masquées.)
    const brutMasque = JSON.stringify([d1, d2, d3]);
    check("Les demandes masquées n'exposent AUCUN commentaire intermédiaire (« Acceptée par le manager… »)",
      !brutMasque.includes("transmise automatiquement au service RH"), "fuite détectée");
    check("Les demandes masquées n'exposent AUCUN « en attente de la validation du manager »",
      !brutMasque.includes("en attente de la validation du manager"), "fuite détectée");
    check("Les PJs des demandes masquées (justificatif-manager / note-auto-rh) ne sont PAS dans la réponse",
      !brutMasque.includes("justificatif-manager.pdf") && !brutMasque.includes("note-auto-rh.pdf"), "fuite détectée");
    check("Les demandes masquées n'exposent AUCUN document (documents vides)",
      (d1?.documents || []).length === 0 && (d2?.documents || []).length === 0 && (d3?.documents || []).length === 0,
      "fuite détectée");

    // ---- Page /demandes : note + CSS + code --------------------------------
    console.log("-- Page /demandes (rendu client)");
    const page = await port.get("/demandes");
    const html = page.texte || "";
    check("Page /demandes servie (200)", page.status === 200, `status=${page.status}`);
    check("CSS .d-note présent", html.includes(".demande .d-note"), "style absent");
    check("Code de la note « Décision finale communiquée après les réponses… » présent",
      html.includes("Décision finale communiquée après les réponses du manager et du service RH"), "note absente");
    check("Code decisionMasquee consommé par le rendu", html.includes("d.decisionMasquee"), "code absent");
  } finally {
    await nettoyer();
    await db.$disconnect();
  }

  console.log(`\n== BILAN : ${OK} OK / ${KO} FAIL ==`);
  process.exit(KO ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try { await nettoyer(); } catch {}
  process.exit(1);
});
