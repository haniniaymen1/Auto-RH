#!/usr/bin/env node
/**
 * ============================================================================
 * Task 196 (v0.2.152) — PIÈCES JOINTES DES RÉPONSES E-MAIL (manager ET RH)
 * « Lorsque le RH ou le manager répond par e-mail à une demande de congé ou
 *  d'autorisation, il doit pouvoir ajouter une ou plusieurs pièces jointes à
 *  sa réponse. Les pièces jointes ajoutées à la réponse doivent être
 *  automatiquement enregistrées et associées à la demande concernée. Elles
 *  doivent ensuite être consultables et téléchargeables depuis les deux
 *  portails […] Les pièces jointes doivent rester accessibles avec
 *  l'historique de la demande, quel que soit son statut. »
 *
 *   §1  manager : réponse « Congé accepté » + 2 pièces jointes (PDF + PNG)
 *       → 2 documents importés, associés (recuDe = manager), SHA-256 correct,
 *         fichier chiffré sur disque déchiffrable À L'IDENTIQUE ;
 *   §2  LIAISON réponse ↔ pièces jointes : l'entrée d'historique porte les
 *       identifiants des documents importés par CETTE réponse
 *       (piecesJointesIds) ;
 *   §3  RH : réponse « Je valide » + 1 pièce jointe → matrice complète
 *       ACCEPTEE, document importé (recuDe = RH), entrée liée ;
 *   §4  réponse AMBIGUÏE avec pièce jointe → importée, statut inchangé,
 *       historique tracé (NON_RECONNU) avec l'identifiant ;
 *   §5  DOUBLON (même fichier renvoyé) → JAMAIS réimporté, trace conservée ;
 *   §6  extension REFUSÉE (.exe) dans un message multi-pièces → seule la
 *       pièce autorisée est importée, la refusée est tracée ;
 *   §7  PORTAIL EMPLOYÉ (4001, session réelle forgée HMAC) :
 *       /api/mes-demandes liste les pièces jointes avec recuDe pour les
 *       trois statuts (ACCEPTEE / REFUSEE / EN_ATTENTE) ;
 *   §8  PORTAIL EMPLOYÉ : GET /api/mes-demandes/documents/<id> → contenu
 *       IDENTIQUE à l'original (Visualiser), ?telecharger=1 → attachment ;
 *   §9  PORTAIL EMPLOYÉ : garde propriétaire — un AUTRE employé → 403 ;
 *   §10 PORTAIL ADMINISTRATIF (4000) : GET /api/demandes/[id] expose
 *       documents + reponsesRecues.piecesJointesIds ; téléchargement admin
 *       (RH/SUPERADMIN) 200 + contenu identique, quel que soit le statut.
 *
 * Le script restaure la configuration et supprime ses données de test.
 * ============================================================================
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const SMTP_PORT = 12531;
const MANAGER = "manager.diag196@test.local";
const RH = "rh.diag196@test.local";
const EMPLOYE = "employe.diag196@test.local";
const CIN_TEST = "TS1960PJ01";
const CIN_AUTRE = "TS1960PJ02";
const PREF_REFS = "DEM-2026-132";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

/* ---------- serveur SMTP de CAPTURE (aucun envoi réel) --------------------- */
const { SMTPServer } = require("smtp-server");
const serveurSmtp = new SMTPServer({
  authOptional: true,
  onRcptTo(a, s, cb) { cb(); },
  onData(flux, session, cb) {
    const morceaux = [];
    flux.on("data", (d) => morceaux.push(d));
    flux.on("end", () => { void morceaux; cb(); });
    flux.on("error", () => cb(new Error("flux interrompu")));
  },
});

/** (v0.2.152) une pièce jointe IMPORTÉE d'une réponse = recuDe hors
 *  « Génération automatique » (les PDF d'acceptation/refus générés par le
 *  système sont exclus des comptages — ils ne sont pas des pièces jointes). */
function estPieceJointe(doc) {
  return !(doc.recuDe || "").startsWith("Génération automatique");
}

/* ---------- client HTTP (cookie persistant) -------------------------------- */
function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps) => {
    const res = await fetch(base + chemin, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(corps instanceof Buffer ? { "Content-Length": String(corps.length) } : {}),
      },
      body: corps === undefined ? undefined : (corps instanceof Buffer ? corps : JSON.stringify(corps)),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const tampon = Buffer.from(await res.arrayBuffer());
    const texte = tampon.toString("utf8");
    let json = null;
    try { json = JSON.parse(texte); } catch { /* binaire / html */ }
    return { status: res.status, json, texte, tampon, entetes: res.headers };
  };
  return {
    req, post: (p, corps) => req("POST", p, corps), get: (p) => req("GET", p),
    put: (p, corps) => req("PUT", p, corps),
  };
}

/** Forge un jeton de session portail (même HMAC que createPortalSession). */
function jetonPortail(cin) {
  const payload = Buffer.from(JSON.stringify({
    cin, exp: Math.floor(Date.now() / 1000) + 3600, rm: 0, pd: 0, ot: 0,
  })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET || "autorh-secret-local-a-changer-dans-env")
    .update(payload).digest("base64url");
  return payload + "." + sig;
}

/* ---------- message « parsed » (comme simpleParser) ------------------------ */
function message({ sujet, de, inReplyTo = null, texte = "", piecesJointes = [] }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "X" }] },
    inReplyTo,
    references: inReplyTo ? [inReplyTo] : undefined,
    text: texte,
    html: null,
    attachments: piecesJointes,
  };
}

/* ---------- création d'une demande de congé de test ------------------------ */
async function creerDemande(reference, messageId, statut, destinataire) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: statut || "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(destinataire || MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2027-01-04", dateFin: "2027-01-15",
        emailN1: destinataire || MANAGER, commentaire: "Dossier Task 196",
      })),
      messageIdEnvoi: messageId,
    },
  });
}

/** Purge toutes les demandes de test + leurs documents sur disque. */
async function nettoyerDemandesTest() {
  const demandes = await db.demandeAdministrative.findMany({
    where: { reference: { startsWith: PREF_REFS } },
    select: { id: true },
  });
  for (const d of demandes) {
    const docs = await db.documentDemande.findMany({ where: { demandeId: d.id } });
    for (const doc of docs) {
      for (const base of ["storage/documents-demandes/" + doc.chemin, doc.chemin]) {
        try { fs.unlinkSync(base); break; } catch { /* suivant */ }
      }
    }
    await db.documentDemande.deleteMany({ where: { demandeId: d.id } });
    await db.demandeAdministrative.delete({ where: { id: d.id } }).catch(() => {});
  }
  return db.demandeAdministrative.count({ where: { reference: { startsWith: PREF_REFS } } });
}

/** Lit l'historique déchiffré des réponses reçues d'une demande. */
async function lireHistorique(demandeId) {
  const d = await db.demandeAdministrative.findUnique({ where: { id: demandeId } });
  if (!d || !d.reponsesRecues) return [];
  try {
    const liste = JSON.parse(cryptoBd.dechiffrerChamp(d.reponsesRecues) || "[]");
    return Array.isArray(liste) ? liste : [];
  } catch { return []; }
}

async function relire(id) {
  return db.demandeAdministrative.findUnique({ where: { id } });
}

/* ---------- pièces jointes de test ----------------------------------------- */
function pdfMinimal(marqueur) {
  // PDF minimal VALIDE, UNIQUE par marqueur (le dédoublonnage porte sur le
  // SHA-256 DU CONTENU : deux pièces jointes de test distinctes doivent
  // avoir des octets différents pour ne pas être traitées comme doublon).
  return Buffer.from(
    "%PDF-1.4\n% " + String(marqueur || "x") + "-" + crypto.randomUUID() + "\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "xref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n9\n%%EOF\n",
    "latin1"
  );
}
function pngMinimal() {
  // PNG 1×1 valide (signature + IHDR + IEND)
  return Buffer.from(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
    "01f15c4890000000d4944415478da63fcffff3f0300050001ff9bcbb" +
    "1910000000049454e44ae426082",
    "hex"
  );
}

/** Lit l'historique déchiffré des réponses reçues d'une demande. */
async function main() {
  console.log("== Task 196 — PIÈCES JOINTES DES RÉPONSES E-MAIL (v0.2.152) ==");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", {
    email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1",
  });
  check("Connexion superadministrateur", login.status === 200, "status=" + login.status);

  const cfgMailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  await new Promise((resolve) => serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resolve));
  if (cfgMailAvant) {
    await db.mailConfig.update({ where: { id: "smtp" }, data: {
      host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
    }});
  } else {
    await db.mailConfig.create({ data: {
      id: "smtp", host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
    }});
  }

  // purge défensive (idempotence)
  await nettoyerDemandesTest();

  /* ==========================================================================
   * §1 — MANAGER : « Congé accepté » + 2 pièces jointes (PDF + PNG)
   * ======================================================================= */
  console.log("\n— §1 : manager répond avec 2 pièces jointes —");
  const d1 = await creerDemande(PREF_REFS + "101", "dem196-a@test");
  const pdfA = pdfMinimal("planning");
  const pngB = pngMinimal();
  const r1 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d1.reference, de: MANAGER, inReplyTo: "<dem196-a@test>",
    texte: "Congé accepté. Ci-joints le planning et le justificatif.",
    piecesJointes: [
      { filename: "planning-equipe.pdf", content: pdfA, contentType: "application/pdf" },
      { filename: "justificatif.png", content: pngB, contentType: "image/png" },
    ],
  }));
  check("réponse manager TRAITEE (décision reconnue)", r1.statut === "TRAITE", "statut=" + r1.statut);
  const docs1 = await db.documentDemande.findMany({ where: { demandeId: d1.id }, orderBy: { recuLe: "asc" } });
  check("2 pièces jointes importées et associées à la demande", docs1.length === 2, "docs=" + docs1.length);
  check("recuDe = adresse du manager pour les 2 pièces", docs1.every((d) => d.recuDe === MANAGER),
    docs1.map((d) => d.recuDe).join(", "));
  check("noms d'origine conservés", docs1.some((d) => d.nomFichier === "planning-equipe.pdf") &&
    docs1.some((d) => d.nomFichier === "justificatif.png"), "");
  const docPdf = docs1.find((d) => d.nomFichier === "planning-equipe.pdf");
  const docPng = docs1.find((d) => d.nomFichier === "justificatif.png");
  check("empreinte SHA-256 correcte (PDF)", docPdf && docPdf.empreinte === crypto.createHash("sha256").update(pdfA).digest("hex"), "");
  check("empreinte SHA-256 correcte (PNG)", docPng && docPng.empreinte === crypto.createHash("sha256").update(pngB).digest("hex"), "");
  check("fichier chiffré présent sur le disque (PDF)", docPdf && (fs.existsSync("storage/documents-demandes/" + docPdf.chemin) || fs.existsSync(docPdf.chemin)), docPdf ? docPdf.chemin : "");
  const d1a = await relire(d1.id);
  check("statut EN_ATTENTE (étape RH de la matrice requise)", d1a.statut === "EN_ATTENTE" && d1a.decisionManager === "ACCEPTEE", "statut=" + d1a.statut);

  /* ==========================================================================
   * §2 — LIAISON réponse ↔ pièces jointes (piecesJointesIds)
   * ======================================================================= */
  console.log("\n— §2 : historique lié aux pièces jointes de CETTE réponse —");
  const hist2 = await lireHistorique(d1.id);
  check("historique : 1 entrée (réponse manager)", hist2.length === 1, "entrées=" + hist2.length);
  check("entrée : pièces jointes listées (2 noms)", (hist2[0].piecesJointes || []).length === 2, "");
  check("entrée : piècesJointesImportees (2 noms)", (hist2[0].piecesJointesImportees || []).length === 2, "");
  check("entrée : piecesJointesIds = identifiants des 2 documents importés",
    (hist2[0].piecesJointesIds || []).length === 2 &&
    (hist2[0].piecesJointesIds || []).includes(docPdf.id) &&
    (hist2[0].piecesJointesIds || []).includes(docPng.id),
    "ids=" + (hist2[0].piecesJointesIds || []).join(","));
  check("entrée : expéditeur + rôle + texte original conservés",
    hist2[0].de === MANAGER && hist2[0].role === "manager" && /planning/i.test(hist2[0].texte), "");

  /* ==========================================================================
   * §3 — RH : « Je valide » + 1 pièce jointe → matrice complète ACCEPTEE
   * ======================================================================= */
  console.log("\n— §3 : RH répond avec 1 pièce jointe (matrice complète) —");
  const pdfC = pdfMinimal("copie-rh");
  const r3 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d1.reference, de: RH, inReplyTo: "<dem196-a@test>",
    texte: "Je valide. Copie de la décision en pièce jointe.",
    piecesJointes: [{ filename: "copie-decision-rh.pdf", content: pdfC, contentType: "application/pdf" }],
  }));
  check("réponse RH TRAITEE", r3.statut === "TRAITE" && r3.roleReponse === "rh", "");
  const d3a = await relire(d1.id);
  check("matrice complète manager+RH → ACCEPTEE", d3a.statut === "ACCEPTEE", "statut=" + d3a.statut);
  const docs3 = await db.documentDemande.findMany({ where: { demandeId: d1.id } });
  check("3 PIÈCES JOINTES au total (2 manager + 1 RH — documents générés exclus)",
    docs3.filter(estPieceJointe).length === 3, "docs=" + docs3.length + " pj=" + docs3.filter(estPieceJointe).length);
  const docRh = docs3.find((d) => d.nomFichier === "copie-decision-rh.pdf");
  check("pièce jointe RH : recuDe = adresse RH", docRh && docRh.recuDe === RH, "");
  const hist3 = await lireHistorique(d1.id);
  const entreeRh = hist3.find((e) => e.role === "rh");
  check("entrée RH : piecesJointesIds lie copie-decision-rh.pdf",
    entreeRh && (entreeRh.piecesJointesIds || []).length === 1 && entreeRh.piecesJointesIds[0] === docRh.id, "");
  check("entrée manager : statutAvant/statutApres tracés",
    hist2[0].statutAvant === "EN_ATTENTE" && hist2[0].statutApres === "EN_ATTENTE", "");

  /* ==========================================================================
   * §4 — RÉPONSE AMBIGUÏE avec pièce jointe → importée, statut inchangé
   * ======================================================================= */
  console.log("\n— §4 : pièce jointe avec réponse ambiguë (sans décision) —");
  const d4 = await creerDemande(PREF_REFS + "104", "dem196-d@test");
  const pdfD = pdfMinimal("note-interne");
  const r4 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d4.reference, de: MANAGER, inReplyTo: "<dem196-d@test>",
    texte: "Vu, je regarde et je vous reviens.",
    piecesJointes: [{ filename: "note-interne.pdf", content: pdfD, contentType: "application/pdf" }],
  }));
  const d4a = await relire(d4.id);
  check("réponse ambiguë : demande toujours EN_ATTENTE", d4a.statut === "EN_ATTENTE", "statut=" + d4a.statut);
  const docs4 = await db.documentDemande.findMany({ where: { demandeId: d4.id } });
  check("pièce jointe QUAND MÊME importée et associée", docs4.length === 1 && docs4[0].recuDe === MANAGER, "");
  const hist4 = await lireHistorique(d4.id);
  check("historique : réponse tracée (NON_RECONNU) avec l'identifiant du document",
    hist4.length === 1 && hist4[0].decision === "NON_RECONNU" &&
    (hist4[0].piecesJointesIds || []).length === 1, "");

  /* ==========================================================================
   * §5 — DOUBLON : même fichier renvoyé → JAMAIS réimporté
   * ======================================================================= */
  console.log("\n— §5 : doublon (même fichier renvoyé) —");
  const r5 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d4.reference, de: MANAGER, inReplyTo: "<dem196-d@test>",
    texte: "Je renvoie le fichier au cas où.",
    piecesJointes: [{ filename: "note-interne.pdf", content: pdfD, contentType: "application/pdf" }],
  }));
  const docs5 = await db.documentDemande.findMany({ where: { demandeId: d4.id } });
  check("doublon NON réimporté (toujours 1 document)", docs5.length === 1, "docs=" + docs5.length);
  const hist5 = await lireHistorique(d4.id);
  check("doublon : réponse malgré tout tracée dans l'historique", hist5.length === 2, "entrées=" + hist5.length);

  /* ==========================================================================
   * §6 — EXTENSION REFUSÉE (.exe) dans un message multi-pièces
   * ======================================================================= */
  console.log("\n— §6 : extension refusée (.exe) —");
  const d6 = await creerDemande(PREF_REFS + "106", "dem196-f@test");
  const pdfF = pdfMinimal("autorisation");
  const r6 = await portail.traiterMessageRecu(message({
    sujet: "RE: " + d6.reference, de: MANAGER, inReplyTo: "<dem196-f@test>",
    texte: "Congé validé. Deux fichiers en pièce jointe.",
    piecesJointes: [
      { filename: "autorisation.pdf", content: pdfF, contentType: "application/pdf" },
      { filename: "programme.exe", content: Buffer.from("MZbinaire"), contentType: "application/octet-stream" },
    ],
  }));
  const docs6 = await db.documentDemande.findMany({ where: { demandeId: d6.id } });
  check("seule la pièce autorisée est importée", docs6.length === 1 && docs6[0].nomFichier === "autorisation.pdf", "");
  const hist6 = await lireHistorique(d6.id);
  check("pièce refusée TRACÉE dans l'historique (jamais silencieuse)",
    (hist6[0].piecesJointes || []).includes("programme.exe") &&
    (hist6[0].piecesJointesImportees || []).indexOf("programme.exe") < 0, "");
  check("décision reconnue malgré la pièce refusée", r6.decision === "VALIDATION", "");

  /* ==========================================================================
   * §7 — PORTAIL EMPLOYÉ (4001) : pièces jointes listées pour TOUS les statuts
   * ======================================================================= */
  console.log("\n— §7 : portail employé — listage quel que soit le statut —");
  // d1 = ACCEPTEE (§3) ; d4 = EN_ATTENTE (§4) ; d7 = REFUSEE (créée ici)
  const d7 = await creerDemande(PREF_REFS + "107", "dem196-g@test");
  const pdfG = pdfMinimal("solde");
  await portail.traiterMessageRecu(message({
    sujet: "RE: " + d7.reference, de: MANAGER, inReplyTo: "<dem196-g@test>",
    texte: "Je refuse, le solde est insuffisant.",
    piecesJointes: [{ filename: "solde-conges.pdf", content: pdfG, contentType: "application/pdf" }],
  }));
  const d7a = await relire(d7.id);
  check("demande de contrôle REFUSEE (refus manager)", d7a.statut === "REFUSEE", "statut=" + d7a.statut);

  const emp = client(PORTAIL);
  const liste = await fetch(PORTAIL + "/api/mes-demandes", {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_TEST)) },
  });
  check("GET /api/mes-demandes : 200 (session portail valable)", liste.status === 200, "status=" + liste.status);
  const listeJson = await liste.json();
  const items = listeJson.items || [];
  const itemAcc = items.find((i) => i.id === d1.id);
  const itemAtt = items.find((i) => i.id === d4.id);
  const itemRef = items.find((i) => i.id === d7.id);
  const pjAcc = itemAcc ? itemAcc.documents.filter(estPieceJointe) : [];
  check("demande ACCEPTEE : 3 pièces jointes listées avec expéditeur",
    pjAcc.length === 3 && pjAcc.every((doc) => doc.recuDe === MANAGER || doc.recuDe === RH),
    "pj=" + pjAcc.length);
  check("demande EN_ATTENTE : pièce jointe listée (accessible en attente)",
    itemAtt && itemAtt.documents.filter(estPieceJointe).length === 1 &&
    itemAtt.documents.filter(estPieceJointe)[0].nomFichier === "note-interne.pdf", "");
  check("demande REFUSEE : pièce jointe listée (accessible après refus)",
    itemRef && itemRef.documents.filter(estPieceJointe).length === 1 &&
    itemRef.documents.filter(estPieceJointe)[0].nomFichier === "solde-conges.pdf", "");
  check("recuDe exposé au portail employé (manager ET RH)",
    pjAcc.some((doc) => doc.recuDe === MANAGER) && pjAcc.some((doc) => doc.recuDe === RH), "");

  /* ==========================================================================
   * §8 — PORTAIL EMPLOYÉ : Visualiser + Télécharger (contenu IDENTIQUE)
   * ======================================================================= */
  console.log("\n— §8 : portail employé — consultation et téléchargement —");
  const vis = await fetch(PORTAIL + "/api/mes-demandes/documents/" + docPdf.id, {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_TEST)) },
  });
  const visBytes = Buffer.from(await vis.arrayBuffer());
  check("Visualiser : 200 + type MIME application/pdf", vis.status === 200 && (vis.headers.get("content-type") || "").indexOf("application/pdf") >= 0, "status=" + vis.status);
  check("Visualiser : contenu IDENTIQUE aux octets d'origine (PDF manager)", visBytes.equals(pdfA), visBytes.length + " vs " + pdfA.length + " octets");
  const visPng = await fetch(PORTAIL + "/api/mes-demandes/documents/" + docPng.id, {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_TEST)) },
  });
  const visPngBytes = Buffer.from(await visPng.arrayBuffer());
  check("Visualiser : contenu IDENTIQUE aux octets d'origine (PNG manager)", visPngBytes.equals(pngB), "");
  const visRh = await fetch(PORTAIL + "/api/mes-demandes/documents/" + (docRh ? docRh.id : ""), {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_TEST)) },
  });
  const visRhBytes = Buffer.from(await visRh.arrayBuffer());
  check("Visualiser : pièce jointe du RH téléchargeable par l'employé", docRh && visRh.status === 200 && visRhBytes.equals(pdfC), "");
  const tel = await fetch(PORTAIL + "/api/mes-demandes/documents/" + docPdf.id + "?telecharger=1", {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_TEST)) },
  });
  const telBytes = Buffer.from(await tel.arrayBuffer());
  check("Télécharger : Content-Disposition attachment", (tel.headers.get("content-disposition") || "").indexOf("attachment") >= 0, "");
  check("Télécharger : nom d'origine dans l'en-tête", (tel.headers.get("content-disposition") || "").indexOf("planning-equipe.pdf") >= 0, "");
  check("Télécharger : contenu IDENTIQUE", telBytes.equals(pdfA), "");

  /* ==========================================================================
   * §9 — PORTAIL EMPLOYÉ : garde propriétaire (un AUTRE employé → 403)
   * ======================================================================= */
  console.log("\n— §9 : garde propriétaire —");
  const autre = await fetch(PORTAIL + "/api/mes-demandes/documents/" + docPdf.id, {
    headers: { Cookie: "portail_session=" + encodeURIComponent(jetonPortail(CIN_AUTRE)) },
  });
  check("un AUTRE employé → 403 (accès limité à ses propres documents)", autre.status === 403, "status=" + autre.status);

  /* ==========================================================================
   * §10 — PORTAIL ADMINISTRATIF (4000) : détail + téléchargement RH/admin
   * ======================================================================= */
  console.log("\n— §10 : portail administratif —");
  const det = await adm.get("/api/demandes/" + d1.id);
  check("GET /api/demandes/[id] : 200", det.status === 200, "status=" + det.status);
  const item10 = det.json && det.json.item;
  check("détail : 3 PIÈCES JOINTES exposées (documents générés exclus)",
    item10 && (item10.documents || []).filter(estPieceJointe).length === 3, "");
  check("détail : reponsesRecues expose piecesJointesIds",
    item10 && (item10.reponsesRecues || []).some((r) => (r.piecesJointesIds || []).length > 0), "");
  const detRef = await adm.get("/api/demandes/" + d7.id);
  const itemRef10 = detRef.json && detRef.json.item;
  check("détail demande REFUSEE : pièces jointes exposées",
    itemRef10 && (itemRef10.documents || []).filter(estPieceJointe).length === 1, "");
  const docRef10 = (itemRef10.documents || []).filter(estPieceJointe)[0];
  const admVis = await adm.get("/api/demandes/" + d7.id + "/documents/" + docRef10.id);
  check("admin : Visualiser 200 sur demande REFUSEE", admVis.status === 200, "status=" + admVis.status);
  const admTel = await adm.get("/api/demandes/" + d7.id + "/documents/" + docRef10.id + "?telecharger=1");
  check("admin : Télécharger attachment", (admTel.entetes.get("content-disposition") || "").indexOf("attachment") >= 0, "");
  check("admin : contenu IDENTIQUE (pièce jointe de la demande refusée)",
    admTel.tampon && admTel.tampon.equals(pdfG), "octets=" + (admTel.tampon ? admTel.tampon.length : 0));
  const admTelAcc = await adm.get("/api/demandes/" + d1.id + "/documents/" + docPdf.id + "?telecharger=1");
  check("admin : contenu IDENTIQUE sur demande ACCEPTEE (PDF manager)",
    admTelAcc.tampon && admTelAcc.tampon.equals(pdfA), "");

  /* ==========================================================================
   * NETTOYAGE COMPLET
   * ======================================================================= */
  console.log("\n— nettoyage —");
  const reste = await nettoyerDemandesTest();
  check("nettoyage : demandes de test supprimées", reste === 0, "restantes=" + reste);
  if (cfgMailAvant) {
    await db.mailConfig.update({ where: { id: "smtp" }, data: cfgMailAvant });
  } else {
    await db.mailConfig.delete({ where: { id: "smtp" } }).catch(() => {});
  }
  serveurSmtp.close(() => {});

  console.log("\n========================================");
  console.log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  console.log("========================================");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE :", e); process.exit(1); });
