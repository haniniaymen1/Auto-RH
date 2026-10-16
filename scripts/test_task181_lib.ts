/**
 * Test unitaire rapide (Task 181) — parserSignatureElectronique sur les
 * fichiers d'exemple générés (download/signatures-exemple/).
 * Exécuté via npx tsx.
 */
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { parserSignatureElectronique, EXTENSIONS_CERTIFICAT } from "../src/lib/signature-crypto";

const DIR = "/home/z/my-project/download/signatures-exemple";
const MDP = "PaieSage2026!";
const CN = "Signature Exemple Auto-RH";

let ok = 0;
let ko = 0;
function check(label: string, cond: boolean, detail = "") {
  if (cond) { ok++; console.log(`  OK   ${label}`); }
  else { ko++; console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`); }
}

const fichiers: Array<[string, string | undefined]> = [
  ["signature-exemple.p12", MDP],
  ["signature-exemple.pfx", MDP],
  ["signature-exemple.pkcs7", undefined],
  ["signature-exemple.p7s", undefined],
  ["signature-exemple.p7m", undefined],
  ["signature-exemple.xml", undefined],
  ["signature-exemple.ps7x", undefined],
  ["certificat-exemple.pem", undefined],
];

async function main() {
for (const [nom, mdp] of fichiers) {
  const octets = fs.readFileSync(path.join(DIR, nom));
  try {
    const infos = await parserSignatureElectronique(nom, octets, mdp);
    check(
      `${nom} → ${infos.format}, sujet OK, empreinte 64 hex`,
      infos.sujet.includes(CN) &&
        /^[0-9a-f]{64}$/.test(infos.empreinte) &&
        infos.valideAu instanceof Date &&
        infos.valideAu > new Date(),
      JSON.stringify({ ...infos, sujet: infos.sujet.slice(0, 60) })
    );
  } catch (e) {
    check(`${nom} parsé`, false, (e as Error).message);
  }
}

// Cas d'erreur attendus
async function attenduEchec(nom: string, octets: Buffer, mdp: string | undefined, motif: string) {
  try {
    await parserSignatureElectronique(nom, octets, mdp);
    check(`${nom} rejeté (${motif})`, false, "accepté à tort");
  } catch (e) {
    check(`${nom} rejeté (${motif})`, true, (e as Error).message);
  }
}
await attenduEchec("signature-exemple.p12", fs.readFileSync(path.join(DIR, "signature-exemple.p12")), undefined, "sans mot de passe");
await attenduEchec("signature-exemple.p12", fs.readFileSync(path.join(DIR, "signature-exemple.p12")), "MAUVAIS", "mot de passe faux");
await attenduEchec("factice.p12", Buffer.concat([Buffer.from([0x30, 0x82]), crypto.randomBytes(500)]), "x", "ASN.1 illisible");
await attenduEchec("vide.xml", Buffer.from("<balise>sans certificat</balise>"), undefined, "XML sans X509");
await attenduEchec(
  "image.p12",
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(2000)]),
  undefined,
  "contenu non DER"
);
// Extension non autorisée détectable via la liste
check("Extension .docx non listée", !(EXTENSIONS_CERTIFICAT as readonly string[]).includes("docx"));
}

main().then(() => {
  console.log(`\n== ${ok} OK / ${ko} FAIL ==`);
  process.exit(ko ? 1 : 0);
});
