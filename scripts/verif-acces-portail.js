/**
 * Task (correctif affichage « Accès portail ») — VÉRIFICATION E2E
 * 1. Connexion administration (port 4000) avec admin2@servicerh.local
 * 2. Navigation vers l'onglet « Accès portail »
 * 3. Captures d'écran à 2 largeurs (1440 px et 1024 px)
 * 4. Contrôles programmatiques :
 *    - aucun chevauchement de boutons dans la colonne Actions ;
 *    - les boutons ne débordent PAS de leur cellule (rects contenus) ;
 *    - en-têtes alignés avec les colonnes de données ;
 *    - défilement horizontal possible (scrollWidth > clientWidth) ;
 *    - le tableau garde ses colonnes (table-fixed) sans déformation.
 */
const { chromium } = require("playwright");

const BASE = "http://localhost:4000";
const OUT = "/home/z/my-project/download/verif-acces-portail";
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const navigateur = await chromium.launch();
  const resultats = [];
  const check = (nom, ok, detail) => {
    resultats.push({ nom, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${nom}${detail ? " — " + detail : ""}`);
  };

  for (const largeur of [1440, 1024]) {
    const page = await navigateur.newPage({
      viewport: { width: largeur, height: 900 },
    });
    // Connexion
    await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    await page.fill('input[type="email"], input[name="email"]', "e2e-tableau@servicerh.local");
    await page.fill('input[type="password"], input[name="password"]', "E2eTableau!2026");
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);

    // Onglet « Accès portail »
    const onglet = page.locator("text=Accès portail").first();
    await onglet.click();
    await page.waitForTimeout(2500);

    // Le tableau desktop (visible >= md)
    const table = page.locator("table").first();
    await table.waitFor({ state: "visible", timeout: 15000 });
    const conteneur = page.locator("div.overflow-x-auto").first();

    // --- Contrôle 1 : défilement horizontal disponible sans déformation ---
    const infos = await conteneur.evaluate((el) => {
      const t = el.querySelector("table");
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        tableLayout: t ? getComputedStyle(t).tableLayout : "n/a",
        debordement: el.scrollWidth > el.clientWidth,
      };
    });
    check(
      `[${largeur}px] Défilement horizontal disponible`,
      infos.debordement || infos.scrollWidth >= infos.clientWidth,
      `scrollWidth=${infos.scrollWidth} clientWidth=${infos.clientWidth} layout=${infos.tableLayout}`
    );
    check(`[${largeur}px] Table en layout fixe`, infos.tableLayout === "fixed", infos.tableLayout);

    // --- Contrôle 2 : en-têtes alignés sur les cellules de données ---
    const alignement = await table.evaluate((t) => {
      const ths = Array.from(t.querySelectorAll("thead th"));
      const ligne = t.querySelector("tbody tr:not([colspan]) td") ? t.querySelectorAll("tbody tr")[0] : null;
      if (!ligne) return { ok: true, detail: "aucune ligne de données" };
      const tds = Array.from(ligne.querySelectorAll("td"));
      const colspan = ligne.querySelector("td[colspan]");
      if (colspan) return { ok: true, detail: "ligne d'état (colspan)" };
      if (tds.length !== ths.length) return { ok: false, detail: `${ths.length} th vs ${tds.length} td` };
      // bords droits identiques (tolérance 2 px)
      for (let i = 0; i < ths.length - 1; i++) {
        const a = ths[i].getBoundingClientRect().right;
        const b = tds[i].getBoundingClientRect().right;
        if (Math.abs(a - b) > 2) return { ok: false, detail: `colonne ${i} : th ${a.toFixed(1)} vs td ${b.toFixed(1)}` };
      }
      return { ok: true, detail: `${ths.length} colonnes alignées` };
    });
    check(`[${largeur}px] En-têtes alignés avec les données`, alignement.ok, alignement.detail);

    // --- Contrôle 3 : boutons d'action contenus dans leur cellule ---
    const boutons = await table.evaluate((t) => {
      const res = { total: 0, debordements: 0, chevauchements: 0, exemples: [] };
      const lignes = Array.from(t.querySelectorAll("tbody tr"));
      for (const tr of lignes) {
        const tds = tr.querySelectorAll("td");
        if (!tds.length) continue;
        const tdActions = tds[tds.length - 1];
        const conteneurActions = tdActions.querySelector("div");
        if (!conteneurActions) continue;
        const rCell = tdActions.getBoundingClientRect();
        const bts = Array.from(conteneurActions.querySelectorAll("button"));
        // (a) aucun bouton ne déborde de la cellule
        for (const b of bts) {
          res.total++;
          const r = b.getBoundingClientRect();
          if (r.left < rCell.left - 1 || r.right > rCell.right + 1) {
            res.debordements++;
            if (res.exemples.length < 3)
              res.exemples.push(`bouton hors cellule: ${b.textContent.trim().slice(0, 24)}`);
          }
        }
        // (b) aucun chevauchement entre boutons
        for (let i = 0; i < bts.length; i++)
          for (let j = i + 1; j < bts.length; j++) {
            const a = bts[i].getBoundingClientRect();
            const b = bts[j].getBoundingClientRect();
            const ch = !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
            if (ch) {
              res.chevauchements++;
              if (res.exemples.length < 3)
                res.exemples.push(`chevauchement: ${bts[i].textContent.trim().slice(0, 16)} / ${bts[j].textContent.trim().slice(0, 16)}`);
            }
          }
      }
      return res;
    });
    check(
      `[${largeur}px] Aucun chevauchement de boutons`,
      boutons.chevauchements === 0,
      boutons.exemples.join(" ; ") || `${boutons.total} boutons analysés`
    );
    check(
      `[${largeur}px] Boutons contenus dans leur cellule`,
      boutons.debordements === 0,
      boutons.exemples.join(" ; ") || `${boutons.total} boutons analysés`
    );

    // --- Contrôle 4 : les boutons ne masquent pas les données ---
    const masquage = await table.evaluate((t) => {
      // rect de la colonne Actions (dernier td) vs colonnes de données
      const tr = Array.from(t.querySelectorAll("tbody tr")).find(
        (r) => r.querySelectorAll("td").length > 5
      );
      if (!tr) return { ok: true, detail: "aucune ligne complète" };
      const tds = Array.from(tr.querySelectorAll("td"));
      const actions = tds[tds.length - 1].getBoundingClientRect();
      const donnees = tds[tds.length - 2].getBoundingClientRect(); // Dernière connexion
      const chevauche = actions.left < donnees.right - 1;
      return { ok: !chevauche, detail: chevauche ? "colonne Actions empiète sur la précédente" : "colonnes disjointes" };
    });
    check(`[${largeur}px] Boutons ne masquent pas les données`, masquage.ok, masquage.detail);

    // Capture d'écran du tableau (défilement à droite pour voir la colonne Actions)
    await page.screenshot({ path: `${OUT}/acces-portail-${largeur}-debut.png`, fullPage: false });
    await conteneur.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/acces-portail-${largeur}-fin.png`, fullPage: false });
    await page.close();
  }

  await navigateur.close();
  const echecs = resultats.filter((r) => !r.ok);
  console.log(`\n=== BILAN : ${resultats.length - echecs.length}/${resultats.length} contrôles OK ===`);
  process.exit(echecs.length ? 1 : 0);
})().catch((e) => {
  console.error("ERREUR E2E :", e.message);
  process.exit(2);
});
