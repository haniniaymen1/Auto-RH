#!/usr/bin/env node
/** Debug : reproduire le servage réel d'une fiche PNG tamponnée et analyser. */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const crypto = require("crypto");
const sharp = require("sharp");
const jsQR = require("jsqr");
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const BASE = "http://localhost:4000";
const NOM = "dbg-180-fiche.png";
const CIN = "TEST18001";
const NOM_TEST = "EMPLOYE DEMO TASK180";

async function tenter(nom, buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  console.log(`${nom.padEnd(40)} → ${res ? "DÉCODÉ" : "null"} (${info.width}x${info.height})`);
  return res ? res.data : null;
}

async function main() {
  // 1) fiche PNG source
  const svg = Buffer.from(
    `<svg width="1240" height="300" xmlns="http://www.w3.org/2000/svg">
       <rect x="40" y="30" width="1160" height="230" fill="none" stroke="#333" stroke-width="2"/>
       <text x="70" y="90" font-family="DejaVu Sans" font-size="34" font-weight="bold" fill="#111">BULLETIN DE PAIE — DÉMO TASK 180</text>
       <text x="70" y="140" font-family="DejaVu Sans" font-size="28" fill="#222">Employé : ${NOM_TEST}</text>
       <text x="70" y="185" font-family="DejaVu Sans" font-size="28" fill="#222">CIN : ${CIN}</text>
     </svg>`
  );
  const racine = process.cwd();
  const dossier = path.join(racine, "storage", "payslips");
  fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, NOM);
  await sharp({ create: { width: 1240, height: 1754, channels: 3, background: "#ffffff" } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .png().toFile(chemin);

  // 2) enregistrement en base
  await db.payslip.deleteMany({ where: { fileName: NOM } });
  const rec = await db.payslip.create({
    data: {
      fileName: NOM, storedName: NOM, fileSize: fs.statSync(chemin).size,
      content: "FICHE DE PAIE " + CIN, normalizedContent: "FICHE DE PAIE " + CIN,
      cin: CIN, cinIndex: cryptoBd.chiffrerChamp(CIN, true),
      employeeName: NOM_TEST, period: "09/2026", netSalary: "2 400,000",
    },
  });
  console.log("Fiche créée:", rec.id);

  // 3) session
  const lr = await fetch(BASE + "/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@autorh.local", password: "AutoRH-2026!Verif#1" }),
  });
  const cookie = (lr.headers.get("set-cookie") || "").split(";")[0];

  // 4) config FICHE
  await fetch(BASE + "/api/signature-config", {
    method: "PUT", headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      actif: true, sigActif: false, sigImage: "", sigTexte: "", sigPosition: "BAS_DROITE",
      sigTaille: 120, sigOpacite: 0.9, qrActif: true, qrMode: "FICHE",
      qrUrl: "http://localhost:4000", qrTexte: "", qrPosition: "BAS_GAUCHE", qrTaille: 150,
      sigDecalX: 0, sigDecalY: 0, qrDecalX: 0, qrDecalY: 0, sigRotation: 0, qrRotation: 0,
      mentionActif: true, mentionTexte: "Document signé électroniquement — Auto-RH — {DATE}",
    }),
  });

  // 5) GET le fichier servi + sauvegarde pour inspection
  const res = await fetch(`${BASE}/api/payslips/${rec.id}/file`, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync("/tmp/t180-servi.png", buf);
  const original = fs.readFileSync(chemin);
  console.log(`Tailles : original=${original.length} o, servi=${buf.length} o, identiques=${buf.equals(original)}`);

  // 6) variantes de décodage
  await tenter("servi brut", buf);
  await tenter("servi x2 nearest", await sharp(buf).resize(2480, 3508, { kernel: "nearest" }).png().toBuffer());
  await tenter("servi x3 nearest", await sharp(buf).resize(3720, 5262, { kernel: "nearest" }).png().toBuffer());
  // recadrage coin bas-gauche (QR attendu à x=24, bas y=24+mention)
  const crop = await sharp(buf).extract({ left: 0, top: 1454, width: 400, height: 300 }).png().toBuffer();
  fs.writeFileSync("/tmp/t180-coin.png", crop);
  await tenter("recadré bas-gauche 400x300", crop);
  await tenter("recadré x4", await sharp(crop).resize(1600, 1200, { kernel: "nearest" }).png().toBuffer());
  // statistiques sombres du coin
  const { data, info } = await sharp(crop).greyscale().raw().toBuffer({ resolveWithObject: true });
  let sombres = 0;
  for (const v of data) if (v < 128) sombres++;
  console.log(`Coin bas-gauche : ${((sombres / data.length) * 100).toFixed(1)} % de pixels sombres`);
  await db.payslip.delete({ where: { id: rec.id } });
  fs.unlinkSync(chemin);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
