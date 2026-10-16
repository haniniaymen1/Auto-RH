/** Test de fumée hors serveur de l'analyseur multi-formats (Task 181). */
const { execSync } = require("child_process");
const fs = require("fs");
// Compilation isolée à la demande (le module n'a que crypto + node-forge)
const SORTIE = __dirname + "/.tmp_t181";
if (!fs.existsSync(SORTIE + "/certificat.js")) {
  execSync(
    "npx tsc src/lib/certificat.ts --outDir scripts/.tmp_t181 --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node",
    { cwd: __dirname + "/..", stdio: "inherit" }
  );
}
const forge = require("node-forge");
const { analyserFichierSignature } = require("./.tmp_t181/certificat.js");

// --- Fixture : certificat auto-signé + clé
// NB : node-forge n'encode PAS lui-même les attributs en UTF-8 dans les
// conteneurs PKCS#12/PKCS#7 — un CN accentué y resterait un caractère
// Unicode brut (> 0xFF) que le passage en Buffer tronquerait. Les fichiers
// RÉELS (Windows/OpenSSL) contiennent des octets encodés : pour simuler
// exactement un fichier réel, on encode explicitement les valeurs en UTF-8.
const utf8 = (s) => forge.util.encodeUtf8(s);
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = new Date().getTime().toString(16).toUpperCase();
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 2);
const attrs = [
  { name: "commonName", value: utf8("Société Atlas SARL — Paie") },
  { name: "organizationName", value: utf8("Atlas Test") },
  { shortName: "OU", value: utf8("Ressources Humaines") },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([{ name: "basicConstraints", cA: false }]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const pemCert = forge.pki.certificateToPem(cert);
const derCert = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), "binary");

let ok = 0, ko = 0;
function check(nom, cond, extra) {
  if (cond) { ok++; console.log("  OK  " + nom + (extra ? " → " + extra : "")); }
  else { ko++; console.log("  ÉCHEC " + nom + (extra ? " → " + extra : "")); }
}

(async () => {
  // 1) PKCS#12 SANS mot de passe
  const p12Der = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, "")).getBytes(), "binary");
  let r = await analyserFichierSignature(p12Der);
  check("PKCS#12 sans mot de passe", r.ok && r.famille === "P12" && r.clePriveePresente === true, r.ok ? r.format + " CN=" + r.sujetCN + " séries=" + r.nbCertificats : r.erreur);

  // 2) PKCS#12 AVEC mot de passe : sans → erreur dédiée ; avec → OK
  const p12Protege = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, "Secret123!")).getBytes(), "binary");
  r = await analyserFichierSignature(p12Protege);
  check("PKCS#12 protégé sans mot de passe → erreur dédiée", !r.ok && /mot de passe/i.test(r.erreur), !r.ok ? r.erreur : "IMPORTÉ à tort");
  r = await analyserFichierSignature(p12Protege, "Secret123!");
  check("PKCS#12 protégé avec bon mot de passe", r.ok && r.famille === "P12", r.ok ? r.sujetCN : r.erreur);

  // 3) PKCS#7 signé DER (.p7s réaliste)
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer("Document Auto-RH", "utf8");
  p7.addCertificate(cert);
  p7.addSigner({ key: keys.privateKey, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
  p7.sign({ detached: false });
  const p7PemBrut = forge.pkcs7.messageToPem(p7);
  // node-forge n'expose pas messageToAsn1 : PEM → body (binaire latin1) → DER
  const p7Der = Buffer.from(forge.pem.decode(p7PemBrut)[0].body, "binary");
  r = await analyserFichierSignature(p7Der);
  check("PKCS#7 DER (.p7s)", r.ok && r.famille === "PKCS7", r.ok ? r.format : r.erreur);
  const p7Pem = Buffer.from(p7PemBrut, "utf8");
  r = await analyserFichierSignature(p7Pem);
  check("PKCS#7 PEM", r.ok && r.famille === "PKCS7", r.ok ? r.format : r.erreur);

  // 4) X.509 PEM + DER
  r = await analyserFichierSignature(Buffer.from(pemCert, "utf8"));
  check("X.509 PEM", r.ok && r.famille === "X509" && r.sujetCN.includes("Soci"), r.ok ? r.sujetCN : r.erreur);
  r = await analyserFichierSignature(derCert);
  check("X.509 DER", r.ok && r.famille === "X509", r.ok ? r.format : r.erreur);

  // 5) XML-DSig
  const xml = '<?xml version="1.0"?>\n<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><KeyInfo><X509Data><X509Certificate>' + derCert.toString("base64") + "</X509Certificate></X509Data></KeyInfo></Signature>";
  r = await analyserFichierSignature(Buffer.from(xml, "utf8"));
  check("XML-DSig", r.ok && r.famille === "XMLDSIG", r.ok ? r.format : r.erreur);

  // 6) JWS x5c
  const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jws = b64u(JSON.stringify({ alg: "RS256", x5c: [derCert.toString("base64")] })) + "." + b64u("{}") + ".c2ln";
  r = await analyserFichierSignature(Buffer.from(jws, "utf8"));
  check("JWS x5c", r.ok && r.famille === "JWS", r.ok ? r.format : r.erreur);

  // 7) ZIP contenant .p7s + xml
  const JSZip = require("jszip");
  const zip = new JSZip();
  zip.file("signature.p7s", p7Der);
  zip.file("META-INF/signature.xml", xml);
  const zipBuf = await zip.generateAsync({ type: "nodebuffer" });
  r = await analyserFichierSignature(zipBuf);
  check("ZIP avec .p7s", r.ok && r.famille === "ZIP", r.ok ? r.format : r.erreur);

  // 8) erreurs attendues
  r = await analyserFichierSignature(Buffer.from("Ceci n'est pas une signature électronique du tout.", "utf8"));
  check("Texte brut → erreur claire", !r.ok && /Format de signature non reconnu/.test(r.erreur), !r.ok ? r.erreur.slice(0, 60) + "…" : "accepté à tort");
  r = await analyserFichierSignature(Buffer.from("<racine>pas de certificat ici</racine>", "utf8"));
  check("XML sans certificat → erreur", !r.ok && /X509Certificate/.test(r.erreur), !r.ok ? r.erreur.slice(0, 70) + "…" : "accepté à tort");

  console.log("\n=== " + ok + " OK / " + ko + " ÉCHEC ===");
  process.exit(ko ? 1 : 0);
})();
