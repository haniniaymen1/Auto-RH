import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getProjectRoot } from "@/lib/storage-dir";

// ============================================================================
// NOUVEAU (Task 198, v0.2.153) — TÉLÉCHARGEMENT PUBLIC DE L'ARCHIVE LÉGÈRE
// ============================================================================
// Jumelle de api/download-scripts (archive complète, publique depuis la
// Task 145) : sert download/auto-rh-scripts-site-web-leger.zip — la même
// archive que le ZIP léger livré, sans les documents de formation ni les
// anciennes éditions du README. Publique (exclusion middleware), lecture
// disque à chaque requête, jamais mise en cache.
// ============================================================================

export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  const candidates = [
    path.join(getProjectRoot(), "download", "auto-rh-scripts-site-web-leger.zip"),
    path.join(process.cwd(), "download", "auto-rh-scripts-site-web-leger.zip"),
  ];
  for (const zipPath of [...new Set(candidates)]) {
    try {
      const data = await fs.readFile(zipPath);
      return new NextResponse(new Uint8Array(data), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(data.length),
          "Content-Disposition": 'attachment; filename="auto-rh-scripts-site-web-leger.zip"',
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
        "Archive légère introuvable sur le serveur (download/auto-rh-scripts-site-web-leger.zip). Utilisez l'archive complète /api/download-scripts ou rechargez plus tard.",
    },
    { status: 404 },
  );
}
