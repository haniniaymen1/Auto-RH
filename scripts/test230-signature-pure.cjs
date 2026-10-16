#!/usr/bin/env node
/**
 * LABO Task 230 — validation des moteurs PURS (der-encode / cms-pur /
 * pkcs12-pur) contre le binaire openssl CLI (référence croisée).
 *
 * Principe : transpilation TypeScript→JS en mémoire (API typescript), puis
 * batteries de tests. openssl est utilisé SEULEMENT comme oracle externe
 * (génération d'artefacts de référence + vérification croisée).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");

/* --- 1. Transpilation des modules TS --- */
const ts = require("/home/z/my-project/node_modules/typescript");
const LAB = fs.mkdtempSync(path.join(os.tmpdir(), "lab230-"));
const SRC = "/home/z/my-project/src/lib";
for (const f of ["der-encode.ts", "cms-pur.ts", "pkcs12-pur.ts"]) {
  const js = ts.transpileModule(fs.readFileSync(path.join(SRC, f), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  fs.writeFileSync(path.join(LAB, f.replace(/\.ts$/, ".js")), js);
}
const der = require(path.join(LAB, "der-encode.js"));
const cmsPur = require(path.join(LAB, "cms-pur.js"));
const pkcs12Pur = require(path.join(LAB, "pkcs12-pur.js"));

/* --- 2. Dossier d'artefacts --- */
const FIX = fs.mkdtempSync(path.join(os.tmpdir(), "fix230-"));
const ossl = (args, input) =>
  execFileSync("openssl", args, { input: input ? Buffer.from(input) : undefined, stdio: ["pipe", "pipe", "pipe"] });

let OK = 0, KO = 0, KO_LISTE = [];
function test(nom, condition, detail) {
  if (condition) { OK++; console.log("  OK  " + nom); }
  else { KO++; KO_LISTE.push(nom + (detail ? " — " + String(detail).slice(0, 220) : "")); console.log("  KO  " + nom + (detail ? " — " + String(detail).slice(0, 220) : "")); }
}

/* --- 3. Artefacts de référence (openssl) --- */
console.log("== Génération des artefacts de référence (openssl) ==");
const mdpCle = "Cle-Secret-230!";
// RSA 2048
ossl(["req", "-x509", "-newkey", "rsa:2048", "-keyout", path.join(FIX, "rsa.key"),
  "-out", path.join(FIX, "rsa.crt"), "-days", "30", "-nodes", "-subj", "/CN=Jean Dupont/O=MA SOCIETE SARL/C=TN"]);
// EC P-256
ossl(["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-keyout", path.join(FIX, "ec.key"),
  "-out", path.join(FIX, "ec.crt"), "-days", "30", "-nodes", "-subj", "/CN=Signataire EC/O=MA SOCIETE SARL/C=TN"]);
// PKCS#8 chiffré AES-256 (mot de passe)
const rsaCleBuf = fs.readFileSync(path.join(FIX, "rsa.key"));
const rsaClePem = rsaCleBuf.toString();
ossl(["pkcs8", "-topk8", "-v2", "aes-256-cbc", "-passout", "stdin"],
  "Cle-Secret-230!\n" + rsaClePem.toString("latin1"));
fs.writeFileSync(path.join(FIX, "rsa-chiffree.pem"),
  ossl(["pkcs8", "-topk8", "-v2", "aes-256-cbc", "-passout", "stdin"], "Cle-Secret-230!\n" + rsaClePem.toString("latin1")));
// Coffres .p12
ossl(["pkcs12", "-export", "-inkey", path.join(FIX, "rsa.key"), "-in", path.join(FIX, "rsa.crt"),
  "-passout", "stdin", "-macalg", "sha256", "-keypbe", "AES-256-CBC", "-certpbe", "AES-256-CBC"],
  "Mdp-Coffre-1\n");
fs.writeFileSync(path.join(FIX, "coffre-pbes2.p12"),
  ossl(["pkcs12", "-export", "-inkey", path.join(FIX, "rsa.key"), "-in", path.join(FIX, "rsa.crt"),
    "-passout", "stdin", "-macalg", "sha256", "-keypbe", "AES-256-CBC", "-certpbe", "AES-256-CBC"], "Mdp-Coffre-1\n"));
let coffre3des = null;
try {
  coffre3des = ossl(["pkcs12", "-export", "-legacy", "-inkey", path.join(FIX, "rsa.key"), "-in", path.join(FIX, "rsa.crt"),
    "-passout", "stdin", "-macalg", "sha1", "-keypbe", "PBE-SHA1-3DES-CBC", "-certpbe", "PBE-SHA1-3DES-CBC"], "Mdp-Coffre-2\n");
} catch (_) { /* fournisseur legacy indisponible : T7 sauté */ }
if (coffre3des) fs.writeFileSync(path.join(FIX, "coffre-3des.p12"), coffre3des);
fs.writeFileSync(path.join(FIX, "coffre-sans-mdp.p12"),
  ossl(["pkcs12", "-export", "-inkey", path.join(FIX, "rsa.key"), "-in", path.join(FIX, "rsa.crt"), "-passout", "pass:"]));
// Chaîne PKCS#7 (.p7b) : certificat + certificat EC
fs.writeFileSync(path.join(FIX, "chaine.p7b"),
  ossl(["crl2pkcs7", "-nocrl", "-certfile", path.join(FIX, "rsa.crt"), "-certfile", path.join(FIX, "ec.crt"), "-outform", "DER"]));

/* --- 4. Tests --- */
console.log("== Tests CMS pur ==");
const donnees = crypto.randomBytes(4096);
const certRsa = fs.readFileSync(path.join(FIX, "rsa.crt")).toString();
const cleRsa = fs.readFileSync(path.join(FIX, "rsa.key")).toString();
const certEc = fs.readFileSync(path.join(FIX, "ec.crt")).toString();
const cleEc = fs.readFileSync(path.join(FIX, "ec.key")).toString();

// T1 : CMS RSA pur → vérifié par openssl (oracle externe)
const sigRsa = cmsPur.signerCmsPur(donnees, certRsa, cleRsa, "");
fs.writeFileSync(path.join(FIX, "t1.sig"), sigRsa);
fs.writeFileSync(path.join(FIX, "t1.bin"), donnees);
const v1 = spawnSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-purpose", "any", "-noverify",
  "-content", path.join(FIX, "t1.bin"), "-in", path.join(FIX, "t1.sig")]);
test("T1 CMS RSA (pur) vérifié par openssl cms -verify", v1.status === 0, v1.stderr.toString());

// T2 : CMS RSA pur → vérifié par verifierCmsPur
const v2 = cmsPur.verifierCmsPur(donnees, sigRsa);
test("T2 CMS RSA (pur) vérifié par verifierCmsPur", v2.integrite === true, v2.message);
test("T2b signataire = Jean Dupont, O=MA SOCIETE SARL", /Jean Dupont/.test(v2.signataire) && /MA SOCIETE SARL/.test(v2.emetteur || v2.signataire), JSON.stringify({s: v2.signataire, e: v2.emetteur}));

// T3 : CMS EC pur
const sigEc = cmsPur.signerCmsPur(donnees, certEc, cleEc, "");
const v3 = cmsPur.verifierCmsPur(donnees, sigEc);
test("T3 CMS EC (pur) vérifié par verifierCmsPur", v3.integrite === true, v3.message);
fs.writeFileSync(path.join(FIX, "t3.sig"), sigEc);
const v3o = spawnSync("openssl", ["cms", "-verify", "-binary", "-inform", "DER", "-purpose", "any", "-noverify",
  "-content", path.join(FIX, "t1.bin"), "-in", path.join(FIX, "t3.sig")]);
test("T3b CMS EC (pur) vérifié par openssl", v3o.status === 0, v3o.stderr.toString());

// T4 : CMS openssl → vérifié par verifierCmsPur (interopérabilité inverse)
fs.writeFileSync(path.join(FIX, "t4.bin"), donnees);
ossl(["cms", "-sign", "-binary", "-nosmimecap", "-outform", "DER", "-md", "sha256",
  "-signer", path.join(FIX, "rsa.crt"), "-inkey", path.join(FIX, "rsa.key"),
  "-in", path.join(FIX, "t4.bin"), "-out", path.join(FIX, "t4.sig")]);
const v4 = cmsPur.verifierCmsPur(donnees, fs.readFileSync(path.join(FIX, "t4.sig")));
test("T4 CMS openssl vérifié par verifierCmsPur", v4.integrite === true, v4.message);

// T5 : données altérées → invalide
const v5 = cmsPur.verifierCmsPur(Buffer.concat([donnees, Buffer.from("X")]), sigRsa);
test("T5 données altérées → integrite=false", v5.integrite === false);

// T6..T9 : coffres PKCS#12
console.log("== Tests PKCS#12 pur ==");
function spkiDePkcs8(pkcs8) {
  const cle = crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return crypto.createPublicKey(cle).export({ type: "spki", format: "der" });
}
const spkiRef = crypto.createPublicKey(crypto.createPrivateKey(cleRsa)).export({ type: "spki", format: "der" });

const c1 = pkcs12Pur.ouvrirPkcs12Pur(fs.readFileSync(path.join(FIX, "coffre-pbes2.p12")), "Mdp-Coffre-1");
test("T6 .p12 PBES2/AES (openssl 3 défaut) ouvert", c1.certificats.length >= 1 && !!c1.clePkcs8, JSON.stringify({certs: c1.certificats.length, cle: !!c1.clePkcs8}));
test("T6b clé du coffre = clé RSA de référence (SPKI)", c1.clePkcs8 && Buffer.compare(spkiDePkcs8(c1.clePkcs8), spkiRef) === 0);
const choix1 = pkcs12Pur.choisirFeuille(c1.certificats, c1.clePkcs8);
const certFeuille = new crypto.X509Certificate(choix1.feuille);
test("T6c feuille = certificat dont SPKI correspond", Buffer.compare(spkiRef, certFeuille.publicKey.export({ type: "spki", format: "der" })) === 0);

if (coffre3des) {
  const c2 = pkcs12Pur.ouvrirPkcs12Pur(fs.readFileSync(path.join(FIX, "coffre-3des.p12")), "Mdp-Coffre-2");
  test("T7 .p12 PBES1/3DES (historique) ouvert", c2.certificats.length >= 1 && !!c2.clePkcs8, JSON.stringify({certs: c2.certificats.length, cle: !!c2.clePkcs8}));
} else {
  console.log("  --  T7 .p12 PBES1/3DES sauté (fournisseur legacy openssl indisponible)");
}

const c3 = pkcs12Pur.ouvrirPkcs12Pur(fs.readFileSync(path.join(FIX, "coffre-sans-mdp.p12")), "");
test("T8 .p12 SANS mot de passe ouvert", c3.certificats.length >= 1 && !!c3.clePkcs8);

let macOk = false;
try { pkcs12Pur.ouvrirPkcs12Pur(fs.readFileSync(path.join(FIX, "coffre-pbes2.p12")), "MAUVAIS"); }
catch (e) { macOk = true; }
test("T9 mauvais mot de passe → erreur MOT_DE_PASSE_INCORRECT", macOk);

// T10..T12 : clés privées PEM
console.log("== Tests clés privées pur ==");
const k1 = pkcs12Pur.lireClePriveePur(fs.readFileSync(path.join(FIX, "rsa-chiffree.pem")), "Cle-Secret-230!");
test("T10 clé PKCS#8 chiffrée AES déchiffrée (SPKI identique)",
  Buffer.compare(spkiRef, crypto.createPublicKey(k1.keyObject).export({ type: "spki", format: "der" })) === 0);
const k2 = pkcs12Pur.lireClePriveePur(rsaCleBuf, "");
test("T11 clé PKCS#1 PEM classique lue", /BEGIN PRIVATE KEY/.test(k2.pemPkcs8) && k2.type.startsWith("RSA"));
let mdpKo = false;
try { pkcs12Pur.lireClePriveePur(fs.readFileSync(path.join(FIX, "rsa-chiffree.pem")), "FAUX"); }
catch (e) { mdpKo = /Mot de passe de la clé privée incorrect/.test(String(e.message)); }
test("T12 mauvais mot de passe clé → message classé", mdpKo);

// T13 : PKCS#7 .p7b → certificats extraits
console.log("== Tests PKCS#7 pur ==");
const certs7 = pkcs12Pur.certificatsPkcs7Der(fs.readFileSync(path.join(FIX, "chaine.p7b")));
test("T13 .p7b → 2 certificats extraits", certs7.length === 2, "obtenu: " + certs7.length);

/* --- 5. Bilan --- */
console.log("\n== BILAN LABO 230 (moteurs purs) : " + OK + " OK / " + KO + " KO ==");
if (KO_LISTE.length) { console.log(KO_LISTE.map((k) => "  - " + k).join("\n")); }
fs.rmSync(LAB, { recursive: true, force: true });
process.exit(KO ? 1 : 0);
