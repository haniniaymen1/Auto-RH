/**
 * (v0.2.137) VÉRIFICATION E2E DU TOAST DU TAMPON APRÈS ENREGISTREMENT
 * ================================================================
 * Origine (capture utilisateur du 03/10/2026) : après activation de
 * l'interrupteur général + du cachet « Signature électronique » (elecActif),
 * le toast affichait à tort « Aucun élément du tampon n'est activé ».
 *
 * Cause : le PUT /api/signature-config jugeait tamponActif() sur la config
 * BRUTE — or les métadonnées du cachet (elec) ne sont JAMAIS stockées en
 * base (injectées au rendu par completerConfigTamponAvecElec). Le cachet
 * seul donnait donc tamponActif=false même quand le module de signature
 * était opérationnel.
 *
 * Correctif v0.2.137 :
 *   - PUT/GET (fiches + réponses) : jugement sur la config COMPLÉTÉE ;
 *   - le PUT renvoie elecCouvert (module actif + certificat + couverture) ;
 *   - le panneau distingue 4 cas de toast, dont le nouveau « cachet en
 *     attente du module » qui guide vers l'onglet Paramètres.
 *
 * Scénarios prouvés ici (API via cookies de session Playwright + UI réelle) :
 *   A  module OK + cachet seul actif        -> PUT tamponActif=true, elecCouvert=true
 *   B  module KO + cachet seul actif        -> PUT tamponActif=false, elecCouvert=false
 *   C  module KO + interrupteur ON + AUCUN élément -> tamponActif=false (cas générique)
 *   D  interrupteur général OFF             -> tamponActif=false (cas désactivé)
 *   E  GET : cohérence module OK/KO pour le même état
 *   F  Réponses (scope=reponse) : même jugement corrigé
 *   UI : toast « cachet en attente du module » (module KO) PUIS toast de
 *        succès « Tampon signature / QR enregistré » (module OK) — captures.
 *
 * Restauration complète de l'état initial en fin de run (configs + row
 * réponses + compte de test à supprimer par verif-tampon-compte.ts).
 */
const { chromium } = require("playwright");
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");

const BASE = "http://localhost:4000";
const DB = "/home/z/my-project/db/custom.db";
const OUT = "/home/z/my-project/download/verif-toast-tampon";
const EMAIL = "e2e-tampon@servicerh.local";
const MDP = "E2eTampon!2026";

const resultats = [];
const check = (nom, ok, detail = "") => {
  resultats.push({ nom, ok, detail });
  console.log(`${ok ? "[OK]" : "[KO]"} ${nom}${detail ? " — " + detail : ""}`);
};

function ouvrirDb() {
  return new DatabaseSync(DB);
}

function snapshot(db) {
  const sig = db.prepare("SELECT * FROM SignatureConfig WHERE id='signature'").get();
  const api = db.prepare("SELECT * FROM SignatureApiConfig WHERE id='signature-api'").get();
  const repAvant = db.prepare("SELECT COUNT(*) AS n FROM SignatureConfigReponse").get();
  return { sig, api, repExistant: repAvant.n > 0 };
}

function restaurer(db, snap) {
  if (snap.sig) {
    db.prepare(
      `UPDATE SignatureConfig SET actif=?,sigActif=?,qrActif=?,mentionActif=?,certActif=?,
       elecActif=?,elecForme=?,elecPosition=?,elecDecalX=?,elecDecalY=?,elecTaille=?,
       elecAffSignataire=?,elecAffOrganisation=?,elecAffEmetteur=?,elecAffValidite=?,
       elecAffEmpreinte=?,elecTexteLibre=? WHERE id='signature'`
    ).run(
      snap.sig.actif ? 1 : 0, snap.sig.sigActif ? 1 : 0, snap.sig.qrActif ? 1 : 0,
      snap.sig.mentionActif ? 1 : 0, snap.sig.certActif ? 1 : 0,
      snap.sig.elecActif ? 1 : 0, snap.sig.elecForme, snap.sig.elecPosition,
      snap.sig.elecDecalX, snap.sig.elecDecalY, snap.sig.elecTaille,
      snap.sig.elecAffSignataire ? 1 : 0, snap.sig.elecAffOrganisation ? 1 : 0,
      snap.sig.elecAffEmetteur ? 1 : 0, snap.sig.elecAffValidite ? 1 : 0,
      snap.sig.elecAffEmpreinte ? 1 : 0, snap.sig.elecTexteLibre
    );
  }
  if (snap.api) {
    db.prepare(
      `UPDATE SignatureApiConfig SET actif=?,mode=?,certSujet=?,signerFiches=?,signerReponses=?
       WHERE id='signature-api'`
    ).run(
      snap.api.actif ? 1 : 0, snap.api.mode, snap.api.certSujet,
      snap.api.signerFiches ? 1 : 0, snap.api.signerReponses ? 1 : 0
    );
  }
  if (!snap.repExistant) {
    db.prepare("DELETE FROM SignatureConfigReponse WHERE id='signature-reponse'").run();
  }
}

function moduleEtat(db, actif) {
  db.prepare("UPDATE SignatureApiConfig SET actif=? WHERE id='signature-api'").run(actif ? 1 : 0);
}

const CORPS_ELEC_SEUL = {
  actif: true, sigActif: false, qrActif: false, mentionActif: false, certActif: false,
  elecActif: true, elecPosition: "BAS_DROITE", elecForme: "RECTANGLE",
  elecAffOrganisation: true,
};
const CORPS_RIEN = {
  actif: true, sigActif: false, qrActif: false, mentionActif: false, certActif: false,
  elecActif: false,
};
const CORPS_OFF = { ...CORPS_RIEN, actif: false };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const db = ouvrirDb();
  const snap = snapshot(db);
  console.log(`Snapshot : sig.actif=${snap.sig?.actif} mention=${snap.sig?.mentionActif} | api.actif=${snap.api?.actif} certSujet='${snap.api?.certSujet}' | repExistant=${snap.repExistant}`);

  const navigateur = await chromium.launch();
  const contexte = await navigateur.newContext({ viewport: { width: 1440, height: 1000 } });

  try {
    // ---- Connexion UI (compte de test SUPERADMIN) ----
    const page = await contexte.newPage();
    await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    await page.fill('input[type="email"], input[name="email"]', EMAIL);
    await page.fill('input[type="password"], input[name="password"]', MDP);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    check("Connexion SUPERADMIN (compte de test)", !page.url().includes("/login"), page.url());

    const req = contexte.request;

    // ---- Scénario A : module couvert + cachet seul -> tamponActif TRUE ----
    moduleEtat(db, true);
    db.prepare("UPDATE SignatureApiConfig SET certSujet=? WHERE id='signature-api'").run("CN=E2E Cachet v0.2.137");
    let r = await req.put(BASE + "/api/signature-config", { data: CORPS_ELEC_SEUL });
    let d = await r.json().catch(() => ({}));
    check("A/PUT module OK + cachet seul -> tamponActif=true", r.status() === 200 && d.tamponActif === true,
      `status=${r.status()} tamponActif=${d.tamponActif} elecCouvert=${d.elecCouvert}`);
    check("A/PUT elecCouvert=true", d.elecCouvert === true);

    // ---- Scénario B : module KO + cachet seul -> FALSE + elecCouvert=false ----
    moduleEtat(db, false);
    r = await req.put(BASE + "/api/signature-config", { data: CORPS_ELEC_SEUL });
    d = await r.json().catch(() => ({}));
    check("B/PUT module KO + cachet seul -> tamponActif=false", r.status() === 200 && d.tamponActif === false,
      `status=${r.status()} tamponActif=${d.tamponActif}`);
    check("B/PUT elecCouvert=false", d.elecCouvert === false);

    // ---- Scénario C : interrupteur ON + AUCUN élément (générique) ----
    r = await req.put(BASE + "/api/signature-config", { data: CORPS_RIEN });
    d = await r.json().catch(() => ({}));
    check("C/PUT interrupteur ON sans élément -> tamponActif=false", r.status() === 200 && d.tamponActif === false);

    // ---- Scénario D : interrupteur général OFF ----
    r = await req.put(BASE + "/api/signature-config", { data: CORPS_OFF });
    d = await r.json().catch(() => ({}));
    check("D/PUT interrupteur OFF -> tamponActif=false", r.status() === 200 && d.tamponActif === false);

    // ---- Scénario E : GET cohérent (cachet seul actif) ----
    r = await req.put(BASE + "/api/signature-config", { data: CORPS_ELEC_SEUL }); // remet cachet ON
    moduleEtat(db, false);
    r = await req.get(BASE + "/api/signature-config");
    d = await r.json().catch(() => ({}));
    check("E/GET module KO -> tamponActif=false", r.status() === 200 && d.tamponActif === false,
      `tamponActif=${d.tamponActif}`);
    moduleEtat(db, true);
    r = await req.get(BASE + "/api/signature-config");
    d = await r.json().catch(() => ({}));
    check("E/GET module OK -> tamponActif=true", r.status() === 200 && d.tamponActif === true,
      `tamponActif=${d.tamponActif}`);

    // ---- Scénario F : réponses (scope=reponse) ----
    moduleEtat(db, true);
    r = await req.put(BASE + "/api/signature-config", {
      data: { scope: "reponse", ...CORPS_ELEC_SEUL },
    });
    d = await r.json().catch(() => ({}));
    check("F/PUT réponses module OK + cachet seul -> tamponActif=true",
      r.status() === 200 && d.tamponActif === true,
      `status=${r.status()} tamponActif=${d.tamponActif}`);
    moduleEtat(db, false);
    r = await req.put(BASE + "/api/signature-config", {
      data: { scope: "reponse", ...CORPS_ELEC_SEUL },
    });
    d = await r.json().catch(() => ({}));
    check("F/PUT réponses module KO -> tamponActif=false",
      r.status() === 200 && d.tamponActif === false,
      `tamponActif=${d.tamponActif}`);

    // ---- UI : toast « cachet en attente du module » (module KO) ----
    moduleEtat(db, false);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    // Onglet « Importer » (panneau « Signature électronique & QR code »)
    const ongletImporter = page.locator("button, [role=tab]").filter({ hasText: /Importer/i }).first();
    await ongletImporter.click();
    await page.waitForTimeout(1200);
    // Interrupteur général du tampon (dans le panneau signature) : déjà ON en base
    const panneau = page.locator("text=Signature électronique & QR code").first();
    await panneau.scrollIntoViewIfNeeded().catch(() => {});
    // Bouton « Enregistrer » du panneau signature (le premier du panneau)
    const boutons = page.locator('button:has-text("Enregistrer")');
    const boutonSave = boutons.first();
    await boutonSave.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
    await boutonSave.click();
    // Attendre le toast
    const toast = page.locator('[role="status"], [data-sonner-toast], li[data-testid="sonner-toast"], .Toastify__toast').first();
    await toast.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
    const texteToast = (await toast.textContent().catch(() => "")) || "";
    check("UI/toast module KO = « cachet en attente du module »",
      texteToast.includes("en attente du module"),
      JSON.stringify(texteToast.slice(0, 140)));
    await page.screenshot({ path: OUT + "/toast-module-ko.png", fullPage: false });

    // ---- UI : toast succès après activation du module ----
    moduleEtat(db, true);
    await page.waitForTimeout(400);
    await boutonSave.click();
    const toast2 = page.locator('[role="status"], [data-sonner-toast], li[data-testid="sonner-toast"], .Toastify__toast').first();
    await toast2.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(800);
    const texteToast2 = (await toast2.textContent().catch(() => "")) || "";
    check("UI/toast module OK = « Tampon signature / QR enregistré »",
      texteToast2.includes("Tampon signature / QR enregistré"),
      JSON.stringify(texteToast2.slice(0, 140)));
    await page.screenshot({ path: OUT + "/toast-module-ok.png", fullPage: false });

    // ---- Restauration complète ----
    restaurer(db, snap);
    const apres = db.prepare("SELECT actif,mentionActif,elecActif FROM SignatureConfig WHERE id='signature'").get();
    const apresApi = db.prepare("SELECT actif,certSujet FROM SignatureApiConfig WHERE id='signature-api'").get();
    const apresRep = db.prepare("SELECT COUNT(*) AS n FROM SignatureConfigReponse").get();
    check("Restauration état initial",
      apres.actif === snap.sig?.actif && apresApi.actif === snap.api?.actif
        && apresApi.certSujet === snap.api?.certSujet && apresRep.n === (snap.repExistant ? 1 : 0),
      `sig.actif=${apres.actif} api.actif=${apresApi.actif} rep=${apresRep.n}`);
  } finally {
    await navigateur.close();
    db.close();
  }

  const ok = resultats.filter((x) => x.ok).length;
  console.log(`\nBILAN : ${ok}/${resultats.length} contrôles OK`);
  fs.writeFileSync(OUT + "/resultats.json", JSON.stringify(resultats, null, 2));
  process.exit(ok === resultats.length ? 0 : 1);
})();
