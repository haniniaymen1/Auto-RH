#!/usr/bin/env node
/**
 * v0.2.197 — PREUVE UI : demandes soumises au portail RÉEL (HTTP) avec
 * SMTP puits, puis consultation du JOURNAL dans l'administration.
 * Les données de test sont CONSERVÉES (pas de nettoyage) pour permettre
 * les captures d'écran de l'administration (demandes + journal).
 *
 * Usage : node scripts/preuve-ui-v02197.js   (admin 4000 + portail 4001 démarrés)
 */
process.chdir(__dirname + "/..");

const fs = require("fs");
const net = require("net");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();

const PORTAIL = "http://localhost:4001";
const db = new PrismaClient();

const CIN_TEST = "PREUVE19701";
const CIN_MANAGER = "PREUVEMGR1";
const EMAIL_DEMANDEUR = "employe.preuve197@test.tn";
const EMAIL_MANAGER = "manager.preuve197@test.tn";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

function hashScrypt(motDePasse) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(motDePasse, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
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
function client(base) {
  let cookie = "";
  return {
    async post(p, body) {
      const res = await fetch(base + p, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      });
      const sc = res.headers.get("set-cookie");
      if (sc) cookie = sc.split(";")[0];
      let json = null;
      try { json = await res.json(); } catch {}
      return { status: res.status, json };
    },
  };
}
function demarrerSmtpPuits(port) {
  const rcpts = [];
  const serveur = net.createServer((socket) => {
    socket.write("220 puits.local ESMTP\r\n");
    let tampon = "", enData = false;
    socket.on("data", (chunk) => {
      tampon += chunk.toString();
      let idx;
      while ((idx = tampon.indexOf("\r\n")) >= 0) {
        const ligne = tampon.slice(0, idx);
        tampon = tampon.slice(idx + 2);
        if (enData) {
          if (ligne === ".") { enData = false; socket.write("250 OK data\r\n"); }
          continue;
        }
        const cmd = ligne.toUpperCase();
        if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) socket.write("250-puits.local\r\n250 OK\r\n");
        else if (cmd.startsWith("RCPT TO:")) {
          const m = ligne.match(/<([^>]+)>/);
          if (m) rcpts.push(m[1].toLowerCase());
          socket.write("250 OK\r\n");
        } else if (cmd.startsWith("DATA")) { enData = true; socket.write("354 End with <CR><LF>.<CR><LF>\r\n"); }
        else if (cmd.startsWith("QUIT")) { socket.write("221 Bye\r\n"); socket.end(); }
        else socket.write("250 OK\r\n");
      }
    });
  });
  return new Promise((resoudre) => serveur.listen(port, () => resoudre({ serveur, rcpts })));
}

async function main() {
  // Pré-nettoyage des résidus éventuels
  const cinDet = cryptoBd.chiffrerChamp(CIN_TEST, true);
  const cinMgrDet = cryptoBd.chiffrerChamp(CIN_MANAGER, true);
  await db.demandeAdministrative.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinDet } });
  await db.portalAccess.deleteMany({ where: { cin: cinMgrDet } });
  await db.payslip.deleteMany({ where: { fileName: "preuve-197.pdf" } });

  // Fiche (nom de l'employé) + accès portail manager + demandeur
  await db.payslip.create({ data: {
    fileName: "preuve-197.pdf", storedName: "preuve-197.pdf", fileSize: 1024,
    content: "FICHE DE PAIE " + CIN_TEST, normalizedContent: "FICHE DE PAIE " + CIN_TEST,
    cin: CIN_TEST, cinIndex: cinDet, employeeName: "Employe Preuve 197",
    period: "10/2026", netSalary: "2 100,000",
  } });
  const mgrAcc = await db.portalAccess.create({ data: {
    cin: cinMgrDet, isActive: true,
    passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Preuve-197!Mgr")),
    mustChangePassword: false, passwordChangedAt: new Date(),
    nomPrenom: cryptoBd.chiffrerChamp("Manager Preuve 197"),
    email: cryptoBd.chiffrerChamp(EMAIL_MANAGER),
  } });
  await db.portalAccess.create({ data: {
    cin: cinDet, isActive: true,
    passwordHash: cryptoBd.chiffrerChamp(hashScrypt("Preuve-197!Pass")),
    mustChangePassword: false, passwordChangedAt: new Date(),
    lastLoginAt: new Date(Date.now() - 86400000),
    qrPresente: true, totpSecret: cryptoBd.chiffrerChamp(TOTP),
    nomPrenom: cryptoBd.chiffrerChamp("Employe Preuve 197"),
    email: cryptoBd.chiffrerChamp(EMAIL_DEMANDEUR),
    managerId: mgrAcc.id,
  } });

  const { serveur, rcpts } = await demarrerSmtpPuits(2525);
  const port = client(PORTAIL);
  const verif = await port.post("/api/verify", { cin: CIN_TEST, password: "Preuve-197!Pass", otp: totpNow(TOTP), remember: false });
  console.log("Connexion portail:", verif.status, verif.json && verif.json.ok ? "OK" : JSON.stringify(verif.json));

  const cong = await port.post("/api/demandes", { type: "CONGE", typeConge: "Congé annuel", dateDebut: "2026-11-02", dateFin: "2026-11-06", commentaire: "Preuve UI v0.2.197" });
  console.log("CONGE:", cong.status, "principal=", cong.json && cong.json.destinataire);
  const auto = await port.post("/api/demandes", { type: "AUTORISATION_SORTIE", date: "2026-11-03", motif: "Rendez-vous administratif", nombreHeures: "2", heureSortie: "10:00", heureRetour: "12:00" });
  console.log("AUTORISATION_SORTIE:", auto.status, "principal=", auto.json && auto.json.destinataire);
  const parr = await port.post("/api/demandes", { type: "PARRAINAGE", dateParrainage: "2026-10-12", operation: "Opération Preuve 197", nomFilleul: "Filleul Preuve 197", telFilleul: "+216 20 000 197" });
  console.log("PARRAINAGE:", parr.status, "principal=", parr.json && parr.json.destinataire);

  await new Promise((r) => setTimeout(r, 3500));
  const compte = (d) => rcpts.filter((r) => r === d).length;
  console.log("\nRCPT TO capturés par le puits SMTP :");
  console.log("  conge@entreprise.tn =", compte("conge@entreprise.tn"), "(copie congé)");
  console.log("  autorisation@entreprise.tn =", compte("autorisation@entreprise.tn"), "(copie autorisation)");
  console.log("  manager.preuve197@test.tn =", compte(EMAIL_MANAGER), "(principal congé + autorisation)");
  console.log("  parrainage@entreprise.tn =", compte("parrainage@entreprise.tn"), "(principal parrainage)");
  console.log("  responsable.parrainage@entreprise.tn =", compte("responsable.parrainage@entreprise.tn"), "(COPIE parrainage v0.2.197)");
  console.log("  employe.preuve197@test.tn =", compte(EMAIL_DEMANDEUR), "(confirmations demandeur)");
  serveur.close();
  console.log("\nDonnées CONSERVÉES pour les captures d'écran (demandes " +
    [cong.json && cong.json.reference, auto.json && auto.json.reference, parr.json && parr.json.reference].filter(Boolean).join(", ") + ")");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(2); });
