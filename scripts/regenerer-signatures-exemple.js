#!/usr/bin/env node
/**
 * Régénère les fichiers de démonstration download/signatures-exemple/
 * (Task 181 : création — Task 200, v0.2.97 : régénérateur node —
 *  Task 205, v0.2.99 : régénération avec les 13 formats acceptés et un
 *  LIRE-MOI documentant les DEUX sections à certificat dédié) :
 *
 *   - certificat-exemple.pem / .cer / .crt / .der : certificat X.509 auto-signé
 *   - signature-exemple.p12 / .pfx          : coffre PKCS#12 (certificat + clé)
 *                                             au format MODERNE PBES2 / PBKDF2 /
 *                                             AES-256-CBC, MAC SHA-256 (défaut
 *                                             OpenSSL 3.x — le format des VRAIS
 *                                             certificats) via le binaire
 *                                             openssl ; repli : coffre forge
 *                                             (PBE historique) si openssl absent ;
 *   - signature-exemple.pkcs7 / .p7s / .p7m
 *                            / .p7b / .p7c : PKCS#7/CMS (chaîne de certificats, DER)
 *   - signature-exemple.xml / .ps7x         : XML-DSig (X509Certificate embarqué)
 *   - document-origine.txt                  : document de démonstration (dossier seul)
 *   - LIRE-MOI.txt                          : mode d'emploi + mot de passe (v0.2.99)
 *   - reconstruit download/signatures-exemple-auto-rh.zip (14 fichiers)
 *
 * Mêmes noms et même mot de passe que scripts/test_task181_signature_formats.js
 * attend (PaieSage2026!, CN=Signature Exemple Auto-RH).
 *
 * Usage : node scripts/regenerer-signatures-exemple.js
 */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const forge = require("node-forge");

const DOSSIER = path.join("download", "signatures-exemple");
const ZIP = path.join("download", "signatures-exemple-auto-rh.zip");
const MDP = "PaieSage2026!";
const CN = "Signature Exemple Auto-RH";

// Fichiers embarqués dans le ZIP (dossier = ce jeu + document-origine.txt)
const FICHIERS_ZIP = [
  "signature-exemple.p12",
  "signature-exemple.pfx",
  "signature-exemple.pkcs7",
  "signature-exemple.p7s",
  "signature-exemple.p7m",
  "signature-exemple.p7b",
  "signature-exemple.p7c",
  "signature-exemple.xml",
  "signature-exemple.ps7x",
  "certificat-exemple.pem",
  "certificat-exemple.cer",
  "certificat-exemple.crt",
  "certificat-exemple.der",
  "LIRE-MOI.txt",
];

fs.mkdirSync(DOSSIER, { recursive: true });

// --- Paire de clés + certificat auto-signé (NOUVEAU à chaque régénération) ---
const cles = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = cles.publicKey;
cert.serialNumber = "04" + Date.now().toString(16);
cert.validity.notBefore = new Date(Date.now() - 86400000);
cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 86400000);
const attrs = [
  { name: "commonName", value: CN },
  { name: "organizationName", value: "Auto-RH Demonstration" },
  { shortName: "OU", value: "Signature" },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([{ name: "basicConstraints", cA: false }]);
cert.sign(cles.privateKey, forge.md.sha256.create());

// --- X.509 : PEM (pem/cer/crt) + DER brut ---
const pemCert = forge.pki.certificateToPem(cert);
fs.writeFileSync(path.join(DOSSIER, "certificat-exemple.pem"), pemCert);
fs.writeFileSync(path.join(DOSSIER, "certificat-exemple.cer"), pemCert);
fs.writeFileSync(path.join(DOSSIER, "certificat-exemple.crt"), pemCert);
const derCert = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
fs.writeFileSync(path.join(DOSSIER, "certificat-exemple.der"), Buffer.from(derCert, "binary"));

// --- PKCS#12 : coffre MODERNE via openssl (PBES2/AES — format des vrais
//     certificats) ; repli forge (PBE historique SHA-1/3DES) si openssl absent.
function pkcs12Forge() {
  const p12 = forge.asn1.toDer(
    forge.pkcs12.toPkcs12Asn1(cles.privateKey, [cert], MDP, { generateMacSalt: true })
  ).getBytes();
  return Buffer.from(p12, "binary");
}
let formatP12 = "forge (PBE historique SHA-1/3DES)";
let octetsP12 = pkcs12Forge();
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p12-exemple-"));
  const cleTmp = path.join(tmp, "cle.pem");
  const certTmp = path.join(tmp, "cert.pem");
  const p12Tmp = path.join(tmp, "coffre.p12");
  fs.writeFileSync(cleTmp, forge.pki.privateKeyToPem(cles.privateKey));
  fs.writeFileSync(certTmp, pemCert);
  execFileSync(
    "openssl",
    ["pkcs12", "-export", "-out", p12Tmp, "-inkey", cleTmp, "-in", certTmp,
     "-name", CN, "-passout", "pass:" + MDP],
    { stdio: "ignore" }
  );
  const moderne = fs.readFileSync(p12Tmp);
  if (moderne.length > 100) {
    octetsP12 = moderne;
    formatP12 = "openssl 3.x (PBES2 / PBKDF2 / AES-256-CBC, MAC SHA-256 — format des certificats réels)";
  }
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) {
  console.log("(openssl indisponible ou en échec — coffre PKCS#12 généré par node-forge : " + e.message + ")");
}
fs.writeFileSync(path.join(DOSSIER, "signature-exemple.p12"), octetsP12);
fs.writeFileSync(path.join(DOSSIER, "signature-exemple.pfx"), octetsP12);

// --- PKCS#7 degenerate (certificat seul, signed-data sans contenu signé) ---
const p7 = forge.pkcs7.createSignedData();
p7.addCertificate(cert);
const der7 = forge.asn1.toDer(p7.toAsn1()).getBytes();
const octets7 = Buffer.from(der7, "binary");
for (const ext of ["pkcs7", "p7s", "p7m", "p7b", "p7c"]) {
  fs.writeFileSync(path.join(DOSSIER, "signature-exemple." + ext), octets7);
}

// --- XML-DSig (X509Certificate encodé en base64 DER) ---
const b64Cert = Buffer.from(derCert, "binary").toString("base64");
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
  <SignedInfo>
    <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
    <SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>
    <Reference URI="">
      <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
      <DigestValue>Auto-RH</DigestValue>
    </Reference>
  </SignedInfo>
  <SignatureValue>Auto-RH</SignatureValue>
  <KeyInfo>
    <X509Data><X509Certificate>${b64Cert}</X509Certificate></X509Data>
  </KeyInfo>
</Signature>
`;
fs.writeFileSync(path.join(DOSSIER, "signature-exemple.xml"), xml);
fs.writeFileSync(path.join(DOSSIER, "signature-exemple.ps7x"), xml);

// --- document-origine.txt (dossier seul, hors ZIP — comme auparavant) ---
fs.writeFileSync(
  path.join(DOSSIER, "document-origine.txt"),
  "Auto-RH — Document de démonstration\n" +
  "Ce document accompagne les fichiers de signature d'exemple (v0.2.99).\n" +
  "Il est associé à : " + CN + " (Auto-RH Demonstration).\n"
);

// --- LIRE-MOI.txt (mode d'emploi à jour v0.2.99 : DEUX sections dédiées) ---
const lireMoins = `FICHIERS DE SIGNATURE ÉLECTRONIQUE D'EXEMPLE — Auto-RH (v0.2.99)
====================================================================

Ces fichiers servent à TESTER l'import du certificat de signature
électronique dans les DEUX sections qui en possèdent une (rôles RH et
superadministrateur) :

  1. Onglet « Importer » → rubrique « Signature électronique & QR code »
     → section « Certificat de signature électronique » (fiches de paie) ;
  2. Onglet « Demandes » → panneau « Configuration des réponses »
     → rubrique « Certificat de signature électronique (réponses) »
     (NOUVEAU v0.2.99 : certificat DÉDIÉ aux réponses du portail).

Le certificat est AUTO-SIGNÉ de DÉMONSTRATION — il n'a AUCUNE valeur
légale.

Certificat de démonstration
---------------------------
Titulaire (CN) : ${CN}
Organisation   : Auto-RH Demonstration — OU Signature
Validité       : 10 ans à compter de la génération
Format coffre  : ${formatP12}
Empreinte      : visible dans le panneau après import (SHA-256)

Fichiers (13 formats acceptés par l'application)
------------------------------------------------
signature-exemple.p12    Coffre PKCS#12 (certificat + clé privée)
signature-exemple.pfx    Le même coffre, extension .pfx
signature-exemple.pkcs7  PKCS#7/CMS (chaîne de certificats, DER)
signature-exemple.p7s    PKCS#7/CMS signature (DER)
signature-exemple.p7m    PKCS#7/CMS données signées (DER)
signature-exemple.p7b    PKCS#7/CMS chaîne (DER) — extension .p7b
signature-exemple.p7c    PKCS#7/CMS chaîne (DER) — extension .p7c
signature-exemple.xml    XML-DSig (certificat X509Certificate embarqué)
signature-exemple.ps7x   Variante XML-DSig (même structure)
certificat-exemple.pem   Certificat X.509 brut (PEM)
certificat-exemple.cer   Le même certificat, extension .cer
certificat-exemple.crt   Le même certificat, extension .crt
certificat-exemple.der   Le même certificat, encodage DER brut
document-origine.txt     Document de démonstration (dans le dossier,
                         hors ZIP — pour référence)

MOT DE PASSE
------------
Le mot de passe ne concerne QUE le coffre PKCS#12 :

    signature-exemple.p12 / .pfx  ->  ${MDP}

Les autres fichiers (.pkcs7, .p7s, .p7m, .p7b, .p7c, .xml, .ps7x,
.pem, .cer, .crt, .der) ne sont PAS protégés par mot de passe :
importez-les en laissant le champ vide. (Depuis la v0.2.97, saisir un
mot de passe par précaution sur ces formats ne provoque plus d'erreur :
il est simplement ignoré.)

Comment tester (chaque section est INDÉPENDANTE)
------------------------------------------------
1. Ouvrir l'administration (port 4000) avec un compte RH ou
   superadministrateur.
2. Section IMPORT (onglet « Importer » → « Signature électronique &
   QR code ») : choisir un des fichiers ci-dessus dans « Certificat de
   signature électronique ». Pour .p12/.pfx, saisir le mot de passe
   ${MDP} (le champ n'apparaît que pour ces deux formats).
3. Section RÉPONSES (onglet « Demandes » → « Configuration des
   réponses » → « Certificat de signature électronique (réponses) ») :
   mêmes étapes — le fichier, le mot de passe et le positionnement de
   CETTE section sont enregistrés SÉPARÉMENT (v0.2.99).
4. Le panneau affiche les informations extraites : titulaire, émetteur,
   numéro de série, validité, empreinte SHA-256.

INDÉPENDANCE DES DEUX SECTIONS (v0.2.99)
----------------------------------------
- Réimporter ou retirer le certificat dans l'Import ne change RIEN aux
  réponses (ni le fichier, ni les métadonnées, ni le mot de passe, ni
  le positionnement) — et inversement ;
- Chaque section possède SON mot de passe PKCS#12, conservé CHIFFRÉ
  (AES-256-GCM) sur le serveur et JAMAIS renvoyé à l'interface : seul
  un indicateur « mot de passe enregistré » est affiché ;
- Le même fichier d'exemple peut être importé des deux côtés pour vos
  tests, ou des fichiers différents si vous souhaitez distinguer les
  signatures des fiches de paie de celles des réponses.

SÉCURITÉ
--------
- Les fichiers .p12/.pfx contiennent une clé privée : dans
  l'application, le fichier importé est enregistré CHIFFRÉ sur le
  disque (storage/tampons/, AES-256-GCM) — personne n'accédant au
  disque ne peut récupérer la clé privée qu'il contient.
- Ne JAMAIS utiliser de vrai certificat de production avec ces fichiers
  d'exemple partagés.
`;
fs.writeFileSync(path.join(DOSSIER, "LIRE-MOI.txt"), lireMoins);

// --- Reconstruction du ZIP (14 fichiers, chemins aplatis) ---
fs.rmSync(ZIP, { force: true });
execFileSync("zip", ["-q", "-j", ZIP, ...FICHIERS_ZIP.map((f) => path.join(DOSSIER, f))]);

console.log("Fichiers régénérés dans " + DOSSIER + " (coffre : " + formatP12 + ") :");
for (const f of fs.readdirSync(DOSSIER).sort()) {
  console.log("  -", f, "(" + fs.statSync(path.join(DOSSIER, f)).size + " o)");
}
console.log("ZIP reconstruit : " + ZIP + " (" + fs.statSync(ZIP).size + " o, " + FICHIERS_ZIP.length + " fichiers)");
