#!/usr/bin/env node
/**
 * v0.2.148 — PREUVE E2E « aperçu ≠ PDF envoyé » CORRIGÉ (trace
 * 1a1178618b8b7729) : « je vois bien la signature électronique et le cachet
 * sur l'aperçu ; le PDF envoyé par e-mail ne les contient pas ».
 *
 * CAUSE RACINE (prouvée par ce test + le code) : DEUX SOURCES de
 * configuration — l'APERÇU (cfgMoteur, route /api/reponse-pdf-config)
 * reflétait TOUJOURS la section dédiée « Réponse automatique PDF par
 * e-mail » tandis que la GÉNÉRATION envoyée (chargerConfig,
 * document-acceptation.js + document-refus.js) ne l'utilisait QUE si
 * actif=true, retombant SINON SILENCIEUSEMENT sur le module historique
 * (SignatureConfig — sans certificat ni cachet). Section configurée
 * (certificat importé) mais inactive → aperçu conforme, PDF envoyé sans
 * signature ni cachet.
 *
 * CORRECTIF v0.2.148 : UNE SEULE source dès que la section est ENGAGÉE
 * (interrupteur principal actif OU certificat dédié importé) ;
 * docActif = interrupteur principal (section inactive + certificat présent
 * → AUCUN document, saut TRACÉ au Journal DOC_SIGNE_SAUTE /
 * DOC_REFUS_SAUTE) ; retombée historique réservée aux installations
 * jamais configurées (ligne absente ou tout OFF sans certificat).
 *
 *   A. État EXACT du signalement (actif=false + certificat importé +
 *      signature/cachet activés + module historique docActif=true) :
 *      A1 aperçu (API admin) → signature + cachet PRÉSENTS (ce que voit
 *      l'utilisateur) ; A2 génération → AUCUN document (saut TRACÉ,
 *      jamais de PDF historique incohérent) ; A3 aucun e-mail.
 *   B. Section ACTIVÉE (interrupteur principal ON) : cycle e-mail complet
 *      manager → RH (v0.2.146) → PDF signé envoyé AUTOMATIQUEMENT :
 *      elements elec+certificat, /ByteRange dans la pièce jointe, ET
 *      aperçu de la même demande → MÊMES éléments : aperçu == envoyé.
 *   C. CONTINUITÉ : ligne présente mais jamais engagée (actif=false,
 *      aucun certificat) → génération historique inchangée (document
 *      généré, source Journal « module-historique »).
 *   D. Journal : champ source = section-dediee (B) / module-historique (C).
 *
 * Nettoyage complet (demandes, documents, certificat, configs restaurées
 * à l'état d'origine) même en cas d'échec.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const zlib = require("zlib");
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const forge = require("node-forge");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const acceptation = require("./document-acceptation.js");

const ADMIN = "http://localhost:4000";
const SMTP_PORT = 12527;
const MANAGER = "manager.diag192@test.local";
const RH = "rh.diag192@test.local";
const EMPLOYE = "employe.diag192@test.local";
const CIN_TEST = "TS1920DIAG";
const MDP_CERT = "E2E-192-Dedie!";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

/* ---------- serveur SMTP de CAPTURE ---------- */
const messagesCaptures = [];
const parses = new Map();
const serveurSmtp = new SMTPServer({
  authOptional: true,
  onRcptTo(a, s, cb) { cb(); },
  onData(flux, session, cb) {
    const morceaux = [];
    flux.on("data", (d) => morceaux.push(d));
    flux.on("end", () => { messagesCaptures.push(Buffer.concat(morceaux)); cb(); });
    flux.on("error", () => cb(new Error("flux interrompu")));
  },
});

/* ---------- helpers (jumelles des tests 185/190/191) ---------- */
function creerP12(mdp, cn, org) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [{ name: "commonName", value: cn }, { name: "organizationName", value: org }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], mdp, { generateLocalKeyId: true, algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

function pngMinimal(r, g, b, l, h) {
  const brut = Buffer.alloc(h * (1 + l * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = y * (1 + l * 4) + 1 + x * 4;
      brut[i] = r; brut[i + 1] = g; brut[i + 2] = b; brut[i + 3] = 210;
    }
  }
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const bb of buf) c = table[(c ^ bb) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(l, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(brut)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const IMG_PARAPHE_LEGACY = "data:image/png;base64," + pngMinimal(10, 10, 10, 20, 20).toString("base64");

function client(base) {
  let cookie = "";
  const req = async (method, chemin, corps, brut) => {
    const res = await fetch(base + chemin, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: brut !== undefined ? brut : corps === undefined ? undefined : JSON.stringify(corps),
      redirect: "manual",
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    const texte = await res.text();
    let json = null;
    try { json = JSON.parse(texte); } catch { /* */ }
    return { status: res.status, json, texte, headers: res.headers, buffer: json ? null : Buffer.from(texte, "binary") };
  };
  return {
    req,
    post: (p, corps) => req("POST", p, corps),
    put: (p, brut) => req("PUT", p, undefined, brut),
    postMultipart: async (p, form) => {
      const res = await fetch(base + p, { method: "POST", headers: cookie ? { Cookie: cookie } : {}, body: form, redirect: "manual" });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch { /* */ }
      return { status: res.status, json, texte, headers: res.headers, buffer: json ? null : Buffer.from(texte, "binary") };
    },
  };
}

function message({ sujet, de, inReplyTo = null, texte = "" }) {
  return {
    subject: sujet,
    from: { value: [{ address: de, name: "X" }] },
    inReplyTo,
    references: inReplyTo ? [inReplyTo] : undefined,
    text: texte,
    html: null,
    attachments: [],
  };
}

async function creerDemande(reference, messageId, statut) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: statut || "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: MANAGER, commentaire: "Dossier E2E 192",
      })),
      messageIdEnvoi: messageId,
    },
  });
}

async function creerDemandeAcceptee(reference) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: "ACCEPTEE",
      decisionManager: "ACCEPTEE", decisionManagerLe: new Date(Date.now() - 3600000), decisionManagerPar: "Manager (réponse e-mail)",
      decisionRh: "ACCEPTEE", decisionRhLe: new Date(), decisionRhPar: "Auto-RH (réponse e-mail)",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: MANAGER, commentaire: "Dossier E2E 192",
      })),
      messageIdEnvoi: "dem192-" + reference.slice(-5) + "@test",
    },
  });
}

async function parsesCaptures() {
  const liste = [];
  for (let i = 0; i < messagesCaptures.length; i++) {
    if (!parses.has(i)) parses.set(i, await simpleParser(messagesCaptures[i]));
    const parse = parses.get(i);
    const piece = (parse.attachments || []).find((a) => String(a.contentType || "").includes("pdf"));
    liste.push({ parse, piece });
  }
  return liste;
}
async function messageAvecPiece(reference) {
  for (let tentative = 0; tentative < 20; tentative++) {
    const liste = await parsesCaptures();
    const trouve = liste.find((x) => x.piece && x.parse.subject && x.parse.subject.includes(reference));
    if (trouve) return trouve;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function cfgPut(interrupteurs) {
  return JSON.stringify(Object.assign({
    actif: false, sigActif: false, tamponActif: false, qrActif: false,
    signerActif: true, elecActif: true,
    certSignataire: "Amel Ben Salah", certFonction: "Directrice des Ressources Humaines",
    elecForme: "ROND", elecPosition: "HAUT_DROITE", elecDecalX: 0, elecDecalY: 0, elecTaille: 120,
    elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: "E2E 192",
    mentionActif: false, mentionTexte: "",
    emailActif: true, emailObjet: "E2E-192 {REF}", emailCorps: "",
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, interrupteurs || {}));
}

async function apercuAdmin(adm, demandeId) {
  const f = new FormData();
  f.append("action", "apercu");
  f.append("demandeId", demandeId);
  const r = await adm.postMultipart("/api/reponse-pdf-config", f);
  const elements = decodeURIComponent(String(r.headers.get("x-apercu-elements") || "")).split(",").filter(Boolean);
  const signe = String(r.headers.get("x-apercu-signature-crypto") || "") === "1";
  return { r, elements, signe };
}

async function main() {
  console.log("== Task 192 (v0.2.148) — aperçu == PDF envoyé : source de configuration UNIQUE ==");
  await new Promise((resolve, rejet) => {
    serveurSmtp.on("error", rejet);
    serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resolve);
  });
  console.log("-- serveur SMTP de capture local sur 127.0.0.1:" + SMTP_PORT + " --");

  const cfgMailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const cfgPdfAvant = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
  const cfgSigAvant = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const demandesCrees = [];
  let fichierCertificat = "";
  const entréesJournal = [];

  try {
    /* ---------- semis ---------- */
    console.log("-- semis : MailConfig → SMTP de capture ; certificat importé ; états sauvegardés --");
    if (cfgMailAvant) {
      await db.mailConfig.update({ where: { id: "smtp" }, data: {
        host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
      }});
    } else {
      await db.mailConfig.create({ data: {
        id: "smtp", host: "127.0.0.1", port: SMTP_PORT, from: "servicerh@test.local", rhEmail: RH,
      }});
    }
    await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });

    // module historique : ACTIF avec paraphe mais SANS certificat (état qui,
    // avant correctif, servait la génération dès que la section était inactive)
    const donneesLegacy = {
      docActif: true, sigActif: true, sigImage: IMG_PARAPHE_LEGACY, sigImageNom: "legacy-192.png",
      sigPosition: "BAS_DROITE", sigTaille: 100, elecActif: false, docElecActif: false,
      certChemin: "", certMotDePasse: "", certActif: false, qrActif: false, docQrActif: false,
      docEmailActif: true, docEmailObjet: "LEGACY-192 {REF}", docEnvoyerRh: true, docEnvoyerManager: true,
      mentionActif: false,
    };
    if (cfgSigAvant) await db.signatureConfig.update({ where: { id: "signature" }, data: donneesLegacy });
    else await db.signatureConfig.create({ data: Object.assign({ id: "signature" }, donneesLegacy) });

    const adm = client(ADMIN);
    const login = await adm.post("/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" });
    check("Connexion superadministrateur", login.status === 200, "status=" + login.status);

    const p12 = creerP12(MDP_CERT, "Reponse PDF 192", "Entreprise E2E 192");
    const formCert = new FormData();
    formCert.append("action", "certificat");
    formCert.append("fichier", new Blob([p12]), "certificat-e2e-192.p12");
    formCert.append("motDePasse", MDP_CERT);
    const impCert = await adm.postMultipart("/api/reponse-pdf-config", formCert);
    check("Import certificat DÉDIÉ (.p12)", impCert.status === 200 && impCert.json && impCert.json.ok === true,
      impCert.status === 200 ? "" : (impCert.texte || "").slice(0, 120));
    const rpcApresImport = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
    const cheminCertBrut = rpcApresImport && rpcApresImport.certChemin ? String(rpcApresImport.certChemin) : "";
    fichierCertificat = cheminCertBrut.startsWith("storage/") ? cheminCertBrut : (cheminCertBrut ? "storage/reponse-pdf/" + cheminCertBrut : "");

    /* ================= A) ÉTAT EXACT DU SIGNALEMENT (post-correctif) ================= */
    console.log("\n— A) actif=false + certificat importé + signature/cachet activés (état du signalement) —");
    const putA = await adm.put("/api/reponse-pdf-config", cfgPut({ actif: false }));
    check("PUT section : certificat présent, signature + cachet ON, interrupteur principal OFF", putA.status === 200,
      putA.status === 200 ? "" : (putA.texte || "").slice(0, 120));

    const dA = await creerDemandeAcceptee("DEM-2026-12001");
    demandesCrees.push(dA.id);

    // A1 — APERÇU (ce que VOIT l'utilisateur)
    const a1 = await apercuAdmin(adm, dA.id);
    check("A1 APERÇU : PDF généré", a1.r.status === 200 && a1.r.buffer && a1.r.buffer.subarray(0, 4).toString("latin1") === "%PDF",
      a1.r.status === 200 ? a1.r.buffer.length + " octets" : "status=" + a1.r.status);
    check("A1 APERÇU : signature électronique + cachet PRÉSENTS (elec + certificat)",
      a1.elements.includes("elec") && a1.elements.includes("certificat") && a1.signe, "elements=[" + a1.elements.join(",") + "]");

    // A2 — GÉNÉRATION (ce qui est RÉELLEMENT envoyé) : AUCUN document historique incohérent
    const journaA2 = [];
    const rA2 = await acceptation.traiterAcceptationFinale(db, dA.id, {
      dechiffrerChamp: (v) => { try { return cryptoBd.dechiffrerChamp(v); } catch { return v; } },
      chiffrerChamp: (v) => cryptoBd.chiffrerChamp(v, false),
      journaliser: (e) => entréesJournal.push(e) && journaA2.push(e),
    });
    check("A2 GÉNÉRATION : AUCUN document (section inactive = interrupteur principal respecté)",
      rA2 && rA2.genere === false && rA2.saute === true && /désactivée/i.test(String(rA2.motif || "")),
      rA2 ? "motif=" + rA2.motif : "");
    const sautTrace = journaA2.find((e) => e.code === "DOC_SIGNE_SAUTE");
    check("A2 GÉNÉRATION : saut TRACÉ au Journal (DOC_SIGNE_SAUTE, source section-dediee)",
      Boolean(sautTrace) && sautTrace.source === "section-dediee", sautTrace ? "source=" + sautTrace.source : "entrée absente");

    // A3 — AUCUN e-mail avec pièce jointe pour cette référence
    await new Promise((r) => setTimeout(r, 400));
    const capteA = await messageAvecPiece("DEM-2026-12001");
    check("A3 AUCUN e-mail de PDF généré pour la demande (rien d'incohérent n'est envoyé)", !capteA, capteA ? "message inattendu !" : "");

    /* ================= B) SECTION ACTIVÉE : aperçu == PDF envoyé ================= */
    console.log("\n— B) interrupteur principal ON : le PDF envoyé == l'aperçu (signature + cachet) —");
    const putB = await adm.put("/api/reponse-pdf-config", cfgPut({ actif: true }));
    check("PUT section : interrupteur principal ON", putB.status === 200, "");

    const dB = await creerDemande("DEM-2026-12002", "dem192-b@test");
    demandesCrees.push(dB.id);
    const rM = await portail.traiterMessageRecu(message({ sujet: "RE: DEM-2026-12002", de: MANAGER, inReplyTo: "<dem192-b@test>", texte: "Congé accepté." }));
    const rR = await portail.traiterMessageRecu(message({ sujet: "RE: DEM-2026-12002", de: RH, inReplyTo: "<dem192-b@test>", texte: "Je valide." }));
    check("B cycle e-mail manager → RH : STATUT FINAL ACCEPTEE", rM && rR && rR.statutApres === "ACCEPTEE",
      rR ? "statutApres=" + rR.statutApres : "");
    const dsB = rR && rR.docSigne;
    check("B GÉNÉRATION : déclenchée automatiquement avec la SOURCE section-dediee",
      Boolean(dsB && dsB.genere) && dsB.signatureCrypto === true
      && Boolean(dsB.elements && dsB.elements.includes("elec") && dsB.elements.includes("certificat")),
      dsB ? "signatureCrypto=" + dsB.signatureCrypto + " elements=[" + (dsB.elements || []).join(",") + "]" : "docSigne absent");
    check("B GÉNÉRATION : e-mail envoyé automatiquement (employé À, RH+manager Cc)",
      Boolean(dsB && dsB.envoi && dsB.envoi.envoye)
      && dsB.envoi.destinataires.a === EMPLOYE
      && (dsB.envoi.destinataires.cc || []).includes(RH) && (dsB.envoi.destinataires.cc || []).includes(MANAGER),
      dsB && dsB.envoi ? JSON.stringify(dsB.envoi.destinataires) : "");

    const capteB = await messageAvecPiece("DEM-2026-12002");
    check("B ENVOI : e-mail capturé avec pièce jointe PDF", Boolean(capteB), "");
    if (capteB) {
      const pdf = capteB.piece.content;
      check("B ENVOI : pièce jointe signée PAdES (/ByteRange présent) — identique à l'aperçu",
        pdf.subarray(0, 4).toString("latin1") === "%PDF" && pdf.toString("latin1").includes("/ByteRange"),
        capteB.piece.filename + " — " + pdf.length + " octets");
    }
    const b1 = await apercuAdmin(adm, dB.id);
    check("B APERÇU de la MÊME demande : MÊMES éléments (elec + certificat + PAdES) → aperçu == envoyé",
      b1.elements.includes("elec") && b1.elements.includes("certificat") && b1.signe,
      "elements=[" + b1.elements.join(",") + "]");

    /* ================= C) CONTINUITÉ HISTORIQUE (ligne jamais engagée) ================= */
    console.log("\n— C) ligne présente mais JAMAIS engagée (actif=false, aucun certificat) : historique inchangé —");
    await db.reponsePdfConfig.update({ where: { id: "reponse-pdf" }, data: {
      actif: false, certChemin: "", certFichierNom: "", certMotDePasse: "",
      certSujet: "", certEmetteur: "", certSerie: "", certEmpreinte: "",
      certValideDu: null, certValideAu: null, certImportLe: null,
    }});
    const dC = await creerDemandeAcceptee("DEM-2026-12003");
    demandesCrees.push(dC.id);
    const journaC = [];
    const rC = await acceptation.traiterAcceptationFinale(db, dC.id, {
      dechiffrerChamp: (v) => { try { return cryptoBd.dechiffrerChamp(v); } catch { return v; } },
      chiffrerChamp: (v) => cryptoBd.chiffrerChamp(v, false),
      journaliser: (e) => journaC.push(e),
    });
    check("C CONTINUITÉ : document QUAND MÊME généré depuis le module historique (comportement v0.2.143)",
      Boolean(rC && rC.genere), rC ? "motif=" + (rC.motif || "généré") : "");
    const entreeC = journaC.find((e) => e.action === "doc-signe" && e.succes === true);
    check("C Journal : source = module-historique (traçabilité de la source)", Boolean(entreeC) && entreeC.source === "module-historique",
      entreeC ? "source=" + entreeC.source : "entrée absente");

    /* ================= D) Journal du cycle e-mail (B) : source tracée ================= */
    const journalBrut = fs.existsSync("logs/journal-emails.log") ? fs.readFileSync("logs/journal-emails.log", "utf8").trim().split("\n") : [];
    const entreeB = journalBrut.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.action === "doc-signe" && e.reference === "DEM-2026-12002" && e.succes === true).pop();
    check("D Journal (doc-signe, cycle e-mail) : source = section-dediee", Boolean(entreeB) && entreeB.source === "section-dediee",
      entreeB ? "source=" + entreeB.source : "entrée absente");

  } catch (e) {
    fail++;
    console.log("  FAIL exception : " + ((e && e.stack) || e));
  } finally {
    /* ---------- nettoyage complet ---------- */
    console.log("\n-- nettoyage --");
    serveurSmtp.close(() => console.log("-- serveur SMTP de capture arrêté --"));
    try {
      for (const id of demandesCrees) {
        const d = await db.demandeAdministrative.findUnique({ where: { id } });
        if (d && d.docSigneChemin) {
          try { fs.unlinkSync("storage/documents-demandes/" + d.docSigneChemin); } catch { /* */ }
        }
        if (d && d.docRefusChemin) {
          try { fs.unlinkSync("storage/documents-demandes/" + d.docRefusChemin); } catch { /* */ }
        }
      }
      if (demandesCrees.length) await db.documentDemande.deleteMany({ where: { demandeId: { in: demandesCrees } } });
      await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
      if (fichierCertificat) { try { fs.unlinkSync(fichierCertificat); } catch { /* */ } }
      if (cfgPdfAvant) await db.reponsePdfConfig.update({ where: { id: "reponse-pdf" }, data: cfgPdfAvant });
      else {
        await db.reponsePdfConfig.update({
          where: { id: "reponse-pdf" },
          data: {
            actif: false, sigActif: true, tamponActif: true, signerActif: true,
            sigImage: "", sigImageNom: "", sigImageChemin: "",
            tamponImage: "", tamponImageNom: "", tamponImageChemin: "",
            qrActif: false, elecActif: false,
            certChemin: "", certFichierNom: "", certMotDePasse: "",
            certSujet: "", certEmetteur: "", certSerie: "", certEmpreinte: "",
            certValideDu: null, certValideAu: null, certImportLe: null,
            certSignataire: "", certFonction: "",
          },
        });
      }
      if (cfgSigAvant) await db.signatureConfig.update({ where: { id: "signature" }, data: cfgSigAvant });
      // (robustesse, APRÈS restauration) artefacts .p12 orphelins
      try {
        const rpcFin = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
        const sigFin = await db.signatureConfig.findUnique({ where: { id: "signature" } });
        if ((!rpcFin || !rpcFin.certChemin) && (!sigFin || !sigFin.certChemin)) {
          for (const f of fs.readdirSync("storage/reponse-pdf")) {
            if (f.endsWith(".p12")) {
              try { fs.unlinkSync("storage/reponse-pdf/" + f); console.log("  (artefact .p12 orphelin supprimé : " + f + ")"); } catch { /* */ }
            }
          }
        }
      } catch { /* dossier absent */ }
      if (cfgMailAvant) await db.mailConfig.update({ where: { id: "smtp" }, data: cfgMailAvant });
      check("Nettoyage : demandes + documents + certificat + configurations restaurées", true);
    } catch (e) {
      check("Nettoyage", false, (e && e.message) || String(e));
    }
  }

  console.log("------------------------------------------------------------");
  console.log("RÉSULTAT : " + ok + " OK, " + fail + " FAIL");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error((e && e.stack) || e); process.exit(1); });
