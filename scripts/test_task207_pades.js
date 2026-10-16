// Task 207 — Re-vérification PAdES des 4 PDF sauvegardés (correction de
// l'interprétation /ByteRange : [a b c d] = plages signées [a,a+b) et [c,c+d)
// — c est un offset ABSOLU ; couverture intégrale ⇔ a=0 ET c+d === taille).
process.chdir(__dirname + "/..");
const fs = require("fs");
const { execFileSync } = require("child_process");
const TMP = "/tmp/task207";
let ok = 0, fail = 0;
function check(nom, cond, detail) {
  if (cond) { ok++; console.log("  OK   " + nom + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  FAIL " + nom + (detail ? " — " + detail : "")); }
}
const cles = ["D3-conge-2etapes", "D4-autor-2etapes", "D5-conge-2etapes-zoho", "D6-autor-mgr-refuse"];
for (const cle of cles) {
  const pdf = fs.readFileSync(TMP + "/" + cle + ".pdf");
  const s = pdf.toString("latin1");
  const m = s.match(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/);
  if (!m) { check(cle + " : /ByteRange présent", false); continue; }
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  check(cle + " : /ByteRange [" + [a, b, c, d].join(" ") + "] — la plage signée couvre le FICHIER ENTIER (c+d=" + (c + d) + " = taille " + pdf.length + ")", a === 0 && c + d === pdf.length, "plages [0," + b + ") + [" + c + "," + (c + d) + ") — trou = /Contents hex");
  const cm = s.match(/\/Contents\s*<([0-9A-Fa-f]+)>/);
  if (!cm) { check(cle + " : /Contents présent", false); continue; }
  let hex = cm[1];
  const base = TMP + "/" + cle;
  fs.writeFileSync(base + "-contenu.bin", Buffer.concat([pdf.subarray(0, b), pdf.subarray(c, c + d)]));
  let verif = "";
  for (let essai = 0; essai < 2; essai++) {
    fs.writeFileSync(base + "-sig.der", Buffer.from(hex, "hex"));
    try { execFileSync("openssl", ["smime", "-verify", "-inform", "DER", "-in", base + "-sig.der", "-content", base + "-contenu.bin", "-noverify", "-out", "/dev/null"], { stdio: ["ignore", "pipe", "pipe"] }); verif = "Verification successful"; }
    catch (e) { verif = String((e.stderr || e.message || "")).split("\n")[0]; }
    if (/successful/i.test(verif)) break;
    while (hex.endsWith("00") && hex.length > 16) hex = hex.slice(0, -2);
  }
  check(cle + " : SIGNATURE CRYPTOGRAPHIQUE VÉRIFIÉE (openssl smime — Verification successful)", /successful/i.test(verif), verif.slice(0, 80));
}
console.log("\n" + ok + " OK / " + fail + " FAIL");
process.exit(fail ? 1 : 0);
