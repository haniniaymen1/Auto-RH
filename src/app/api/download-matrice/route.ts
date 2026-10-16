import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "@/lib/storage-dir";

export const runtime = "nodejs";

/**
 * GET /api/download-matrice
 * Téléchargement PUBLIC de la matrice détaillée des rôles de tous les
 * utilisateurs (classeur Excel .xlsx — Task 193).
 *
 * Même logique que /api/download-scripts et /api/download-readme : route
 * volontairement exclue du middleware d'authentification (cf.
 * src/middleware.ts) afin de pouvoir récupérer le classeur directement
 * depuis le navigateur. Le fichier ne contient aucun secret : c'est une
 * documentation des droits par rôle, auditée depuis le code source.
 *
 * Recherche : <racine>/download puis <cwd>/download ; le fichier servi est
 * le plus récent parmi AutoRH-Matrice-roles*.xlsx (les éditions
 * versionnées -vX.Y.Z.xlsx sont privilégiées sur les non suffixées).
 */
export async function GET(_request: NextRequest) {
  const roots = [...new Set([getProjectRoot(), process.cwd()])];
  for (const root of roots) {
    const dir = path.join(root, "download");
    try {
      const entries = await fs.readdir(dir);
      const xlsxs = entries
        .filter((name) => /^(AutoRH|Auto-RH)-Matrice-roles.*\.xlsx$/i.test(name))
        .sort((a, b) => {
          // éditions versionnées d'abord, puis par nom décroissant
          const va = /-v\d/i.test(a) ? 1 : 0;
          const vb = /-v\d/i.test(b) ? 1 : 0;
          if (va !== vb) return vb - va;
          return b.localeCompare(a);
        });
      if (xlsxs.length === 0) continue;
      const xlsxPath = path.join(dir, xlsxs[0]);
      const data = await fs.readFile(xlsxPath);
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Length": String(data.length),
          "Content-Disposition": `attachment; filename="${xlsxs[0]}"`,
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
        "Classeur de la matrice des rôles introuvable sur le serveur. En déploiement local, utilisez le fichier AutoRH-Matrice-roles-utilisateurs-v0.2.95.xlsx du dossier download/ de l'archive ZIP livrée.",
    },
    { status: 404 }
  );
}
