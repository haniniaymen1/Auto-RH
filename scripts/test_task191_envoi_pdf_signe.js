#!/usr/bin/env node
/**
 * v0.2.147 — PREUVE E2E « envoi automatique par e-mail du PDF signé
 * électroniquement » (question utilisateur, trace 1a1176f0fefdf125) :
 * « Est-ce que vous testez l'envoi automatique par e-mail du PDF signé
 *   électroniquement lorsque le switch est activé et qu'un certificat
 *   électronique est importé et le caché activé ? »
 *
 * Réponse par la PREUVE, sur le serveur vivant (administration v0.2.147)
 * + le VRAI moteur de réception (traiterMessageRecu, portail en mode
 * module) + un SERVEUR SMTP DE CAPTURE local (smtp-server, 127.0.0.1:12525)
 * sur lequel la MailConfig du portail est pointée : chaque e-mail envoyé
 * par l'application est ENREGISTRÉ puis ANALYSÉ (mailparser).
 *
 *   A. Certificat .p12 DÉDIÉ importé via l'API admin ; section
 *      « Réponse automatique PDF » : actif + signerActif (SIGNATURE
 *      électronique) + elecActif (CACHET « Signature électronique ») +
 *      emailActif (ENVOI automatique) — paraphe/tampon/QR désactivés pour
 *      isoler ce qui est testé.
 *   B. Demande CONGÉ créée → MANAGER répond par e-mail « Congé accepté »
 *      → decisionManager=ACCEPTEE, statut EN_ATTENTE (matrice deux étapes)
 *      + e-mail de transmission aux RH (capturé).
 *   C. RH répond par e-mail « Je valide » (v0.2.146) → STATUT FINAL
 *      ACCEPTEE → déclencheur doc-signe AUTOMATIQUE → PDF généré + cachet
 *      + SIGNATURE PAdES → e-mail AUTOMATIQUE (employé À, RH+manager Cc).
 *   Vérifications : résultat moteur (genere / signatureCrypto / elements
 *   elec+certificat / avertissements vides / envoi.envoye + destinataires),
 *   MESSAGE SMTP CAPTURÉ (sujet {REF}, À/Cc, PIÈCE JOINTE PDF nommée
 *   Acceptation_conge_<ref>.pdf contenant /ByteRange = signature PAdES),
 *   traces DB (docSigneChemin/Le/Par/Destinataires, docSigneErreur absent,
 *   DocumentDemande, fichier conservé), Journal (journal-emails.log).
 *   D. TÉMOIN : signerActif=false + elecActif=false (certificat toujours
 *      importé) → nouveau cycle e-mail complet → PDF généré et envoyé mais
 *      SANS signature crypto (signatureCrypto=0, pas de /ByteRange) et
 *      SANS cachet (elements exclus), avertissements vides (désactivation
 *      volontaire) — preuve que les interrupteurs pilotent bien le flux.
 *
 * Nettoyage complet (documents + demandes + certificat importé + config
 * dédiée restaurée + MailConfig restauré) même en cas d'échec.
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

const ADMIN = "http://localhost:4000";
const SMTP_PORT = 12525;
const MANAGER = "manager.diag1191@test.local";
const RH = "rh.diag1191@test.local";
const EMPLOYE = "employe.diag1191@test.local";
const CIN_TEST = "TS1191DIAG";
const OBJET_DOC = "E2E-191 {REF} — décision et document signé";
const MDP_CERT = "E2E-191-Dedie!";

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
  onRcptTo(adresse, session, cb) { cb(); },
  onData(flux, session, cb) {
    const morceaux = [];
    flux.on("data", (d) => morceaux.push(d));
    flux.on("end", () => {
      messagesCaptures.push(Buffer.concat(morceaux));
      cb();
    });
    flux.on("error", () => cb(new Error("flux interrompu")));
  },
});

/* ---------- certificat .p12 auto-signé (forge) — jumelle test 185 ---------- */
function creerP12(mdp, cn, org) {
  const cles = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = cles.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { name: "commonName", value: cn },
    { name: "organizationName", value: org },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(cles.privateKey, forge.md.sha256.create());
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], mdp, { generateLocalKeyId: true, algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), "binary");
}

/* PNG minimal (couleur pleine) — jumelle du test 185 (images paraphe/tampon). */
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
const IMG_PARAPHE = "data:image/png;base64," + pngMinimal(20, 60, 40, 120, 48).toString("base64");
const IMG_TAMPON = "data:image/png;base64," + pngMinimal(180, 30, 30, 100, 100).toString("base64");

/* ---------- client HTTP administrateur (cookie persistant) ---------- */
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
    try { json = JSON.parse(texte); } catch { /* html */ }
    return { status: res.status, json, texte };
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
      return { status: res.status, json, texte };
    },
  };
}

/* ---------- e-mails simulés (shape identique au test 189) ---------- */
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

/* ---------- création demande CONGÉ (format RÉEL : 5 chiffres) ---------- */
async function creerDemande(reference, messageId) {
  return db.demandeAdministrative.create({
    data: {
      reference,
      type: "CONGE",
      statut: "EN_ATTENTE",
      cin: cryptoBd.chiffrerChamp(CIN_TEST, true),
      destinataire: cryptoBd.chiffrerChamp(MANAGER),
      employeEmail: cryptoBd.chiffrerChamp(EMPLOYE),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify({
        typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
        emailN1: MANAGER, commentaire: "Dossier E2E 191",
      })),
      messageIdEnvoi: messageId,
    },
  });
}

/* ---------- analyse des messages capturés (cache) ---------- */
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

/* ---------- configuration PUT (interrupteurs en argument) ---------- */
function cfgPut(interrupteurs) {
  return JSON.stringify(Object.assign({
    actif: true, sigActif: true, tamponActif: true, qrActif: false,
    signerActif: true, elecActif: true,
    certSignataire: "Amel Ben Salah", certFonction: "Directrice des Ressources Humaines",
    sigPosition: "BAS_DROITE", sigTaille: 130, sigOpacite: 0.95, sigDecalX: 0, sigDecalY: 0, sigRotation: 0,
    sigImage: IMG_PARAPHE, sigImageNom: "paraphe-191.png",
    tamponPosition: "BAS_GAUCHE", tamponTaille: 145, tamponOpacite: 0.9, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
    tamponImage: IMG_TAMPON, tamponImageNom: "cachet-191.png",
    elecForme: "ROND", elecPosition: "HAUT_DROITE", elecDecalX: 0, elecDecalY: 0, elecTaille: 120,
    elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: "E2E 191",
    mentionActif: false, mentionTexte: "",
    emailActif: true, emailObjet: OBJET_DOC, emailCorps: "",
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, interrupteurs || {}));
}

/* ---------- cycle e-mail manager → RH ---------- */
async function cycleEmail(demande, messageId) {
  const rM = await portail.traiterMessageRecu(message({
    sujet: "RE: " + demande.reference, de: MANAGER, inReplyTo: "<" + messageId + ">", texte: "Congé accepté.",
  }));
  const rR = await portail.traiterMessageRecu(message({
    sujet: "RE: " + demande.reference, de: RH, inReplyTo: "<" + messageId + ">", texte: "Je valide.",
  }));
  return { rM, rR };
}

async function main() {
  console.log("== Task 191 (v0.2.147) — envoi automatique par e-mail du PDF signé (switch + certificat + cachet) ==");
  // (callback form PROUVÉE — l'événement « listening » de smtp-server n'est
  // pas toujours délivré aux écouteurs .on selon la version)
  await new Promise((resolve, rejet) => {
    serveurSmtp.on("error", rejet);
    serveurSmtp.listen(SMTP_PORT, "127.0.0.1", resolve);
  });
  console.log("-- serveur SMTP de capture local sur 127.0.0.1:" + SMTP_PORT + " --");

  const cfgMailAvant = await db.mailConfig.findUnique({ where: { id: "smtp" } });
  const cfgPdfAvant = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const demandesCrees = [];
  const fichiersSignes = [];
  let fichierCertificat = "";

  try {
    /* ---------- semis : MailConfig du portail → serveur de capture ---------- */
    console.log("-- semis : MailConfig → SMTP local de capture ; certificat + section activée --");
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

    const adm = client(ADMIN);
    const login = await adm.post("/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" });
    check("Connexion superadministrateur (v0.2.147 vivante)", login.status === 200, "status=" + login.status);

    const p12 = creerP12(MDP_CERT, "Reponse PDF 191", "Entreprise E2E 191");
    const formCert = new FormData();
    formCert.append("action", "certificat");
    formCert.append("fichier", new Blob([p12]), "certificat-e2e-191.p12");
    formCert.append("motDePasse", MDP_CERT);
    const impCert = await adm.postMultipart("/api/reponse-pdf-config", formCert);
    check("Import certificat électronique DÉDIÉ (.p12)", impCert.status === 200 && impCert.json && impCert.json.ok === true,
      impCert.status === 200 ? "" : (impCert.texte || "").slice(0, 120));
    const rpcApresImport = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
    // (certChemin peut être stocké avec ou sans le préfixe du dossier)
    const cheminCertBrut = rpcApresImport && rpcApresImport.certChemin ? String(rpcApresImport.certChemin) : "";
    fichierCertificat = cheminCertBrut.startsWith("storage/") ? cheminCertBrut : (cheminCertBrut ? "storage/reponse-pdf/" + cheminCertBrut : "");
    check("Certificat enregistré dans la section (certChemin)", Boolean(fichierCertificat), fichierCertificat || "(vide)");

    const putA = await adm.put("/api/reponse-pdf-config", cfgPut({ sigActif: false, tamponActif: false }));
    check("PUT section : signature électronique + cachet + envoi e-mail ACTIVÉS", putA.status === 200,
      putA.status === 200 ? "" : (putA.texte || "").slice(0, 120));

    /* ================= A) CYCLE COMPLET PAR E-MAIL ================= */
    console.log("\n— A) switch signature ON + certificat importé + cachet ON : cycle e-mail manager → RH —");
    const dA = await creerDemande("DEM-2026-11901", "dem191-a@test");
    demandesCrees.push(dA.id);
    const { rM, rR } = await cycleEmail(dA, "dem191-a@test");

    check("Manager répond « Congé accepté » → decisionManager=ACCEPTEE",
      rM && rM.statut === "TRAITE" && rM.decisionManager === "ACCEPTEE", rM ? "statutApres=" + rM.statutApres : "aucune réponse");
    check("Matrice deux étapes : statut EN_ATTENTE après le manager seul", rM && rM.statutApres === "EN_ATTENTE", "");
    check("RH répond « Je valide » (v0.2.146) → STATUT FINAL ACCEPTEE", rR && rR.statutApres === "ACCEPTEE",
      rR ? "statutApres=" + rR.statutApres : "aucune réponse");

    const ds = rR && rR.docSigne;
    check("Déclencheur doc-signe AUTOMATIQUE (génération lancée)", Boolean(ds && ds.genere), ds ? "" : "docSigne absent");
    check("SIGNATURE PAdES appliquée (signatureCrypto=true)", ds && ds.signatureCrypto === true, ds ? "signatureCrypto=" + ds.signatureCrypto : "");
    check("CACHET « Signature électronique » dessiné (elec) + certificat chargé",
      Boolean(ds && ds.elements && ds.elements.includes("elec") && ds.elements.includes("certificat")),
      ds ? "elements=[" + (ds.elements || []).join(",") + "]" : "");
    check("Aucun avertissement (certificat présent)", Boolean(ds && Array.isArray(ds.avertissements) && ds.avertissements.length === 0),
      ds ? JSON.stringify(ds.avertissements || []) : "");
    check("ENVOI E-MAIL automatique effectué (envoi.envoye=true)", Boolean(ds && ds.envoi && ds.envoi.envoye),
      ds && ds.envoi ? "messageId=" + String(ds.envoi.messageId || "").slice(0, 30) + "…" : "");
    check("Destinataires : employé en À + RH et manager en Cc",
      Boolean(ds && ds.envoi && ds.envoi.destinataires && ds.envoi.destinataires.a === EMPLOYE
        && (ds.envoi.destinataires.cc || []).includes(RH) && (ds.envoi.destinataires.cc || []).includes(MANAGER)),
      ds && ds.envoi ? JSON.stringify(ds.envoi.destinataires) : "");

    const capte = await messageAvecPiece("DEM-2026-11901");
    check("E-MAIL DU PDF SIGNÉ capturé sur le serveur SMTP local", Boolean(capte), capte ? "" : "aucun message avec pièce jointe PDF");
    if (capte) {
      const pdf = capte.piece.content;
      check("Pièce jointe = PDF lisible (%PDF)", String(capte.piece.contentType).includes("pdf") && pdf.subarray(0, 4).toString("latin1") === "%PDF",
        pdf.length + " octets");
      check("Nom de fichier : Acceptation_conge_DEM-2026-11901.pdf", capte.piece.filename === "Acceptation_conge_DEM-2026-11901.pdf",
        String(capte.piece.filename));
      check("SIGNATURE PAdES dans la pièce jointe (/ByteRange présent)", pdf.toString("latin1").includes("/ByteRange"), "");
      check("Destinataire À = employé", Boolean(capte.parse.to && capte.parse.to.text.includes(EMPLOYE)), capte.parse.to ? capte.parse.to.text : "");
      check("Cc = RH + manager", Boolean(capte.parse.cc && capte.parse.cc.text.includes(RH) && capte.parse.cc.text.includes(MANAGER)),
        capte.parse.cc ? capte.parse.cc.text : "");
      check("Sujet = modèle {REF} rempli", capte.parse.subject === "E2E-191 DEM-2026-11901 — décision et document signé",
        String(capte.parse.subject));
    }

    const dA2 = await db.demandeAdministrative.findUnique({ where: { id: dA.id } });
    check("Trace DB : docSigneChemin + docSigneEnvoiLe + docSignePar « réponse e-mail des RH »",
      Boolean(dA2 && dA2.docSigneChemin) && Boolean(dA2 && dA2.docSigneEnvoiLe) && String(dA2 && dA2.docSignePar || "").includes("réponse e-mail des RH"),
      dA2 ? "par=" + dA2.docSignePar : "");
    check("Trace DB : docSigneDestinataires (chiffré) → employé en À", (() => {
      try {
        const t = JSON.parse(cryptoBd.dechiffrerChamp(dA2.docSigneDestinataires, false));
        return t.a === EMPLOYE && (t.cc || []).includes(RH);
      } catch { return false; }
    })(), "");
    check("Trace DB : docSigneErreur ABSENT (aucun incident d'envoi)", Boolean(dA2) && !dA2.docSigneErreur, dA2 ? String(dA2.docSigneErreur || "") : "");
    const docDb = await db.documentDemande.findFirst({ where: { demandeId: dA.id } });
    check("DocumentDemande créé (détail RH + « Mes demandes » portail)", Boolean(docDb) && docDb.taille > 1000,
      docDb ? docDb.nomFichier + " — " + docDb.taille + " o" : "");
    if (dA2 && dA2.docSigneChemin) {
      const cheminStocke = "storage/documents-demandes/" + dA2.docSigneChemin;
      check("PDF signé conservé (stockage, servi RH + portail)", fs.existsSync(cheminStocke) && fs.statSync(cheminStocke).size > 0, cheminStocke);
      fichiersSignes.push(cheminStocke);
    }

    const journalBrut = fs.existsSync("logs/journal-emails.log") ? fs.readFileSync("logs/journal-emails.log", "utf8").trim().split("\n") : [];
    const entreesDoc = journalBrut.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((e) => e && e.action === "doc-signe" && e.reference === "DEM-2026-11901");
    const derniere = entreesDoc[entreesDoc.length - 1];
    check("Journal (doc-signe) : succes + signatureCrypto=true + envoi=envoye",
      Boolean(derniere) && derniere.succes === true && derniere.signatureCrypto === true && derniere.envoi === "envoye",
      derniere ? "" : "entrée absente du journal");

    /* ================= B) TÉMOIN : interrupteurs OFF ================= */
    console.log("\n— B) TÉMOIN : signerActif=false + elecActif=false (certificat toujours importé) —");
    const putB = await adm.put("/api/reponse-pdf-config", cfgPut({ sigActif: false, tamponActif: false, signerActif: false, elecActif: false }));
    check("PUT témoin accepté", putB.status === 200, putB.status === 200 ? "" : (putB.texte || "").slice(0, 120));

    const dB = await creerDemande("DEM-2026-11902", "dem191-b@test");
    demandesCrees.push(dB.id);
    const { rR: rRB } = await cycleEmail(dB, "dem191-b@test");
    const dsB = rRB && rRB.docSigne;
    check("Témoin : statut final ACCEPTEE (cycle e-mail inchangé)", rRB && rRB.statutApres === "ACCEPTEE", rRB ? "statutApres=" + rRB.statutApres : "");
    check("Témoin : document QUAND MÊME généré (section active)", Boolean(dsB && dsB.genere), dsB ? "" : "docSigne absent");
    check("Témoin : AUCUNE signature crypto (signatureCrypto=false)", dsB && dsB.signatureCrypto === false, dsB ? "signatureCrypto=" + dsB.signatureCrypto : "");
    check("Témoin : cachet + certificat ABSENTS (elements exclus)",
      Boolean(dsB && dsB.elements && !dsB.elements.includes("elec") && !dsB.elements.includes("certificat")),
      dsB ? "elements=[" + (dsB.elements || []).join(",") + "]" : "");
    check("Témoin : aucun avertissement (désactivation volontaire)", Boolean(dsB && Array.isArray(dsB.avertissements) && dsB.avertissements.length === 0),
      dsB ? JSON.stringify(dsB.avertissements || []) : "");
    check("Témoin : e-mail QUAND MÊME envoyé (flux d'envoi intact)", Boolean(dsB && dsB.envoi && dsB.envoi.envoye), "");

    const capteB = await messageAvecPiece("DEM-2026-11902");
    check("Témoin : e-mail capturé avec pièce jointe PDF", Boolean(capteB), "");
    if (capteB) {
      check("Témoin : PDF SANS signature PAdES (/ByteRange absent)",
        !capteB.piece.content.toString("latin1").includes("/ByteRange"), capteB.piece.filename);
    }

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
          const chemin = "storage/documents-demandes/" + d.docSigneChemin;
          try { fs.unlinkSync(chemin); } catch { /* déjà absent */ }
        }
      }
      if (demandesCrees.length) await db.documentDemande.deleteMany({ where: { demandeId: { in: demandesCrees } } });
      await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
      if (fichierCertificat) { try { fs.unlinkSync(fichierCertificat); } catch { /* déjà absent */ } }
      if (cfgPdfAvant) {
        await db.reponsePdfConfig.update({ where: { id: "reponse-pdf" }, data: cfgPdfAvant });
      } else {
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
      // (robustesse, APRÈS restauration) artefacts .p12 orphelins de runs E2E
      // antérieurs — la DB étant restaurée SANS certificat, tout .p12 restant
      // dans le dossier dédié est un artefact de test
      try {
        const rpcFin = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
        if (!rpcFin || !rpcFin.certChemin) {
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
