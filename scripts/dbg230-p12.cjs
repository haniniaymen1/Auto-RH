#!/usr/bin/env node
/* Débogage de la structure PKCS#12 réelle (dump arbre ASN.1). */
const fs = require("fs");
const path = require("path");
const os = require("os");
const ts = require("/home/z/my-project/node_modules/typescript");
const LAB = fs.mkdtempSync(path.join(os.tmpdir(), "dbg-"));
for (const f of ["der-encode.ts", "pkcs12-pur.ts", "cms-pur.ts"]) {
  const js = ts.transpileModule(fs.readFileSync("/home/z/my-project/src/lib/" + f, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  fs.writeFileSync(path.join(LAB, f.replace(".ts", ".js")), js);
}
const der = require(path.join(LAB, "der-encode.js"));

const p12 = fs.readFileSync(process.argv[2] || "/tmp/fix230-CfyHC6/coffre-pbes2.p12");
const racine = der.elements(p12);
const pfx = racine[0];
const champs = der.elements(pfx.contenu);
console.log("PFX champs:", champs.map(c => ({ tag: c.tag.toString(16), num: c.numero, len: c.contenu.length })));
const authSafeInfo = der.elements(champs[1].contenu);
console.log("authSafe ContentInfo:", authSafeInfo.map(c => ({ tag: c.tag.toString(16), num: c.numero, len: c.contenu.length })));
console.log("OID authSafe:", der.derVersOid(authSafeInfo[0]));
const enveloppe = der.enfant(authSafeInfo, 0x80, 0);
const interieur = der.elements(enveloppe.contenu);
console.log("interieur [0]:", interieur.map(c => ({ tag: c.tag.toString(16), len: c.contenu.length })));
const donnees = interieur[0].contenu;
const authSafe = der.elements(donnees);
console.log("AuthenticatedSafe: N ContentInfo =", authSafe.length);
for (const info of authSafe) {
  const ch = der.elements(info.contenu);
  const oid = der.derVersOid(ch[0]);
  const env = der.enfant(ch, 0x80, 0);
  const prem = der.elements(env.contenu)[0];
  console.log("  ContentInfo", oid, "premier tag", prem.tag.toString(16), "len", prem.contenu.length);
  if (oid === "1.2.840.113549.1.7.1") {
    const sc = der.elements(prem.contenu)[0];
    const bags = der.elements(sc.contenu);
    console.log("    SafeContents: N bags =", bags.length);
    for (const bag of bags) {
      const cb = der.elements(bag.contenu);
      const bagOid = der.derVersOid(cb[0]);
      const val = der.enfant(cb, 0x80, 0);
      const inter = der.elements(val.contenu)[0];
      console.log("      bag", bagOid, "valuer premier tag", inter.tag.toString(16));
      if (bagOid === "1.2.840.113549.1.12.10.1.3") {
        // certBag
        const cc = der.elements(inter.contenu);
        console.log("        certBag champ0 OID =", der.derVersOid(cc[0]));
        const envCert = der.enfant(cc, 0x80, 0);
        const oc = der.elements(envCert.contenu)[0];
        console.log("        certValue [0] → tag", oc.tag.toString(16), "len", oc.contenu.length);
        try { const x = new (require('crypto').X509Certificate)(oc.contenu); console.log("        → X509 OK:", x.subject.replace(/\n/g, ", ")); } catch (e) { console.log("        → X509 KO:", e.message.slice(0, 120)); }
      }
    }
  }
}
fs.rmSync(LAB, { recursive: true, force: true });
