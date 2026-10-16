/** Import d'un certificat de DÉMONSTRATION pour la vérification navigateur
 * (Task 181) — sans toucher à l'interrupteur général du tampon.
 * Usage : node scripts/demo_task181_import.js [import|retrait] */
process.chdir(__dirname + "/..");
const fs = require("fs");
const path = require("path");
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const forge = require("node-forge");
const BASE = "http://localhost:4000";
const ACTION = process.argv[2] || "import";

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
  { name: "organizationName", value: utf8("Atlas Distribution") },
  { shortName: "OU", value: utf8("Direction Financière") },
];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([{ name: "basicConstraints", cA: false }]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = Buffer.from(
  forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, "")).getBytes(),
  "binary"
);

(async () => {
  let cookie = "";
  const req = async (method, p, body) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setC = res.headers.get("set-cookie");
    if (setC) cookie = setC.split(";")[0];
    let json = null;
    try { json = await res.json(); } catch { /* noop */ }
    return { status: res.status, json };
  };
  let r = await req("POST", "/api/auth/login", {
    email: "superadmin@autorh.local",
    password: "AutoRH-2026!Verif#1",
  });
  if (r.status !== 200) {
    r = await req("POST", "/api/auth/login", {
      email: "superadmin@autorh.local",
      password: "AutoRH-2026!Verif",
    });
  }
  if (r.status !== 200) throw new Error("connexion impossible");
  if (ACTION === "import") {
    r = await req("POST", "/api/signature-config/certificat", {
      nom: "cachet_atlas_distribution.p12",
      data: p12.toString("base64"),
    });
    console.log("IMPORT", r.status, JSON.stringify(r.json?.certificat || r.json));
  } else {
    r = await req("DELETE", "/api/signature-config/certificat");
    console.log("RETRAIT", r.status);
    // nettoyage des copies certificat-*
    const dossier = path.join(process.cwd(), "storage", "tampons");
    if (fs.existsSync(dossier)) {
      for (const n of fs.readdirSync(dossier).filter((x) => x.startsWith("certificat-"))) {
        try { fs.unlinkSync(path.join(dossier, n)); } catch { /* noop */ }
      }
    }
  }
})();
