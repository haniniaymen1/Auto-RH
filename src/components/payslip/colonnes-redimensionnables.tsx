"use client";

/**
 * ============================================================================
 * (NOUVEAU — demande utilisateur) REDIMENSIONNEMENT MANUEL DES COLONNES
 * ============================================================================
 *
 * Ajoute à un tableau une POIGNÉE entre chaque colonne : l'utilisateur peut
 * agrandir / réduire la largeur de chaque colonne en glissant la poignée
 * (séparateur) située sur le bord droit de chaque cellule d'en-tête.
 *
 * - Fonctionne avec les tableaux shadcn/ui (<Table> → vrai <table>) ET avec
 *   les <table> bruts : le hook prend la RÉFÉRENCE DU CONTENEUR et cherche
 *   le <table> intérieur.
 * - Les largeurs sont PERSISTÉES par tableau (localStorage, clé
 *   « auto-rh-colonnes-<cle> ») : retrouvées au rechargement de la page.
 * - Double-clic sur une poignée : réinitialise TOUTES les colonnes du
 *   tableau à leur largeur naturelle.
 * - Disposition passée en « fixed » (largeurs exactement respectées) après
 *   mesure des largeurs naturelles : le rendu initial est inchangé.
 *
 * Usage :
 *   const ref = useRef<HTMLDivElement>(null);
 *   utiliserColonnesRedimensionnables(ref, "demandes", items.length);
 *   <div ref={ref}> <Table> … </Table> </div>
 * ============================================================================
 */

import { useEffect, type RefObject } from "react";

const LARGEUR_MIN = 56; // px — une colonne ne peut pas disparaître
const LARGEUR_MAX = 1200; // px — garde-fou

// (NOUVEAU — correctif affichage « Accès portail ») largeur MINIMALE PAR
// COLONNE : chaque <th> peut déclarer un attribut data-col-min="N" (px).
// Cette valeur sert de PLANCHER infranchissable : ni les largeurs restaurées
// depuis localStorage, ni le glissement manuel ne peuvent réduire la colonne
// en dessous — garantit qu'un bouton / une étiquette ne déborde JAMAIS de sa
// colonne (sinon il recouvre les colonnes voisines).
function lireMinColonne(th: HTMLElement): number {
  const n = Number(th.dataset.colMin);
  return Number.isFinite(n) && n > 0 ? n : LARGEUR_MIN;
}

function cleStockage(cle: string): string {
  return `auto-rh-colonnes-${cle}`;
}

export function utiliserColonnesRedimensionnables(
  refConteneur: RefObject<HTMLElement | null>,
  cle: string,
  // Dépendance optionnelle : nombre de lignes / état de chargement — le
  // tableau est équipé APRÈS le rendu des données (thead complet).
  dependance?: unknown
) {
  useEffect(() => {
    const conteneur = refConteneur.current;
    if (!conteneur) return;
    const table = conteneur.querySelector("table");
    if (!table) return;
    const tetes = Array.from(table.querySelectorAll<HTMLElement>("thead th"));
    if (!tetes.length) return;

    // ---- 1) largeurs : sauvegardées (localStorage) sinon naturelles ----
    // (MODIFIÉ — correctif affichage) les largeurs restaurées sont bornées
    // en dessous par le plancher data-col-min de CHAQUE colonne : des
    // largeurs mémorisées par une version antérieure du tableau (avant
    // l'ajout d'un bouton par exemple) ne peuvent plus écraser une colonne
    // au point de faire déborder son contenu.
    const mins = tetes.map((th) => lireMinColonne(th));
    let largeurs: number[] = [];
    try {
      const brut = window.localStorage.getItem(cleStockage(cle));
      if (brut) {
        const lu = JSON.parse(brut);
        if (Array.isArray(lu) && lu.length === tetes.length) {
          largeurs = lu.map(
            (n, i) => Math.max(mins[i], Math.min(LARGEUR_MAX, Number(n) || 0))
          );
        }
      }
    } catch {
      largeurs = [];
    }
    if (largeurs.length !== tetes.length) {
      largeurs = tetes.map((th, i) => Math.max(mins[i], th.offsetWidth || 120));
    }

    // Le tableau passe en layout FIXE : les largeurs posées sont EXACTEMENT
    // respectées (sinon le navigateur les traiterait comme de simples hints).
    table.style.tableLayout = "fixed";
    tetes.forEach((th, i) => {
      th.style.width = `${largeurs[i]}px`;
    });

    // ---- 1 bis) (v0.2.192) colonne COLLANTE à droite — opt-in ----
    // Un <th> porteur de l'attribut data-col-sticky="right" reste COLLÉ au
    // bord droit du conteneur scrollable : les boutons d'action restent
    // utilisables sans faire défiler le tableau vers la gauche/droite.
    // Le hook respecte cette position (au lieu d'imposer « relative ») et
    // lui redonne le plan right:0 après chaque équipement ; les AUTRES
    // tableaux (sans l'attribut) ne changent PAS de comportement.
    tetes.forEach((th) => {
      if (th.dataset.colSticky === "right") {
        th.style.position = "sticky";
        th.style.right = "0px";
        th.style.zIndex = th.style.zIndex || "10";
      }
    });

    // ---- 2) injection des poignées (idempotent : une seule par th) ----
    tetes.forEach((th, index) => {
      // (v0.2.192) ne PAS écraser la position collante opt-in du th
      if (th.dataset.colSticky !== "right") {
        th.style.position = "relative";
      }
      if (th.querySelector("span[data-poignee-colonne]")) return;
      const poignee = document.createElement("span");
      poignee.setAttribute("data-poignee-colonne", String(index));
      poignee.style.cssText =
        "position:absolute;top:0;right:0;width:9px;height:100%;" +
        "cursor:col-resize;user-select:none;z-index:20;" +
        "display:flex;align-items:center;justify-content:flex-end;padding:0;";
      // barre visible au survol / pendant le glissement
      const barre = document.createElement("span");
      barre.style.cssText =
        "width:3px;height:60%;border-radius:2px;background:transparent;transition:background .15s;";
      poignee.appendChild(barre);
      poignee.addEventListener("mouseenter", () => {
        barre.style.background = "#10b981"; // vert émeraude AutoRH (v0.2.199)
      });
      poignee.addEventListener("mouseleave", () => {
        barre.style.background = "transparent";
      });

      poignee.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const xDebut = ev.clientX;
        const largeurDebut = th.offsetWidth || largeurs[index];
        barre.style.background = "#10b981";
        th.style.cursor = "col-resize";
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const deplacer = (m: PointerEvent) => {
          // (MODIFIÉ — correctif affichage) le glissement respecte le
          // plancher data-col-min de la colonne : impossible de réduire une
          // colonne au point que son contenu (boutons, e-mails…) déborde.
          const w = Math.max(
            mins[index],
            Math.min(LARGEUR_MAX, largeurDebut + (m.clientX - xDebut))
          );
          th.style.width = `${w}px`;
          largeurs[index] = w;
        };
        const arreter = () => {
          document.removeEventListener("pointermove", deplacer);
          document.removeEventListener("pointerup", arreter);
          barre.style.background = "transparent";
          th.style.cursor = "";
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          // persistance des largeurs de TOUTES les colonnes
          try {
            const actuelles = Array.from(
              table.querySelectorAll<HTMLElement>("thead th")
            ).map((t) => t.offsetWidth || 120);
            window.localStorage.setItem(cleStockage(cle), JSON.stringify(actuelles));
          } catch {
            // stockage indisponible : redimensionnement simplement non persisté
          }
        };
        document.addEventListener("pointermove", deplacer);
        document.addEventListener("pointerup", arreter);
      });

      // double-clic : réinitialisation des largeurs du tableau
      poignee.addEventListener("dblclick", () => {
        try {
          window.localStorage.removeItem(cleStockage(cle));
        } catch {
          // silencieux
        }
        tetes.forEach((t) => {
          t.style.width = "";
        });
        table.style.tableLayout = "";
        tetes.forEach((t, i) => {
          largeurs[i] = Math.max(mins[i], t.offsetWidth || 120);
          t.style.width = `${largeurs[i]}px`;
        });
        table.style.tableLayout = "fixed";
      });

      th.appendChild(poignee);
    });

    // pas de nettoyage destructeur : les poignées sont marquées et
    // réutilisées au passage suivant (idempotence) ; le tableau est
    // recréé par React lors des changements de structure.
  }, [refConteneur, cle, dependance]); // eslint-disable-line react-hooks/exhaustive-deps
}
