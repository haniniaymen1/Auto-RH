import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "@/lib/storage-dir";

export const runtime = "nodejs";

/**
 * GET /api/download-scripts
 * Téléchargement PUBLIC de l'archive des scripts du site (zip).
 * Route volontairement exclue du middleware d'authentification
 * afin de pouvoir récupérer l'archive directement depuis le navigateur.
 * L'archive ne contient aucun secret (le .env est généré au démarrage).
 *
 * CORRECTIF (Task 198, v0.2.153) : l'archive livrée s'appelle désormais
 * auto-rh-scripts-site-web.zip (copie générique de la dernière version) —
 * l'ancien nom servicerh-scripts-site-web.zip reste accepté en repli.
 * L'archive est recherchée dans <racine>/download PUIS dans
 * <répertoire courant>/download (le build standalone force un autre cwd).
 */
export async function GET(_request: NextRequest) {
  const noms = ["auto-rh-scripts-site-web.zip", "servicerh-scripts-site-web.zip"];
  // (CORRECTIF v0.2.201) : `const candidats = []` inférait `never[]` (TypeScript
  // ne pouvait pas déduire le type depuis les `push` ultérieurs). On type
  // explicitement `string[]` — comportement runtime identique.
  const candidats: string[] = [];
  for (const nom of noms) {
    candidats.push(path.join(getProjectRoot(), "download", nom));
    candidats.push(path.join(process.cwd(), "download", nom));
  }
  for (const zipPath of [...new Set(candidats)]) {
    try {
      const data = await fs.readFile(zipPath);
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(data.length),
          "Content-Disposition": 'attachment; filename="auto-rh-scripts-site-web.zip"',
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // candidat suivant
    }
  }
  return NextResponse.json(
    {
      error:
        "Archive introuvable sur le serveur. En déploiement local, utilisez directement le fichier auto-rh-scripts-site-web.zip qui vous a été livré.",
    },
    { status: 404 }
  );
}
