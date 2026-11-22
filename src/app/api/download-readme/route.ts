import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "@/lib/storage-dir";

export const runtime = "nodejs";

/** (v0.2.100) Extrait la version numérique d'un nom versionné
 * (…-v0.2.100.pdf → [0, 2, 100]) pour un tri chronologique EXACT —
 * l'ordre alphabétique seul fait passer « v0.2.98 » devant « v0.2.100 »
 * (passage aux versions à 3 segments chiffrés). */
function versionDe(nom: string): number[] | null {
  const m = nom.match(/-v(\d+)\.(\d+)\.(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Comparaison numérique décroissante de deux versions [X, Y, Z]. */
function compareVersionsDesc(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const d = (b[i] || 0) - (a[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * GET /api/download-readme
 * Téléchargement PUBLIC du README technique au format PDF (édition
 * enrichie : tous les changements + procédure de chiffrement et de
 * déchiffrement).
 *
 * Même logique que /api/download-scripts : route volontairement exclue
 * du middleware d'authentification (cf. src/middleware.ts) afin de
 * pouvoir récupérer le PDF directement depuis le navigateur. Le PDF ne
 * contient aucun secret (documentation technique uniquement).
 *
 * Recherche : <racine>/download puis <cwd>/download ; le fichier servi
 * est le plus récent parmi servicerh-readme-technique*.pdf (les éditions
 * versionnées servicerh-readme-technique-vX.Y.Z.pdf sont privilégiées
 * sur l'édition non suffixée embarquée dans l'archive ZIP).
 * Les éditions RÉDUITES (…-reduit…pdf) sont EXCLUES : elles sont
 * distribuées comme fichiers séparés, l'API sert l'édition complète
 * (conforme aux mentions « /api/download-readme — édition COMPLÈTE »
 * des couvertures des deux éditions).
 */
export async function GET(_request: NextRequest) {
  const roots = [...new Set([getProjectRoot(), process.cwd()])];
  for (const root of roots) {
    const dir = path.join(root, "download");
    try {
      const entries = await fs.readdir(dir);
      const pdfs = entries
        .filter((name) => /^(servicerh|service-rh)-readme-technique.*\.pdf$/i.test(name))
        .filter((name) => !/-reduit/i.test(name)) // éditions réduites : fichiers séparés, jamais servies ici
        .sort((a, b) => {
          // éditions versionnées d'abord, puis version numérique DÉCROISSANTE
          // (v0.2.100 > v0.2.99 > v0.2.98 — tri numérique, PAS alphabétique)
          const va = /-v\d/.test(a) ? 1 : 0;
          const vb = /-v\d/.test(b) ? 1 : 0;
          if (va !== vb) return vb - va;
          const na = versionDe(a);
          const nb = versionDe(b);
          if (na && nb) {
            const c = compareVersionsDesc(na, nb);
            if (c) return c;
          }
          return b.localeCompare(a);
        });
      if (pdfs.length === 0) continue;
      const pdfPath = path.join(dir, pdfs[0]);
      const data = await fs.readFile(pdfPath);
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": String(data.length),
          "Content-Disposition": `attachment; filename="${pdfs[0]}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // répertoire suivant
    }
  }
  return NextResponse.json(
    {
      error:
        "PDF du README technique introuvable sur le serveur. En déploiement local, utilisez le fichier servicerh-readme-technique.pdf à la racine de l'archive ZIP livrée.",
    },
    { status: 404 }
  );
}
