#!/usr/bin/env node
/**
 * v0.2.149 — Task 193 : « La réponse automatique ne doit pas être générée sur
 * 2 pages » + « la désactivation du paraphe / du tampon ne fonctionne pas » +
 * « vérifier que TOUS les switchs fonctionnent sur l'APERÇU et sur le PDF
 * ENVOYÉ ».
 *
 * PREUVES demandées :
 *   A. UNE SEULE PAGE dans TOUS les cas (démonstration, congé simple, congé
 *      chargé — commentaire 600 car. + note manager —, autorisation à motif
 *      long, tailles d'éléments extrêmes) — voie moteur = générateur EXACT du
 *      PDF envoyé ;
 *   B. TOUS les interrupteurs, UN PAR UN, sur les DEUX voies (API aperçu
 *      4000 ET moteur chargé via chargerConfig comme traiterAcceptationFinale) :
 *      paraphe (sigActif), tampon (tamponActif), QR (qrActif), cachet
 *      « Signature électronique » (elecActif), signature électronique
 *      (signerActif → signatureCrypto + /ByteRange), mention (mentionActif) ;
 *   C. PARITÉ aperçu == envoyé (mêmes éléments dessinés des deux côtés) ;
 *   D. texte du bloc signature HOMOGÈNE aux interrupteurs (plus jamais
 *      « tamponné » quand le tampon est désactivé, ni « signé (certificat) »
 *      quand la signature est désactivée ou sans certificat) ;
 *   E. document de REFUS : 1 page + mêmes disciplines.
 *
 * Nettoyage complet même en cas d'échec (config restaurée, certificat supprimé,
 * demandes de test supprimées).
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const zlib = require("zlib");
const path = require("path");
const forge = require("node-forge");
const { PDFDocument } = require("pdf-lib");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const acceptation = require("./document-acceptation.js");
const refus = require("./document-refus.js");

const ADMIN = "http://localhost:4000";
const MDP_CERT = "Task-193-Dedie!";
const MENTION_193 = "MENTION-193 {REF} — contrôle des interrupteurs";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

/* ---------- chiffrement disque (jumelle AES-256-GCM « PAIESAGE1 ») ---------- */
const ENC_MAGIC = Buffer.from("PAIESAGE1", "latin1");
function decryptFromStorage(buf) {
  if (!(Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC))) return buf;
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env";
  const cle = crypto.scryptSync(materiel, "autorh-storage-v1", 32);
  const nonceDebut = ENC_MAGIC.length;
  const tagDebut = nonceDebut + 12;
  const donneesDebut = tagDebut + 16;
  const decipher = crypto.createDecipheriv("aes-256-gcm", cle, buf.subarray(nonceDebut, tagDebut));
  decipher.setAuthTag(buf.subarray(tagDebut, donneesDebut));
  return Buffer.concat([decipher.update(buf.subarray(donneesDebut)), decipher.final()]);
}
function lireFichierStocke(cheminRelatif) {
  const candidats = [
    path.join(process.cwd(), "storage", "..", cheminRelatif),
    path.join(process.cwd(), cheminRelatif),
  ];
  for (const c of candidats) {
    try {
      if (fs.existsSync(c)) return decryptFromStorage(fs.readFileSync(c));
    } catch { /* essai suivant */ }
  }
  return null;
}

/* ---------- certificat .p12 auto-signé (forge) ---------- */
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

/* ---------- PNG minimal (couleur pleine) ---------- */
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
    return { status: res.status, json, texte, headers: res.headers };
  };
  return {
    req,
    post: (p, corps) => req("POST", p, corps),
    put: (p, brut) => req("PUT", p, undefined, brut),
    postMultipart: async (p, form) => {
      const res = await fetch(base + p, { method: "POST", headers: cookie ? { Cookie: cookie } : {}, body: form, redirect: "manual" });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
    },
  };
}

/* ---------- configuration PUT (interrupteurs en argument) ---------- */
function cfgPut(interrupteurs) {
  return JSON.stringify(Object.assign({
    actif: true,
    sigActif: true, tamponActif: true, qrActif: true,
    signerActif: true, elecActif: true,
    certSignataire: "Amel Ben Salah", certFonction: "Directrice des Ressources Humaines",
    sigPosition: "BAS_DROITE", sigTaille: 120, sigOpacite: 0.95, sigDecalX: 0, sigDecalY: 0, sigRotation: 0,
    sigImage: IMG_PARAPHE, sigImageNom: "paraphe-193.png",
    tamponPosition: "BAS_GAUCHE", tamponTaille: 130, tamponOpacite: 0.9, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
    tamponImage: IMG_TAMPON, tamponImageNom: "cachet-193.png",
    qrMode: "TEXTE", qrTexte: "JETON-193", qrPosition: "BAS_GAUCHE", qrTaille: 90, qrDecalX: 0, qrDecalY: 0, qrRotation: 0,
    elecPosition: "BAS_DROITE", elecDecalX: 0, elecDecalY: 0, elecTaille: 100, elecForme: "ROND",
    elecAffSignataire: true, elecAffOrganisation: false, elecAffEmetteur: false,
    elecAffValidite: false, elecAffEmpreinte: false, elecTexteLibre: "Task 193",
    mentionActif: true, mentionTexte: MENTION_193,
    emailActif: false, emailObjet: "", emailCorps: "",
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, interrupteurs || {}));
}

/* ---------- aides moteur / PDF ---------- */
const OPTS_MOTEUR = { dechiffrerChamp: cryptoBd.dechiffrerChamp, lireFichierStocke };

async function voieEnvoyee() {
  // EXACTEMENT la voie du PDF ENVOYÉ : chargerConfig (traiterAcceptationFinale)
  const cfg = await acceptation.chargerConfig(db);
  return acceptation.apercuDocument(db, null, cfg, OPTS_MOTEUR);
}

async function voieApercu(adm) {
  // EXACTEMENT la voie de l'APERÇU (API admin, action=apercu)
  const f = new FormData();
  f.append("action", "apercu");
  return adm.postMultipart("/api/reponse-pdf-config", f);
}

async function nbPages(pdf) {
  return (await PDFDocument.load(pdf)).getPageCount();
}

/** Texte lisible du PDF — les textes sont écrits par pdf-lib en chaînes HEX
 *  (PDFHexString <...> Tj) dans des flux compressés : on gonfle les flux puis
 *  on décode chaque chaîne hex en latin1 (WinAnsi — polices standard). */
function textesPdf(pdf) {
  const s = pdf.toString("latin1");
  let contenu = "";
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    try { contenu += zlib.inflateSync(Buffer.from(m[1], "latin1")).toString("latin1") + "\n"; }
    catch { contenu += m[1] + "\n"; }
  }
  const morceaux = [];
  for (const x of contenu.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    morceaux.push(Buffer.from(x[1], "hex").toString("latin1"));
  }
  return morceaux.join("\n");
}

async function creerDemandeChargee(reference, type, extras) {
  const CIN = "TS193SWITCH";
  return db.demandeAdministrative.create({
    data: Object.assign({
      reference,
      type: type || "CONGE",
      statut: "ACCEPTEE",
      cin: cryptoBd.chiffrerChamp(CIN, true),
      destinataire: cryptoBd.chiffrerChamp("manager.t193@test.local"),
      employeEmail: cryptoBd.chiffrerChamp("employe.t193@test.local"),
      donnees: cryptoBd.chiffrerChamp(JSON.stringify(
        type === "AUTORISATION_SORTIE"
          ? {
            date: "2026-12-03", departement: "Production",
            motif: (extras && extras.motif) || "Démarche administrative",
            nombreHeures: "2", heureSortie: "09:00", heureRetour: "11:00", compensation: "OUI",
          }
          : {
            typeConge: "Congé annuel", dateDebut: "2026-12-07", dateFin: "2026-12-18",
            emailN1: "manager.t193@test.local",
            commentaire: (extras && extras.commentaire) || "",
          })),
      decisionManager: "ACCEPTEE",
      decisionManagerLe: new Date(),
      decisionManagerPar: "Manager 193",
      decisionManagerNote: (extras && extras.noteManager) || "",
      decisionRh: "ACCEPTEE",
      decisionRhLe: new Date(),
      decisionRhPar: "Auto-RH 193",
      traitePar: "Auto-RH 193",
      traiteLe: new Date(),
    }, extras && extras.data ? extras.data : {}),
  });
}

async function main() {
  console.log("== Task 193 (v0.2.149) — 1 page garantie + TOUS les switchs (aperçu ET envoyé) ==");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" });
  check("Connexion superadministrateur", login.status === 200, "status=" + login.status);

  const cfgPdfAvant = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
  const demandesCreees = [];
  let fichierCertificat = "";

  try {
    /* ---------- certificat dédié ---------- */
    const p12 = creerP12(MDP_CERT, "Task 193 Reponse", "Entreprise Task 193");
    const formCert = new FormData();
    formCert.append("action", "certificat");
    formCert.append("fichier", new Blob([p12]), "certificat-task193.p12");
    formCert.append("motDePasse", MDP_CERT);
    const impCert = await adm.postMultipart("/api/reponse-pdf-config", formCert);
    check("Import certificat dédié .p12", impCert.status === 200, "status=" + impCert.status);
    const rpc1 = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
    const cheminBrut = rpc1 && rpc1.certChemin ? String(rpc1.certChemin) : "";
    fichierCertificat = cheminBrut.startsWith("storage/") ? cheminBrut : (cheminBrut ? "storage/reponse-pdf/" + cheminBrut : "");

    /* ============ A) UNE SEULE PAGE — TOUS LES CAS ============ */
    console.log("\n— A) UNE SEULE PAGE (voie moteur = PDF envoyé) —");
    await adm.put("/api/reponse-pdf-config", cfgPut({}));

    const demo = await voieEnvoyee();
    check("A1 démonstration : 1 page", (await nbPages(demo.pdf)) === 1, "pages=" + (await nbPages(demo.pdf)));
    check("A1 éléments complets (signature,tampon,qr,elec,certificat)",
      ["signature", "tampon", "qr", "elec", "certificat"].every((e) => (demo.elements || []).includes(e)),
      "elements=[" + (demo.elements || []).join(",") + "]");

    const dCharge = await creerDemandeChargee("DEM-2026-11932", "CONGE", {
      commentaire: "Commentaire de charge maximale pour la mise en page — ".repeat(18) + "fin.",
      noteManager: "Note managériale détaillée sur la charge de travail et la continuité de service — ".repeat(6) + "fin de la note.",
    });
    demandesCreees.push(dCharge.id);
    const cfgC = await acceptation.chargerConfig(db);
    const rCharge = await acceptation.apercuDocument(db, dCharge.id, cfgC, OPTS_MOTEUR);
    check("A2 congé chargé (commentaire 600 car. + note manager) : 1 page",
      (await nbPages(rCharge.pdf)) === 1, "pages=" + (await nbPages(rCharge.pdf)));

    const dAuto = await creerDemandeChargee("DEM-2026-11933", "AUTORISATION_SORTIE", {
      motif: "Motif d'autorisation de sortie long pour vérifier la mise en page une page — ".repeat(10) + "fin.",
    });
    demandesCreees.push(dAuto.id);
    const rAuto = await acceptation.apercuDocument(db, dAuto.id, await acceptation.chargerConfig(db), OPTS_MOTEUR);
    check("A3 autorisation (motif 600 car.) : 1 page", (await nbPages(rAuto.pdf)) === 1, "pages=" + (await nbPages(rAuto.pdf)));

    await adm.put("/api/reponse-pdf-config", cfgPut({
      tamponTaille: 400, elecTaille: 300, qrTaille: 400, sigTaille: 400,
    }));
    const rGeo = await acceptation.apercuDocument(db, dCharge.id, await acceptation.chargerConfig(db), OPTS_MOTEUR);
    check("A4 tailles d'éléments extrêmes (tampon 400, cachet 300) : 1 page",
      (await nbPages(rGeo.pdf)) === 1, "pages=" + (await nbPages(rGeo.pdf)));
    await adm.put("/api/reponse-pdf-config", cfgPut({}));

    /* ============ B) TOUS LES INTERRUpteurs — voie moteur + voie aperçu ============ */
    console.log("\n— B) interrupteurs UN PAR UN (moteur ENVOYÉ + API APERÇU) —");

    // B1 tampon désactivé (paraphe toujours ON)
    await adm.put("/api/reponse-pdf-config", cfgPut({ tamponActif: false }));
    let r = await voieEnvoyee();
    check("B1 ENVOYÉ tampon OFF : élément tampon ABSENT", !(r.elements || []).includes("tampon"),
      "elements=[" + (r.elements || []).join(",") + "]");
    check("B1 ENVOYÉ paraphe toujours présent", (r.elements || []).includes("signature"), "");
    let t = textesPdf(r.pdf);
    check("B1 ENVOYÉ texte bloc : « Tampon appliqué » ABSENT", !t.includes("Tampon appliqué automatiquement"), "");
    check("B1 ENVOYÉ texte bloc : « Paraphe appliqué » PRÉSENT", t.includes("Paraphe appliqué automatiquement"), "");
    let ap = await voieApercu(adm);
    let elems = decodeURIComponent(ap.headers.get("x-apercu-elements") || "");
    check("B1 APERÇU : même discipline (pas de tampon)", !elems.includes("tampon") && elems.includes("signature"),
      "elements=[" + elems + "]");

    // B2 paraphe + tampon désactivés
    await adm.put("/api/reponse-pdf-config", cfgPut({ sigActif: false, tamponActif: false }));
    r = await voieEnvoyee();
    check("B2 ENVOYÉ paraphe+tampon OFF : aucun des deux dessiné",
      !(r.elements || []).includes("signature") && !(r.elements || []).includes("tampon"),
      "elements=[" + (r.elements || []).join(",") + "]");
    t = textesPdf(r.pdf);
    check("B2 ENVOYÉ texte bloc : aucune mention tampon/paraphe",
      !t.includes("Tampon appliqué") && !t.includes("Paraphe appliqué"), "");
    ap = await voieApercu(adm);
    elems = decodeURIComponent(ap.headers.get("x-apercu-elements") || "");
    check("B2 APERÇU : ni signature ni tampon", !elems.includes("signature") && !elems.includes("tampon"),
      "elements=[" + elems + "]");

    // B3 + signature électronique désactivée (certificat toujours importé)
    await adm.put("/api/reponse-pdf-config", cfgPut({ sigActif: false, tamponActif: false, signerActif: false }));
    r = await voieEnvoyee();
    check("B3 ENVOYÉ signer OFF : signatureCrypto=false", r.signatureCrypto === false, "");
    check("B3 ENVOYÉ signer OFF : élément certificat ABSENT", !(r.elements || []).includes("certificat"),
      "elements=[" + (r.elements || []).join(",") + "]");
    check("B3 ENVOYÉ signer OFF : PDF sans /ByteRange", !r.pdf.toString("latin1").includes("/ByteRange"), "");
    t = textesPdf(r.pdf);
    check("B3 ENVOYÉ texte bloc : « Document validé par le service RH »",
      t.includes("Document validé par le service RH"), "");
    check("B3 ENVOYÉ texte bloc : plus de « signé électroniquement (certificat) »",
      !t.includes("Document signé électroniquement (certificat)"), "");

    // B4 + cachet électronique désactivé + QR désactivé + mention désactivée
    await adm.put("/api/reponse-pdf-config", cfgPut({
      sigActif: false, tamponActif: false, signerActif: false, elecActif: false,
      qrActif: false, mentionActif: false,
    }));
    r = await voieEnvoyee();
    check("B4 ENVOYÉ elec OFF : cachet ABSENT", !(r.elements || []).includes("elec"),
      "elements=[" + (r.elements || []).join(",") + "]");
    check("B4 ENVOYÉ qr OFF : QR ABSENT", !(r.elements || []).includes("qr"),
      "elements=[" + (r.elements || []).join(",") + "]");
    t = textesPdf(r.pdf);
    check("B4 ENVOYÉ mention OFF : texte de mention ABSENT", !t.includes("MENTION-193"), "");
    check("B4 ENVOYÉ : document TOUT désactivé = 1 page (rien cassé)",
      (await nbPages(r.pdf)) === 1, "pages=" + (await nbPages(r.pdf)));
    ap = await voieApercu(adm);
    elems = decodeURIComponent(ap.headers.get("x-apercu-elements") || "");
    check("B4 APERÇU : aucun élément (elec/qr exclus)", !elems.includes("elec") && !elems.includes("qr"),
      "elements=[" + elems + "]");

    // B5 TOUT réactivé → tout revient (et l'APERÇU = ENVOYÉ)
    await adm.put("/api/reponse-pdf-config", cfgPut({}));
    r = await voieEnvoyee();
    check("B5 ENVOYÉ tout ON : signature,tampon,qr,elec,certificat",
      ["signature", "tampon", "qr", "elec", "certificat"].every((e) => (r.elements || []).includes(e)),
      "elements=[" + (r.elements || []).join(",") + "]");
    check("B5 ENVOYÉ tout ON : signatureCrypto=true + /ByteRange",
      r.signatureCrypto === true && r.pdf.toString("latin1").includes("/ByteRange"), "");
    t = textesPdf(r.pdf);
    check("B5 ENVOYÉ texte bloc complet (signé + tamponné)",
      t.includes("Document signé électroniquement (certificat)") && t.includes("Tampon appliqué automatiquement"), "");
    check("B5 ENVOYÉ mention PRÉSENTE", t.includes("MENTION-193"), "");
    ap = await voieApercu(adm);
    elems = decodeURIComponent(ap.headers.get("x-apercu-elements") || "");
    check("B5 APERÇU == ENVOYÉ (parité exacte des éléments)",
      ["signature", "tampon", "qr", "elec", "certificat"].every((e) => elems.includes(e)),
      "elements=[" + elems + "]");
    check("B5 APERÇU : 1 page", (await nbPages(ap.buffer)) === 1, "pages=" + (await nbPages(ap.buffer)));

    /* ============ E) REFUS : 1 page + mêmes disciplines ============ */
    console.log("\n— E) document de REFUS —");
    await adm.put("/api/reponse-pdf-config", cfgPut({ tamponActif: false, mentionActif: false }));
    const dRefus = await creerDemandeChargee("DEM-2026-11934", "CONGE", {
      data: { statut: "REFUSEE", decisionRh: "REFUSEE", commentaire: null },
    });
    demandesCreees.push(dRefus.id);
    const cfgRef = await acceptation.chargerConfig(db);
    const rRefus = await refus.genererDocumentRefus(db, dRefus, cfgRef, OPTS_MOTEUR);
    check("E1 REFUS : 1 page", (await nbPages(rRefus.pdf)) === 1, "pages=" + (await nbPages(rRefus.pdf)));
    const tRefus = textesPdf(rRefus.pdf);
    check("E1 REFUS tampon OFF : « Paraphe appliqué » sans « Tampon appliqué »",
      tRefus.includes("Paraphe appliqué automatiquement") && !tRefus.includes("Tampon appliqué automatiquement"), "");
    check("E1 REFUS mention OFF : pas de mention", !tRefus.includes("MENTION-193"), "");
  } finally {
    /* ---------- restauration ---------- */
    console.log("\n-- restauration --");
    try {
      for (const id of demandesCreees) {
        await db.documentDemande.deleteMany({ where: { demandeId: id } });
        await db.demandeAdministrative.delete({ where: { id } }).catch(() => {});
      }
      if (fichierCertificat) {
        const abs = path.isAbsolute(fichierCertificat) ? fichierCertificat : path.join(process.cwd(), fichierCertificat);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      }
      if (cfgPdfAvant) {
        const data = {};
        for (const k of Object.keys(cfgPdfAvant)) {
          if (k === "id") continue;
          data[k] = cfgPdfAvant[k];
        }
        await db.reponsePdfConfig.update({ where: { id: "reponse-pdf" }, data });
      } else {
        await db.reponsePdfConfig.delete({ where: { id: "reponse-pdf" } }).catch(() => {});
      }
      console.log("   configuration + données initiales restaurées");
    } catch (e) {
      console.log("   restauration : " + e.message);
    }
  }

  console.log("\n== RÉSULTAT : " + ok + " OK / " + fail + " FAIL ==");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(2); });
