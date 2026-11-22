/**
 * Correctif « bouton Créer l'accès ne fonctionne pas » (v0.2.138) — PREUVE E2E
 *
 * Contexte : lors de la refonte du tableau « Accès portail » (Task 252,
 * v0.2.134), le bouton « Créer l'accès » des lignes pré-remplies (badge
 * « Accès non créé », tableau desktop) a PERDU son onClick — clic sans
 * aucun effet. Le bouton des cartes mobiles, lui, restait fonctionnel.
 *
 * Ce script prouve le correctif de bout en bout :
 *   1. Connexion administration (port 4000) avec le compte temporaire RH.
 *   2. Onglet « Accès portail » → tableau pré-rempli.
 *   3. Clic réel sur « Créer l'accès » de la PREMIÈRE ligne « Accès non créé ».
 *   4. Assertion : le dialogue « Mot de passe initial » s'OUVRE avec un
 *      mot de passe affiché (bouton cliquable → création effective).
 *   5. NETTOYAGE : suppression de l'accès créé (API « delete ») pour ne pas
 *      polluer la base, puis suppression du compte de test (externe).
 *
 * Prérequis : npx tsx scripts/e2e-compte-test.ts creer
 */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = "http://localhost:4000";
const CIN_TEST = "99988877"; // fiche fictive injectée par scripts/e2e-donnee-creer-acces.ts
const OUT = "/home/z/my-project/download/verif-bouton-creer-acces";
fs.mkdirSync(OUT, { recursive: true });

const resultats = [];
const check = (nom, ok, detail) => {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${nom}${detail ? " — " + detail : ""}`);
};

(async () => {
  const navigateur = await chromium.launch();
  const page = await navigateur.newPage({ viewport: { width: 1440, height: 900 } });

  // --- 1) Connexion ---
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.fill('input[type="email"], input[name="email"]', "e2e-tableau@servicerh.local");
  await page.fill('input[type="password"], input[name="password"]', "E2eTableau!2026");
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  check("Connexion administration", !page.url().includes("/login"), page.url());

  // --- 2) Onglet « Accès portail » ---
  await page.locator("text=Accès portail").first().click();
  await page.waitForTimeout(2500);
  const table = page.locator("table").first();
  await table.waitFor({ state: "visible", timeout: 15000 });

  // --- 3) Ligne pré-remplie du CIN de test (variante DESKTOP) ---
  const ligne = page
    .locator("tr", { has: page.locator('span:has-text("Accès non créé")') })
    .filter({ hasText: CIN_TEST })
    .first();
  const visibleLigne = await ligne.isVisible().catch(() => false);
  check("Ligne pré-remplie « Accès non créé » présente (CIN " + CIN_TEST + ")", visibleLigne);
  if (!visibleLigne) {
    await page.screenshot({ path: OUT + "/sans-ligne-a-creer.png", fullPage: false });
    console.log("(Ligne de test absente — vérifier scripts/e2e-donnee-creer-acces.ts creer.)");
    await navigateur.close();
    process.exit(2);
  }

  const cin = CIN_TEST;
  const bouton = ligne.locator('button:has-text("Créer l\'accès")').first();
  const infosBouton = await bouton.evaluate((b) => ({
    disabled: b.disabled,
    aOnClick: typeof b.onclick === "function" || b.getAttribute("onclick") !== null || true, // React: délégation
    texte: b.innerText.trim(),
  }));
  check("Bouton « Créer l'accès » présent et actif", !infosBouton.disabled, `texte="${infosBouton.texte}"`);
  await page.screenshot({ path: OUT + "/avant-clic.png", fullPage: false });

  // --- 4) Clic réel → dialogue « Mot de passe initial » ---
  await bouton.click();
  const dialogue = page.locator('[role="dialog"]', { hasText: "Mot de passe initial" });
  await dialogue.waitFor({ state: "visible", timeout: 15000 });
  const code = dialogue.locator("code").first();
  const motDePasse = (await code.innerText().catch(() => "")).trim();
  check("Dialogue « Mot de passe initial » OUVERT après clic", true);
  check(
    "Mot de passe initial généré et affiché",
    motDePasse.length >= 8,
    `longueur=${motDePasse.length} aperçu=${motDePasse.slice(0, 2)}***`
  );
  await page.screenshot({ path: OUT + "/dialogue-mot-de-passe.png", fullPage: false });

  // --- 5) NETTOYAGE : suppression de l'accès créé (via l'API, cookies de session) ---
  const cinBrut = cin;
  const nettoyage = await page.evaluate(async (cinCible) => {
    try {
      const r1 = await fetch("/api/portal-access", { cache: "no-store" });
      if (!r1.ok) return { ok: false, err: "GET " + r1.status };
      const d = await r1.json();
      const cible = (d.items ?? []).find((it) => it.cin === cinCible);
      if (!cible) return { ok: false, err: "accès introuvable pour CIN test" };
      const r2 = await fetch("/api/portal-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: cible.id }),
      });
      return { ok: r2.ok, err: r2.ok ? null : "DELETE " + r2.status };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  }, cinBrut);
  check("Nettoyage : accès de test supprimé", nettoyage.ok, nettoyage.err ?? undefined);

  // Fermeture du dialogue (déjà supprimé côté serveur)
  await page.keyboard.press("Escape").catch(() => {});
  await navigateur.close();

  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\nTOTAL : ${resultats.length - echecs.length}/${resultats.length} contrôles OK`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error("ERREUR FATALE :", e);
  process.exit(1);
});
