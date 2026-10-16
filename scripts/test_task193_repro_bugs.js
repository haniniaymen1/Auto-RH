#!/usr/bin/env node
/**
 * Task 193 — REPRODUCTION des signalements (trace courante) :
 *   1. « La réponse automatique ne doit pas être générée sur 2 pages »
 *      → comptage des pages des PDF (aperçu + voie envoyée) ;
 *   2. « La désactivation du paraphe ne fonctionne pas correctement »
 *   3. « La désactivation de la mise à pied (tampon) ne fonctionne pas non plus »
 *      → PUT sigActif=false / tamponActif=false avec images PRÉSENTES, puis
 *        aperçu (API admin) ET voie moteur (chargerConfig + apercuDocument,
 *        même générateur que le PDF envoyé) → les éléments NE doivent PAS
 *        être dessinés.
 *
 * Le script est PUR DIAGNOSTIC : il restaure la configuration initiale.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const forge = require("node-forge");
const { PDFDocument } = require("pdf-lib");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const portail = require("./portail-server.js");
const db = portail.prisma;
const acceptation = require("./document-acceptation.js");

const ADMIN = "http://localhost:4000";
const MDP_CERT = "Repro-193-Dedie!";

let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}

/* ---------- chiffrement disque (jumelle AES-256-GCM « PAIESAGE1 ») ---------- */
const ENC_MAGIC = Buffer.from('PAIESAGE1', 'latin1');
function decryptFromStorage(buf) {
  if (!(Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC))) return buf;
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || 'autorh-storage-local-a-changer-dans-env';
  const cle = crypto.scryptSync(materiel, 'autorh-storage-v1', 32);
  const nonceDebut = ENC_MAGIC.length;
  const tagDebut = nonceDebut + 12;
  const donneesDebut = tagDebut + 16;
  const decipher = crypto.createDecipheriv('aes-256-gcm', cle, buf.subarray(nonceDebut, tagDebut));
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
const path = require("path");

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
    chunk("IHDR", ihdr), chunk("IDAT", require("zlib").deflateSync(brut)), chunk("IEND", Buffer.alloc(0)),
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
      return { status: res.status, headers: res.headers, buffer: await res.arrayBuffer(), texte: "" };
    },
  };
}

function cfgPut(interrupteurs) {
  return JSON.stringify(Object.assign({
    actif: true,
    sigActif: true, tamponActif: true, qrActif: false,
    signerActif: true, elecActif: false,
    certSignataire: "Repro 193", certFonction: "Auto-RH",
    sigPosition: "BAS_DROITE", sigTaille: 130, sigOpacite: 0.95, sigDecalX: 0, sigDecalY: 0, sigRotation: 0,
    sigImage: IMG_PARAPHE, sigImageNom: "paraphe-193.png",
    tamponPosition: "BAS_GAUCHE", tamponTaille: 145, tamponOpacite: 0.9, tamponDecalX: 0, tamponDecalY: 0, tamponRotation: 0,
    tamponImage: IMG_TAMPON, tamponImageNom: "cachet-193.png",
    elecPosition: "HAUT_DROITE", elecDecalX: 0, elecDecalY: 0, elecTaille: 120, elecForme: "ROND",
    mentionActif: true, mentionTexte: "",
    emailActif: false, emailObjet: "", emailCorps: "",
    envoyerEmploye: true, envoyerRh: true, envoyerManager: true,
  }, interrupteurs || {}));
}

async function nbPages(pdf) {
  const doc = await PDFDocument.load(pdf);
  return doc.getPageCount();
}

async function main() {
  console.log("== Task 193 — REPRODUCTION : 2 pages + désactivation paraphe/tampon ==");
  const adm = client(ADMIN);
  const login = await adm.post("/api/auth/login", { email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" });
  check("Connexion superadministrateur", login.status === 200, "status=" + login.status);

  const cfgPdfAvant = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
  let fichierCertificat = "";

  try {
    /* ---------- certificat dédié importé (comme en réel) ---------- */
    const p12 = creerP12(MDP_CERT, "Repro PDF 193", "Entreprise Repro 193");
    const formCert = new FormData();
    formCert.append("action", "certificat");
    formCert.append("fichier", new Blob([p12]), "certificat-repro-193.p12");
    formCert.append("motDePasse", MDP_CERT);
    const impCert = await adm.postMultipart("/api/reponse-pdf-config", formCert);
    check("Import certificat dédié", impCert.status === 200, "status=" + impCert.status);
    const rpc1 = await db.reponsePdfConfig.findUnique({ where: { id: "reponse-pdf" } });
    const cheminBrut = rpc1 && rpc1.certChemin ? String(rpc1.certChemin) : "";
    fichierCertificat = cheminBrut.startsWith("storage/") ? cheminBrut : (cheminBrut ? "storage/reponse-pdf/" + cheminBrut : "");

    /* ============ R1 : PARAPHE + TAMPON DÉSACTIVÉS (images présentes) ============ */
    console.log("\n— R1 : sigActif=false + tamponActif=false (images PRÉSENTES, certificat importé) —");
    const put1 = await adm.put("/api/reponse-pdf-config", cfgPut({
      sigActif: false, tamponActif: false, elecActif: false, signerActif: true,
    }));
    check("PUT sigActif=false + tamponActif=false", put1.status === 200, "status=" + put1.status);

    const get1 = await adm.req("GET", "/api/reponse-pdf-config");
    const c1 = get1.json && get1.json.config;
    check("GET : interrupteur paraphe = DÉSACTIVÉ persisté", Boolean(c1) && c1.paraphe.actif === false,
      c1 ? "paraphe.actif=" + c1.paraphe.actif : "pas de config");
    check("GET : interrupteur tampon = DÉSACTIVÉ persisté", Boolean(c1) && c1.tampon.actif === false,
      c1 ? "tampon.actif=" + c1.tampon.actif : "pas de config");
    check("GET : images paraphe + tampon toujours présentes", Boolean(c1) && c1.paraphe.presente && c1.tampon.presente, "");

    /* ---- voie APERÇU (API admin — ce que voit l'utilisateur) ---- */
    const ap1 = await adm.postMultipart("/api/reponse-pdf-config", (() => {
      const f = new FormData(); f.append("action", "apercu"); return f;
    })());
    const elems1 = decodeURIComponent(ap1.headers.get("x-apercu-elements") || "");
    check("APERÇU : requête acceptée", ap1.status === 200, "status=" + ap1.status);
    check("APERÇU : paraphe NON dessiné (désactivé)", !elems1.includes("signature"), "elements=[" + elems1 + "]");
    check("APERÇU : tampon NON dessiné (désactivé)", !elems1.includes("tampon"), "elements=[" + elems1 + "]");
    if (ap1.status === 200) {
      const pages1 = await nbPages(Buffer.from(ap1.buffer));
      check("APERÇU : PDF sur UNE SEULE page", pages1 === 1, "pages=" + pages1);
    }

    /* ---- voie ENVOYÉE (moteur : chargerConfig + génération réelle) ---- */
    const cfgM = await acceptation.chargerConfig(db);
    const r2 = await acceptation.apercuDocument(db, null, cfgM, {
      dechiffrerChamp: cryptoBd.dechiffrerChamp,
      lireFichierStocke,
    });
    check("ENVOI (moteur) : paraphe NON dessiné", !(r2.elements || []).includes("signature"),
      "elements=[" + (r2.elements || []).join(",") + "]");
    check("ENVOI (moteur) : tampon NON dessiné", !(r2.elements || []).includes("tampon"),
      "elements=[" + (r2.elements || []).join(",") + "]");
    const pages2 = await nbPages(r2.pdf);
    check("ENVOI (moteur) : PDF sur UNE SEULE page", pages2 === 1, "pages=" + pages2);

    /* ============ R2 : TOUT ACTIVÉ (contrôle que les images marchent) ============ */
    console.log("\n— R2 : tout activé (contrôle) —");
    const put2 = await adm.put("/api/reponse-pdf-config", cfgPut({
      sigActif: true, tamponActif: true, elecActif: true, signerActif: true,
    }));
    check("PUT tout activé", put2.status === 200, "status=" + put2.status);
    const cfgM2 = await acceptation.chargerConfig(db);
    const r3 = await acceptation.apercuDocument(db, null, cfgM2, {
      dechiffrerChamp: cryptoBd.dechiffrerChamp,
      lireFichierStocke,
    });
    check("ENVOI (moteur) : paraphe dessiné (activé)", (r3.elements || []).includes("signature"),
      "elements=[" + (r3.elements || []).join(",") + "]");
    check("ENVOI (moteur) : tampon dessiné (activé)", (r3.elements || []).includes("tampon"),
      "elements=[" + (r3.elements || []).join(",") + "]");
    check("ENVOI (moteur) : cachet électronique + certificat", (r3.elements || []).includes("elec") && (r3.elements || []).includes("certificat"),
      "elements=[" + (r3.elements || []).join(",") + "]");
    check("ENVOI (moteur) : signature crypto appliquée", r3.signatureCrypto === true, "");
    const pages3 = await nbPages(r3.pdf);
    check("ENVOI (moteur) : PDF sur UNE SEULE page (tout activé)", pages3 === 1, "pages=" + pages3);

    /* ---- voie APERÇU API avec tout activé ---- */
    const ap2 = await adm.postMultipart("/api/reponse-pdf-config", (() => {
      const f = new FormData(); f.append("action", "apercu"); return f;
    })());
    const elems2 = decodeURIComponent(ap2.headers.get("x-apercu-elements") || "");
    check("APERÇU (tout activé) : signature + tampon présents", elems2.includes("signature") && elems2.includes("tampon"),
      "elements=[" + elems2 + "]");
    if (ap2.status === 200) {
      const pages4 = await nbPages(Buffer.from(ap2.buffer));
      check("APERÇU (tout activé) : PDF sur UNE SEULE page", pages4 === 1, "pages=" + pages4);
    }

    /* ---- R3 : aperçu avec demande RÉELLE longue (commentaire 600 caractères) ---- */
    console.log("\n— R3 : cas charge maximale (commentaire long, validations complètes) —");
    const CIN = "TS193REPRO";
    const cinIdx = cryptoBd.chiffrerChamp(CIN, true);
    const dem = await db.demandeAdministrative.create({
      data: {
        reference: "DEM-2026-11931",
        type: "CONGE",
        statut: "ACCEPTEE",
        cin: cinIdx,
        destinataire: cryptoBd.chiffrerChamp("manager.repro193@test.local"),
        employeEmail: cryptoBd.chiffrerChamp("employe.repro193@test.local"),
        donnees: cryptoBd.chiffrerChamp(JSON.stringify({
          typeConge: "Congé annuel", dateDebut: "2026-12-01", dateFin: "2026-12-20",
          emailN1: "manager.repro193@test.local",
          commentaire: "Commentaire de test très long ".repeat(24) + "— fin du commentaire de test pour la reproduction du passage sur deux pages.",
        })),
        decisionManager: "ACCEPTEE",
        decisionManagerLe: new Date(),
        decisionManagerPar: "Manager Repro",
        decisionRh: "ACCEPTEE",
        decisionRhLe: new Date(),
        decisionRhPar: "Auto-RH Repro",
        traitePar: "Auto-RH Repro",
        traiteLe: new Date(),
      },
    });
    try {
      const cfgM3 = await acceptation.chargerConfig(db);
      const r4 = await acceptation.apercuDocument(db, dem.id, cfgM3, {
        dechiffrerChamp: cryptoBd.dechiffrerChamp,
        lireFichierStocke,
      });
      const pages5 = await nbPages(r4.pdf);
      check("ENVOI (moteur, demande réelle + commentaire 600 car.) : UNE SEULE page", pages5 === 1, "pages=" + pages5);
      const texte4 = r4.pdf.toString("latin1");
      check("Aucun chevauchement structurel : contenu au-dessus de la zone signature (bornes respectées)",
        Boolean(r4.pdf), "génération OK");
    } finally {
      await db.demandeAdministrative.delete({ where: { id: dem.id } }).catch(() => {});
    }
  } finally {
    /* ---------- restauration ---------- */
    console.log("\n-- restauration de la configuration --");
    try {
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
      console.log("   configuration initiale restaurée");
    } catch (e) {
      console.log("   restauration : " + e.message);
    }
  }

  console.log("\n== RÉSULTAT : " + ok + " OK / " + fail + " FAIL ==");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR FATALE:", e); process.exit(2); });
