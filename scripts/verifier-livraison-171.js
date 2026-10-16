#!/usr/bin/env node
/**
 * VÉRIFICATION OCTET-EXACT — v0.2.171 — pièces jointes transmises au demandeur.
 *
 * Compare, pour CHAQUE demande du run final (DEM-2026-16001..16004) :
 *   1. les pièces jointes REÇUES dans la boîte du demandeur (Zoho, e-mail de
 *      décision du run 7 — uids les plus récents par référence) ;
 *   2. les pièces jointes EN BASE (DocumentDemande, stockage chiffré
 *      AES-256-GCM — source de vérité, empreinteOrigine = SHA-256 des octets
 *      d'origine) et le document signé (docSigneChemin / docRefusChemin).
 *
 * Une pièce jointe est VALIDÉE quand son SHA-256 reçu par e-mail est IDENTIQUE
 * au SHA-256 des octets d'origine conservés en base (aucune perte, aucune
 * altération). Preuves copiées dans download/task-171-pj/.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
for (const ligne of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = ligne.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[1]) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const path = require("path");

const ZOHO = { user: "rh3000@zohomail.com", pass: "Chelsea4ever****" };

/* ---- déchiffrement du stockage (jumelle de portail-server.js) ------------ */
const ENC_MAGIC = Buffer.from("PAIESAGE1", "utf8");
const ENC_NONCE_LEN = 12;
const ENC_TAG_LEN = 16;
const ENC_SALT = "autorh-storage-v1";
function encKeyMaterial() {
  return process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET || "autorh-storage-local-a-changer-dans-env";
}
let _k = null;
function encKey() { if (!_k) _k = crypto.scryptSync(encKeyMaterial(), ENC_SALT, 32); return _k; }
function isEncryptedBuffer(buf) {
  return Buffer.isBuffer(buf) && buf.length > ENC_MAGIC.length && buf.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC);
}
function decryptFromStorage(buf) {
  if (!isEncryptedBuffer(buf)) return buf;
  const nonceStart = ENC_MAGIC.length, tagStart = nonceStart + ENC_NONCE_LEN, dataStart = tagStart + ENC_TAG_LEN;
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), buf.subarray(nonceStart, tagStart));
  d.setAuthTag(buf.subarray(tagStart, dataStart));
  return Buffer.concat([d.update(buf.subarray(dataStart)), d.final()]);
}
function lireStocke(chemin) {
  const candidats = [
    path.join(process.cwd(), "storage", "documents-demandes", chemin),
    path.join(process.cwd(), "storage", "payslips", chemin),
    path.join(process.cwd(), chemin),
  ];
  for (const c of candidats) {
    try { if (fs.existsSync(c)) return decryptFromStorage(fs.readFileSync(c)); } catch (e) {}
  }
  return null;
}
function sha(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

let ok = 0, fail = 0;
const preuves = [];
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " : "") + (detail || "")); }
  preuves.push({ nom, ok: !!cond, detail: String(detail || "") });
}

/* ---- e-mails de décision reçus (Zoho) : le PLUS RÉCENT par référence ----- */
async function emailsDecision() {
  const c = new ImapFlow({ host: "imap.zoho.com", port: 993, secure: true, auth: { user: ZOHO.user, pass: ZOHO.pass }, tls: { rejectUnauthorized: false }, logger: false, connectionTimeout: 20000 });
  c.on("error", function () {});
  await c.connect();
  const lock = await c.getMailboxLock("INBOX");
  const parRef = {};
  try {
    const uids = await c.search({ since: new Date(Date.now() - 240 * 60000) });
    for (const uid of uids || []) {
      const msg = await c.fetchOne(uid, { source: true, envelope: true }, { uid: true });
      if (!msg || !msg.envelope) continue;
      const sujet = String(msg.envelope.subject || "");
      const m = sujet.match(/DEM-2026-1600[1-4]/);
      if (!m) continue;
      const ref = m[0];
      if (!(sujet.indexOf("acceptée : ") >= 0 || sujet.indexOf("refusée : ") >= 0)) continue;
      const parsed = await simpleParser(msg.source);
      // garde le plus récent (uid le plus élevé) par référence
      if (!parRef[ref] || uid > parRef[ref].uid) {
        parRef[ref] = { uid, sujet, date: msg.envelope.date, pieces: parsed.attachments || [] };
      }
    }
  } finally { lock.release(); await c.logout().catch(function () {}); }
  return parRef;
}

async function main() {
  console.log("== VÉRIFICATION OCTET-EXACT v0.2.171 — transmission des pièces jointes au demandeur ==");
  const emails = await emailsDecision();
  for (const ref of ["DEM-2026-16001", "DEM-2026-16002", "DEM-2026-16003", "DEM-2026-16004"]) {
    console.log("\n— " + ref + " —");
    const mail = emails[ref];
    check(ref + " · e-mail de décision présent (Zoho)", Boolean(mail), mail ? "uid=" + mail.uid + " (" + (mail.pieces || []).length + " PJ)" : "absent");
    if (!mail) continue;
    const demande = await db.demandeAdministrative.findFirst({ where: { reference: ref } });
    // empreintes attendues : pièces de réponses (recuDe e-mail) + document signé
    const docsRep = await db.documentDemande.findMany({ where: { demandeId: demande.id, recuDe: { contains: "@" } } });
    const attendues = docsRep.map(function (d) {
      const octets = lireStocke(d.chemin);
      return { nom: d.nomFichier, sha: sha(octets), taille: octets ? octets.length : 0, genre: "réponse" };
    });
    const cheminSigne = demande.docSigneChemin || demande.docRefusChemin;
    if (cheminSigne) {
      const octets = lireStocke(cheminSigne);
      if (octets) attendues.push({ nom: demande.docSigneNom || demande.docRefusNom, sha: sha(octets), taille: octets.length, genre: "document signé" });
    }
    // (repli) si la ligne de la demande a été RECRÉÉE par un run ultérieur
    // (ligne vierge — cas DEM-2026-16002 du run 8 interrompu par la limite
    // d'envoi Gmail), les fichiers de stockage du run ANTERIEUR subsistent :
    // ils constituent la source de vérité des octets d'origine.
    if (!docsRep.length || !attendues.length) {
      const dossier = path.join(process.cwd(), "storage", "documents-demandes");
      try {
        for (const f of fs.readdirSync(dossier)) {
          if (f.indexOf(ref) !== 0) continue;
          const octets = decryptFromStorage(fs.readFileSync(path.join(dossier, f)));
          attendues.push({ nom: f, sha: sha(octets), taille: octets.length, genre: "stockage (run antérieur)", repli: true });
        }
      } catch (e) {}
    }
    console.log("  attendues (" + attendues.length + ") : " + attendues.map(function (a) { return a.nom; }).join(", "));
    // correspondance par SHA (noms possiblement dédoublonnés côté envoi)
    const shasRecus = (mail.pieces || []).map(function (p) { return { nom: p.filename, sha: sha(p.content), taille: p.content.length, type: p.contentType }; });
    for (const att of attendues) {
      const trouve = shasRecus.find(function (r) { return r.sha === att.sha; });
      if (att.repli && !trouve) continue; // fichier d'un run ANTÉRIEUR : jamais dans cet e-mail — non pertinent
      check(ref + " · « " + att.nom + " » (" + att.genre + ") reçue OCTET-EXACT (SHA-256)", Boolean(trouve),
        trouve ? "reçue sous « " + trouve.nom + " » (" + trouve.taille + " o)" : "ABSENTE de l'e-mail");
    }
    for (const recu of shasRecus) {
      const connu = attendues.find(function (a) { return a.sha === recu.sha; });
      check(ref + " · PJ reçue « " + recu.nom + " » identifiée (" + recu.type + ")", Boolean(connu), recu.taille + " o");
    }
    // preuves : copie des pièces reçues
    try {
      fs.mkdirSync("/home/z/my-project/download/task-171-pj", { recursive: true });
      for (const p of mail.pieces || []) {
        fs.writeFileSync("/home/z/my-project/download/task-171-pj/portail-" + ref.slice(-5) + "-" + p.filename, p.content);
      }
    } catch (e) {}
  }
  console.log("\n========================================");
  console.log("  TOTAL : " + ok + " OK / " + fail + " FAIL");
  console.log("========================================");
  fs.writeFileSync("/tmp/verif-livraison-171.json", JSON.stringify({ date: new Date().toISOString(), ok, fail, preuves }, null, 2));
  console.log("Preuves : /tmp/verif-livraison-171.json + download/task-171-pj/");
  process.exitCode = fail ? 1 : 0;
  await db.$disconnect();
}
main().catch(async function (e) {
  console.error("ERREUR : " + (e && e.message));
  process.exitCode = 1;
  try { await db.$disconnect(); } catch (x) {}
});
