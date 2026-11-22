#!/usr/bin/env node
/**
 * Task 25 — vérification du contenu d'un fichier .docx INDIVIDUEL.
 *
 * Usage : node verify_docx_content.js <fichier.docx> <CIN attendu> [CINs interdits...]
 *
 * Vérifie :
 *  - l'archive est un ZIP lisible contenant word/document.xml et
 *    [Content_Types].xml ;
 *  - le texte visible contient le CIN attendu (et son libellé) ;
 *  - les CIN interdits (autres employés) sont ABSENTS du texte ET du XML ;
 *  - le XML est équilibré (autant de <w:p que de </w:p>).
 * Code 0 = tout OK, code 1 = échec (motif affiché).
 */
const fs = require("fs");
const JSZip = require("jszip");

(async () => {
  const [file, expected, ...forbidden] = process.argv.slice(2);
  if (!file || !expected) {
    console.error("Usage: node verify_docx_content.js <fichier.docx> <CIN> [interdits...]");
    process.exit(1);
  }
  const fail = (m) => {
    console.error("ÉCHEC:", m);
    process.exit(1);
  };

  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 2).toString() !== "PK") fail("signature ZIP absente (pas un .docx)");

  let zip, docXml, types;
  try {
    zip = await JSZip.loadAsync(buf);
    docXml = await zip.file("word/document.xml").async("string");
    types = await zip.file("[Content_Types].xml").async("string");
  } catch (e) {
    fail("archive illisible : " + e.message);
  }
  if (!docXml) fail("word/document.xml absent");
  if (!types || !types.includes("wordprocessingml")) {
    fail("[Content_Types].xml invalide (wordprocessingml attendu)");
  }

  // Texte visible : contenu des <w:t>, 1 ligne par paragraphe
  const lines = [];
  const paraRe = /<w:p\b[^>]*\/>|<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let m;
  while ((m = paraRe.exec(docXml)) !== null) {
    let text = "";
    const segRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let s;
    while ((s = segRe.exec(m[1] || "")) !== null) text += s[1];
    lines.push(text);
  }
  const text = lines.join("\n");

  if (!text.includes(expected)) {
    fail(`CIN attendu ${expected} ABSENT du texte (lignes: ${lines.length})`);
  }
  if (!/C\.?I\.?N/i.test(text)) {
    fail("libellé CIN absent du texte");
  }
  for (const cin of forbidden) {
    if (text.includes(cin)) fail(`CIN INTERDIT ${cin} présent dans le TEXTE (fuite)`);
    if (docXml.includes(cin)) fail(`CIN INTERDIT ${cin} présent dans le XML (fuite)`);
  }

  // Équilibre XML des paragraphes
  const opens = (docXml.match(/<w:p\b/g) || []).length;
  const closes = (docXml.match(/<\/w:p>/g) || []).length;
  if (opens !== closes) fail(`XML déséquilibré : ${opens} <w:p vs ${closes} </w:p>`);

  console.log(
    `OK: ${file} — CIN ${expected} présent, ${forbidden.length} CIN interdit(s) absent(s), ${lines.length} paragraphes, XML équilibré`
  );
  process.exit(0);
})();
