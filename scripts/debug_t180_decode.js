#!/usr/bin/env node
/** Debug décodage QR : variantes de prétraitement sharp + jsQR. */
process.chdir(__dirname + "/..");
const fs = require("fs");
const crypto = require("crypto");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const sharp = require("sharp");
const jsQR = require("jsqr");
const QRCode = require("qrcode");

const url = "http://localhost:4000/verification/fiche/cmuh92cb20000plyxhn4qoprl?t=1CBE295A629EBDAEAB10853A";
const contenuDonnees = ["Auto-RH — Fiche de paie", "Réf : abc", "Employé : X"].join("\n");

async function tenter(nom, buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const res = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
  console.log(`${nom.padEnd(38)} → ${res ? "DÉCODÉ : " + res.data.slice(0, 50) : "null"} (${info.width}x${info.height})`);
  return res;
}

async function main() {
  // Reproduire la surface du moteur : QR 450px (150*3), réduit à 150px ( Lanczos défaut ?)
  const qr450 = await QRCode.toBuffer(url, { type: "png", margin: 0, width: 450, errorCorrectionLevel: "M" });
  const qr150 = await sharp(qr450).resize(150, 150).png().toBuffer();
  console.log("--- QR seul (réduit 150px comme moteur image) ---");
  await tenter("QR 150px brut", qr150);
  await tenter("QR 150px x2 nearest", await sharp(qr150).resize(300, 300, { kernel: "nearest" }).png().toBuffer());
  await tenter("QR 150px x3 nearest", await sharp(qr150).resize(450, 450, { kernel: "nearest" }).png().toBuffer());
  await tenter("QR 150px x4 nearest", await sharp(qr150).resize(600, 600, { kernel: "nearest" }).png().toBuffer());
  await tenter("QR 150px x3 + seuil", await sharp(qr150).resize(450, 450, { kernel: "nearest" }).threshold(128).png().toBuffer());
  // Et composé sur fiche blanche 1240x1754 à 40,24 du bas gauche puis recadré ?
  const fiche = await sharp({ create: { width: 1240, height: 1754, channels: 3, background: "#ffffff" } })
    .composite([{ input: qr150, left: 24, top: 1754 - 24 - 150 }])
    .png().toBuffer();
  console.log("--- QR composé sur fiche 1240x1754 ---");
  await tenter("fiche entière", fiche);
  await tenter("fiche x2 nearest", await sharp(fiche).resize(2480, 3508, { kernel: "nearest" }).png().toBuffer());
  await tenter("fiche x3 nearest", await sharp(fiche).resize(3720, 5262, { kernel: "nearest" }).png().toBuffer());
  const crop = await sharp(fiche).extract({ left: 0, top: 1754 - 250, width: 260, height: 250 }).png().toBuffer();
  await tenter("recadré coin bas-gauche x3", await sharp(crop).resize(780, 750, { kernel: "nearest" }).png().toBuffer());
}
main().catch((e) => { console.error(e); process.exit(1); });
