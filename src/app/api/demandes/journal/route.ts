/**
 * ============================================================================
 *  NOUVEAU (Task 116) — JOURNAL D'ENVOI DES E-MAILS (lecture)
 * ============================================================================
 *  GET /api/demandes/journal → 300 dernières lignes de
 *  <racine>/logs/journal-emails.log (le journal écrit par
 *  journaliserEnvoi() pour TOUTES les familles d'e-mails : envoi-acces,
 *  envoi-test, demande-creation, demande-statut), de la plus récente à la
 *  plus ancienne. Chaque ligne : horodatage, action, destinataire,
 *  expéditeur, serveur (hôte/port/SSL), succès, référence du message,
 *  réponse SMTP brute, code + message d'erreur le cas échéant, référence de
 *  la demande. AUCUN secret n'y figure (jamais journalisé).
 *
 *  Accès : IT / SUPERADMIN (outil de diagnostic de la configuration — le RH
 *  consulte les demandes, pas l'infrastructure d'envoi). Permet au cahier des
 *  charges : consulter les logs d'envoi, identifier les e-mails envoyés avec
 *  succès ou en erreur, afficher le message d'erreur SMTP en cas d'échec.
 * ============================================================================
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { estSuperadmin, forbidden, getSessionUser, motDePasseExpire, unauthorized } from "@/lib/auth";
import { getProjectRoot } from "@/lib/storage-dir";

export const runtime = "nodejs";

const MAX_LIGNES = 300;

export async function GET() {
  const session = await getSessionUser();
  if (!session) return unauthorized();
  if (session.mustChangePassword) return motDePasseExpire();
  if (session.role !== "IT" && !estSuperadmin(session)) return forbidden();
  try {
    const fichier = path.join(getProjectRoot(), "logs", "journal-emails.log");
    if (!fs.existsSync(fichier)) {
      return NextResponse.json({
        items: [],
        note: "Aucun envoi journalisé pour le moment (fichier logs/journal-emails.log absent).",
      });
    }
    // Lecture des DERNIÈRES lignes seulement (le fichier peut grossir) :
    // on lit tout puis on garde la queue — volume maîtrisé (lignes JSON courtes).
    const brut = fs.readFileSync(fichier, "utf8");
    const lignes = brut.split("\n").filter((l) => l.trim().length > 0);
    const queue = lignes.slice(-MAX_LIGNES).reverse();
    const items: Record<string, unknown>[] = [];
    for (const l of queue) {
      try {
        items.push(JSON.parse(l));
      } catch {
        // ligne corrompue : ignorée (jamais bloquant)
      }
    }
    return NextResponse.json({ items, totalFichier: lignes.length });
  } catch (error) {
    console.error("[DEMANDES] Journal:", error);
    return NextResponse.json({ error: "Erreur serveur." }, { status: 500 });
  }
}
