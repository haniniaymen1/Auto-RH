#!/usr/bin/env node
/**
 * Task 244 — PREUVE E2E « Conservation des signatures électroniques dans les
 * portails Employé et Administration ».
 *
 * DEMANDE : lorsque la signature électronique est modifiée ou remplacée dans
 * les paramètres, toutes les fiches de paie DÉJÀ signées conservent leur
 * signature D'ORIGINE (Portail Employé + Portail Administration + vérification
 * QR) ; la nouvelle signature ne s'applique qu'aux nouvelles fiches ; aucun
 * document déjà signé n'est modifié ni re-signé automatiquement.
 *
 * MÉTHODE (octets exacts servis) :
 *   1. config tampon A (mention « SIGNATURE-ORIGINE-A ») → import fiche 1 →
 *      servage administration → empreinte H1 (la fiche est FIGÉE) ;
 *   2. CHANGEMENT de la signature (config B, mention différente) → re-servage
 *      fiche 1 → les octets doivent rester IDENTIQUES (H1) ;
 *   3. import fiche 2 APRÈS le changement → servage → H3 (nouvelle signature)
 *      → re-changement (config A) → fiche 2 doit rester sur H3 (figée aussi) ;
 *   4. portail employé : la fiche 1 est servie avec les MÊMES octets (H1) ;
 *   5. vérification QR publique : mêmes octets (H1) ;
 *   6. rattrapage (module inactif) : aucun re-signage automatique ;
 *   7. suppression d'une fiche : sa copie figée est retirée du disque.
 * Nettoyage complet vérifié (fiches, accès portail, compte de labo, configs).
 */

process.chdir(__dirname + "/..");

const fs = require("fs");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const crypto = require("crypto");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const ADMIN = "http://localhost:4000";
const PORTAIL = "http://localhost:4001";
const db = new PrismaClient();

let OK = 0, KO = 0;
const idsCrees = [];
function check(label, cond, detail = "") {
  if (cond) { OK++; console.log(`  OK   ${label}`); }
  else { KO++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Client HTTP minimal avec cookie de session. */
function client(base) {
  let cookie = "";
  return {
    async req(method, path, body, brutBinaire = false) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
        redirect: "manual",
      });
      const setC = res.headers.get("set-cookie");
      if (setC) cookie = setC.split(";")[0];
      if (brutBinaire) {
        const buf = Buffer.from(await res.arrayBuffer());
        return { status: res.status, buf, entetes: Object.fromEntries(res.headers.entries()) };
      }
      const texte = await res.text();
      let json = null;
      try { json = JSON.parse(texte); } catch {}
      return { status: res.status, json, texte, entetes: Object.fromEntries(res.headers.entries()) };
    },
    get(p) { return this.req("GET", p); },
    post(p, b) { return this.req("POST", p, b); },
    put(p, b) { return this.req("PUT", p, b); },
    del(p) { return this.req("DELETE", p); },
    getBin(p) { return this.req("GET", p, undefined, true); },
  };
}

/** TOTP RFC 6238 (6 chiffres, 30 s, SHA1). */
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
  const code = (((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, "0");
}

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/** Jeton QR « fiche en ligne » — réplique exacte de jetonFiche() (stamp.ts). */
function jetonFiche(id) {
  const materiel = process.env.AUTO_RH_STORAGE_KEY || process.env.SERVICE_RH_STORAGE_KEY || process.env.AUTORH_STORAGE_KEY || process.env.PAIESAGE_STORAGE_KEY || process.env.AUTH_SECRET ||
    "autorh-storage-local-a-changer-dans-env";
  const cle = crypto.scryptSync(materiel, "autorh-signature-v1", 32);
  return crypto.createHmac("sha256", cle).update("fiche-en-ligne-v1|" + id)
    .digest("hex").slice(0, 24).toUpperCase();
}

async function pdfFiche(cin, nom) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(
    "BULLETIN DE PAIE\nCIN: " + cin + "\nEmploye: " + nom +
    "\nPeriode: 03/2026\nNet a payer: 1234,56",
    { x: 50, y: 700, size: 14, font, lineHeight: 22 }
  );
  return Buffer.from(await doc.save());
}

async function uploadFiche(admin, buffer, nomFichier) {
  const fd = new FormData();
  fd.append("files", new Blob([buffer], { type: "application/pdf" }), nomFichier);
  const r = await admin.req("POST", "/api/payslips/upload", fd);
  // (Task 244) l'ID est renvoyé directement par la réponse — fileName est
  // chiffré à IV aléatoire (aucune recherche SQL possible sur ce champ).
  const id = r.json?.results?.[0]?.id || null;
  if (id) idsCrees.push(id);
  const fiche = id ? await db.payslip.findUnique({ where: { id } }) : null;
  return { reponse: r, fiche };
}

async function main() {
  const EMAIL_LAB = "lab244@auto-rh.test";
  const MDP_LAB = "Lab244-Preserv#2026!";
  const CIN1 = "TEST24401", CIN2 = "TEST24402";
  const NOM1 = "TASK244-F1.pdf", NOM2 = "TASK244-F2.pdf";
  const SECRET_TOTP = "JBSWY3DPEHPK3PXP";
  const MDP_PORTAIL = "Portail244#Test!";

  console.log("== Task 244 — préservation de la signature d'origine ==\n");

  // ---- 0) Nettoyage préalable --------------------------------------------
  // (CORRECTIF) le site peut re-chiffrer l'email en ALEA lors du login :
  // identification par DÉCHIFFREMENT (toutes formes) puis suppression par ID.
  const idsLab = [];
  for (const u of await db.user.findMany()) {
    let courriel = "";
    try { courriel = String(cryptoBd.dechiffrerChamp(u.email) || ""); } catch {}
    if (courriel.startsWith("lab244@")) idsLab.push(u.id);
  }
  if (idsLab.length) await db.user.deleteMany({ where: { id: { in: idsLab } } });
  await db.payslip.deleteMany({ where: { fileName: { in: [NOM1, NOM2] } } });
  await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN1, true) } });
  fs.rmSync("storage/copies-signees/copie-test244", { force: true, recursive: true });

  // ---- 1) Compte SUPERADMIN de labo ---------------------------------------
  const labUser = await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL_LAB, true),
      name: cryptoBd.chiffrerChamp("Lab 244"),
      passwordHash: hashScrypt(MDP_LAB),
      role: "SUPERADMIN",
      isActive: true,
      passwordChangedAt: new Date(),
    },
  });
  idsLab.push(labUser.id);
  const admin = client(ADMIN);
  const login = await admin.post("/api/auth/login", { email: EMAIL_LAB, password: MDP_LAB });
  check("Connexion SUPERADMIN de labo", login.status === 200, `status=${login.status}`);

  // ---- 2) Sauvegarde des configurations actuelles --------------------------
  const cfgTamponAvant = (await admin.get("/api/signature-config")).json?.config || null;
  const cfgApiAvant = (await admin.get("/api/signature-api/config")).json || null;
  check("Lecture des configurations (tampon + module PAdES)", Boolean(cfgTamponAvant && cfgApiAvant));

  // Module PAdES INACTIF pendant l'expérience (restauré à la fin).
  if (cfgApiAvant?.config?.actif) {
    await admin.put("/api/signature-api/config", { ...cfgApiAvant.config, actif: false });
  }

  // ---- 3) Configuration tampon A (mention seule) ---------------------------
  const base = {
    actif: true, sigActif: false, qrActif: false, certActif: false, elecActif: false,
    mentionActif: true, mentionTexte: "SIGNATURE-ORIGINE-A",
  };
  const putA = await admin.put("/api/signature-config", base);
  check("Configuration tampon A enregistrée", putA.status === 200, `status=${putA.status}`);

  // ---- 4) Fiche 1 : import + premier servage → figée ------------------------
  const up1 = await uploadFiche(admin, await pdfFiche(CIN1, "Employe Test 244 A"), NOM1);
  check("Import fiche 1", Boolean(up1.fiche), `reponse=${up1.reponse.status}`);
  const f1 = up1.fiche.id;
  const s1a = await admin.getBin(`/api/payslips/${f1}/file`);
  const H1 = sha(s1a.buf);
  check("Fiche 1 servie (configuration A)", s1a.status === 200 && s1a.buf.length > 0, `status=${s1a.status}`);
  const rec1 = await db.payslip.findUnique({ where: { id: f1 } });
  check("Fiche 1 FIGÉE après son premier servage signé", Boolean(rec1?.copieSigneeNom), `copie=${rec1?.copieSigneeNom}`);
  const fichierFigee1 = "storage/copies-signees/" + (rec1?.copieSigneeNom || "absent");
  check("Copie figée présente sur le disque", fs.existsSync(fichierFigee1), fichierFigee1);

  // ---- 5) CHANGEMENT de la signature (configuration B) ----------------------
  await admin.put("/api/signature-config", { ...base, mentionTexte: "SIGNATURE-MODIFIEE-B" });
  const s1b = await admin.getBin(`/api/payslips/${f1}/file`);
  check(
    "FICHE DÉJÀ SIGNÉE : octets IDENTIQUES après modification de la signature",
    sha(s1b.buf) === H1,
    `avant=${H1.slice(0, 12)} apres=${sha(s1b.buf).slice(0, 12)}`
  );
  const s1c = await admin.getBin(`/api/payslips/${f1}/file?download=1`);
  check("Téléchargement : mêmes octets (signature d'origine)", sha(s1c.buf) === H1);

  // ---- 6) Fiche 2 importée APRÈS le changement → nouvelle signature ---------
  const up2 = await uploadFiche(admin, await pdfFiche(CIN2, "Employe Test 244 B"), NOM2);
  const f2 = up2.fiche.id;
  const s2a = await admin.getBin(`/api/payslips/${f2}/file`);
  const H3 = sha(s2a.buf);
  check("Fiche 2 (nouvelle) servie avec la NOUVELLE signature", s2a.status === 200 && H3 !== H1);
  const rec2 = await db.payslip.findUnique({ where: { id: f2 } });
  check("Fiche 2 figée à son tour", Boolean(rec2?.copieSigneeNom));

  // ---- 7) Re-changement (retour à A) : fiche 2 reste sur sa signature -------
  await admin.put("/api/signature-config", base);
  const s2b = await admin.getBin(`/api/payslips/${f2}/file`);
  check(
    "Fiche 2 : sa signature (B) est préservée après un NOUVEAU changement",
    sha(s2b.buf) === H3,
    `attendu=${H3.slice(0, 12)} recu=${sha(s2b.buf).slice(0, 12)}`
  );
  const s1d = await admin.getBin(`/api/payslips/${f1}/file`);
  check("Fiche 1 : toujours sa signature d'origine (A)", sha(s1d.buf) === H1);

  // ---- 8) Portail employé : mêmes octets ------------------------------------
  await db.portalAccess.create({
    data: {
      cin: cryptoBd.chiffrerChamp(CIN1, true),
      isActive: true,
      passwordHash: cryptoBd.chiffrerChamp(hashScrypt(MDP_PORTAIL)),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      lastLoginAt: new Date(),
      qrPresente: true,
      totpSecret: cryptoBd.chiffrerChamp(SECRET_TOTP),
    },
  });
  const port = client(PORTAIL);
  const verif = await port.post("/api/verify", {
    cin: CIN1, password: MDP_PORTAIL, otp: totpNow(SECRET_TOTP), remember: false,
  });
  check("Connexion portail (CIN + mot de passe + OTP)", verif.status === 200 && verif.json?.ok, `status=${verif.status}`);
  const pf1 = await port.getBin(`/api/payslip/${f1}/file?cin=${CIN1}`);
  check(
    "PORTAIL EMPLOYÉ : signature d'origine servie (octets identiques)",
    pf1.status === 200 && sha(pf1.buf) === H1,
    `status=${pf1.status} sha=${sha(pf1.buf).slice(0, 12)}`
  );
  const enTetePortail = decodeURIComponent(pf1.entetes["x-signature-electronique"] || "");
  check("En-tête portail annonce la signature d'origine", /signature d'origine préservée/.test(enTetePortail), enTetePortail.slice(0, 80));

  // ---- 9) Vérification QR publique : mêmes octets ----------------------------
  const qr = await fetch(`${ADMIN}/api/payslips/qr/${f1}/file?t=${jetonFiche(f1)}`);
  const qrBuf = Buffer.from(await qr.arrayBuffer());
  check(
    "VÉRIFICATION QR : signature d'origine servie (octets identiques)",
    qr.status === 200 && sha(qrBuf) === H1,
    `status=${qr.status} sha=${sha(qrBuf).slice(0, 12)}`
  );

  // ---- 10) Rattrapage : aucun re-signage automatique -------------------------
  const ratPost = await admin.post("/api/signature-api/rattrapage", {});
  check(
    "Rattrapage refusé quand le module est inactif (400 explicite)",
    ratPost.status === 400 && /désactivé/.test(ratPost.json?.error || ""),
    `status=${ratPost.status} ${JSON.stringify(ratPost.json).slice(0, 120)}`
  );
  const s1e = await admin.getBin(`/api/payslips/${f1}/file`);
  check("Fiche 1 inchangée après rattrapage", sha(s1e.buf) === H1);

  // ---- 11) Suppression d'une fiche : copie figée retirée ----------------------
  const del1 = await admin.del(`/api/payslips/${f1}`);
  check("Suppression de la fiche 1", del1.status === 200, `status=${del1.status}`);
  check("Copie figée de la fiche 1 retirée du disque", !fs.existsSync(fichierFigee1));

  console.log(`\n== RÉSULTAT : ${OK} OK / ${KO} FAIL ==`);

  // ---- 12) Nettoyage complet --------------------------------------------------
  try {
    if (idsCrees.length) {
      await db.payslip.deleteMany({ where: { id: { in: idsCrees } } });
      await db.signatureApiDocument.deleteMany({ where: { type: "FICHE_PAIE", sourceId: { in: idsCrees } } });
      // Copies figées orphelines (la suppression par API les retire déjà ;
      // ce nettoyage couvre le retrait direct en base).
      for (const id of idsCrees) {
        fs.rmSync("storage/copies-signees/copie-" + id, { force: true });
      }
    }
    await db.portalAccess.deleteMany({ where: { cin: cryptoBd.chiffrerChamp(CIN1, true) } });
    if (idsLab.length) await db.user.deleteMany({ where: { id: { in: idsLab } } });
    if (cfgTamponAvant) {
      await admin.put("/api/signature-config", cfgTamponAvant);
    }
    if (cfgApiAvant?.config?.actif) {
      await admin.put("/api/signature-api/config", { ...cfgApiAvant.config, actif: true });
    }
    console.log("Nettoyage : fiches, accès portail, compte de labo, configurations restaurées.");
  } catch (e) {
    console.error("Nettoyage en échec (à vérifier):", e.message);
  }

  await db.$disconnect();
  process.exit(KO === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try {
    if (idsCrees.length) {
      await db.payslip.deleteMany({ where: { id: { in: idsCrees } } });
      await db.signatureApiDocument.deleteMany({ where: { type: "FICHE_PAIE", sourceId: { in: idsCrees } } });
      console.log("Nettoyage d'urgence : fiches de test retirées.");
    }
  } catch {}
  try { await db.$disconnect(); } catch {}
  process.exit(1);
});
