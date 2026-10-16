#!/usr/bin/env node
/**
 * Task 200 bis — test des fichiers du ZIP EXACT remis à l'utilisateur
 * (download/signatures-exemple-auto-rh.zip, fichiers OpenSSL 3.5.7).
 * Chaque fichier est importé via l'API : SANS mot de passe puis AVEC le
 * mot de passe documenté — afin de reproduire le signalement.
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
const { PrismaClient } = require("@prisma/client");
const cryptoBd = require("./lib-crypto-bd.js");
cryptoBd.reinitialiserCles?.();
const db = new PrismaClient();

const EMAIL = "rh-task200@test.autorh.local";
const MDP_COMPTE = "Test-200!Pass";
const MDP_DOC = "PaieSage2026!";
const TMP = "/tmp/zipsig-extraits";

function hashScrypt(mdp) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt:${salt}:${crypto.scryptSync(mdp, salt, 64).toString("hex")}`;
}

async function main() {
  const etatInitial = await db.signatureConfig.findUnique({ where: { id: "signature" } });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  await db.user.create({
    data: {
      email: cryptoBd.chiffrerChamp(EMAIL, true),
      name: cryptoBd.chiffrerChamp("RH Test 200", true),
      role: "RH", isActive: true,
      passwordHash: hashScrypt(MDP_COMPTE), passwordChangedAt: new Date(),
    },
  });

  // Extraire le ZIP livré à l'utilisateur
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  execSync(`unzip -o -q download/signatures-exemple-auto-rh.zip -d ${TMP}`);

  let cookie = "";
  const r = await fetch("http://localhost:4000/api/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: MDP_COMPTE }),
  });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];

  const fichiers = fs.readdirSync(TMP).filter((f) => /\.(p12|pfx|pkcs7|p7s|p7m|p7b|p7c|xml|ps7x|pem|cer|crt|der)$/i.test(f)).sort();
  for (const f of fichiers) {
    const b64 = fs.readFileSync(path.join(TMP, f)).toString("base64");
    // 1) sans mot de passe
    let res = await fetch("http://localhost:4000/api/signature-config", {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ certFichier: b64, certFichierNom: f }),
    });
    let j = await res.json().catch(() => ({}));
    const sans = `${res.status}${j.error ? " ✗ " + j.error : " ✓ " + (j.config?.certFormat || "")}`;
    // 2) avec le mot de passe documenté (comme le ferait un utilisateur prudent)
    res = await fetch("http://localhost:4000/api/signature-config", {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ certFichier: b64, certFichierNom: f, certMotDePasse: MDP_DOC }),
    });
    j = await res.json().catch(() => ({}));
    const avec = `${res.status}${j.error ? " ✗ " + j.error : " ✓ " + (j.config?.certFormat || "")}`;
    console.log(`${f.padEnd(28)} SANS mdp: ${sans.padEnd(58)} AVEC mdp doc: ${avec}`);
  }

  // Restauration
  const d = etatInitial ?? {};
  await db.signatureConfig.upsert({
    where: { id: "signature" },
    update: {
      certFormat: d.certFormat ?? "", certFichierNom: d.certFichierNom ?? "",
      certChemin: d.certChemin ?? "", certSujet: d.certSujet ?? "",
      certEmetteur: d.certEmetteur ?? "", certSerie: d.certSerie ?? "",
      certValideDu: d.certValideDu ?? null, certValideAu: d.certValideAu ?? null,
      certEmpreinte: d.certEmpreinte ?? "", certImportLe: d.certImportLe ?? null,
    },
    create: { id: "signature" },
  });
  await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } });
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("(état certificat restauré, compte de test supprimé)");
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("ERREUR FATALE:", e);
  try { await db.user.deleteMany({ where: { email: cryptoBd.chiffrerChamp(EMAIL, true) } }); } catch {}
  await db.$disconnect();
  process.exit(2);
});
