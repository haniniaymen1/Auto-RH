/** (Task 200) Vérification du JS embarqué dans DEMANDES_HTML :
 *  extrait le script de la page /demandes et le fait parser par Node
 *  (le node --check du fichier parent ne parse PAS le contenu du template). */
const fs = require("fs");
const src = fs.readFileSync("/home/z/my-project/scripts/portail-server.js", "utf8");
const debut = src.indexOf("const DEMANDES_HTML = `");
const fin = src.indexOf("`;", debut);
if (debut < 0 || fin < 0) { console.error("DEMANDES_HTML introuvable"); process.exit(1); }
let html = src.slice(debut + "const DEMANDES_HTML = `".length, fin);
// Dé-échapper les séquences \` et ${ du template literal
html = html.replace(/\\`/g, "`").replace(/\\\$\{/g, "${");
const m = html.match(/<script>([\s\S]*?)<\/script>/g);
if (!m) { console.error("Aucun script trouvé"); process.exit(1); }
const dernier = m[m.length - 1].replace(/<\/?script>/g, "");
fs.writeFileSync("/tmp/demandes-page-script.js", dernier);
console.log("Script extrait :", dernier.length, "caractères");
const { execSync } = require("child_process");
try {
  execSync("node --check /tmp/demandes-page-script.js", { stdio: "pipe" });
  console.log("PARSE-OK : le JS de la page /demandes est syntaxiquement valide");
} catch (e) {
  console.error("PARSE-ERREUR :", e.stderr.toString().slice(0, 800));
  process.exit(1);
}
// Contrôles de présence des éléments Task 200 — d'abord dans le JS de la page
const attendusScript = [
  "statut-final", "d-etapes", "FRAICHEUR_MS", "demarrerRafraichissementStatut",
  "empreinteDemandes", "visibilitychange", "Statut final",
  "decisionManagerLibelle", "decisionRhLibelle", "btn-actualiser", "maj-info",
];
const manquantsScript = attendusScript.filter((a) => dernier.indexOf(a) < 0);
if (manquantsScript.length) { console.error("MANQUANTS (script) :", manquantsScript.join(", ")); process.exit(1); }
console.log("CONTENU-OK : tous les éléments JS Task 200 présents dans le script");
// puis dans le HTML de la page (hors script)
const htmlSeul = html.replace(/<script>[\s\S]*?<\/script>/g, "");
const attendusHtml = ["maj-ligne", "btn-actualiser", "maj-info", "d-etapes"];
const manquantsHtml = attendusHtml.filter((a) => htmlSeul.indexOf(a) < 0);
if (manquantsHtml.length) { console.error("MANQUANTS (html) :", manquantsHtml.join(", ")); process.exit(1); }
console.log("CONTENU-OK : tous les éléments HTML Task 200 présents dans la page");
