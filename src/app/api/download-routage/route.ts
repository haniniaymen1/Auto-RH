import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "@/lib/storage-dir";

export const runtime = "nodejs";

/**
 * GET /api/download-routage
 * Téléchargement PUBLIC de la map de configuration des e-mails des demandes
 * du portail employé (classeur Excel .xlsx — Task 197, v0.2.94) : routage
 * par type (attestations, congé, autorisation de sortie, parrainage),
 * champs de configuration, replis, copies automatiques, confirmations,
 * journal et mécanique commune.
 *
 * Même logique que /api/download-matrice : route volontairement exclue du
 * middleware d'authentification (cf. src/middleware.ts) afin de pouvoir
 * récupérer le classeur directement depuis le navigateur. Le fichier ne
 * contient aucun secret : c'est une documentation de configuration,
 * auditée depuis le code source.
 *
 * Recherche : <racine>/download puis <cwd>/download ; le fichier servi est
 * le plus récent parmi AutoRH-Map-routage*.xlsx (les éditions
 * versionnées -vX.Y.Z.xlsx sont privilégiées sur les non suffixées).
 */
export async function GET(_request: NextRequest) {
  const roots = [...new Set([getProjectRoot(), process.cwd()])];
  for (const root of roots) {
    const dir = path.join(root, "download");
    try {
      const entries = await fs.readdir(dir);
      const xlsxs = entries
        .filter((name) => /^(AutoRH|Auto-RH)-Map-routage.*\.xlsx$/i.test(name))
        .sort((a, b) => {
          // (MODIFIÉ v0.2.106) éditions versionnées d'abord, puis comparaison
          // NUMÉRIQUE des segments de version (v0.2.106 > v0.2.94 — l'ordre
          // lexicographique plaçait 94 après 106).
          const va = /-v\d/i.test(a) ? 1 : 0;
          const vb = /-v\d/i.test(b) ? 1 : 0;
          if (va !== vb) return vb - va;
          const nums = (s: string) => (s.match(/(\d+)/g) || []).map(Number);
          const na = nums(a), nb = nums(b);
          for (let i = 0; i < Math.max(na.length, nb.length); i++) {
            const d = (nb[i] || 0) - (na[i] || 0);
            if (d) return d;
          }
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
        "Classeur de la map de routage e-mail introuvable sur le serveur. En déploiement local, utilisez le fichier AutoRH-Map-routage-emails-demandes-v0.2.106.xlsx du dossier download/ de l'archive ZIP livrée.",
    },
    { status: 404 }
  );
}
