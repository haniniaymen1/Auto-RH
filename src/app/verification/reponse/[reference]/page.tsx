/**
 * ============================================================================
 *  NOUVEAU (v0.2.88) — PAGE PUBLIQUE DE VÉRIFICATION « RÉPONSE EN LIGNE »
 * ============================================================================
 *
 *  GET /verification/reponse/[reference]?t=<jeton>
 *
 *  Destination du QR code apposé sur les DOCUMENTS DE RÉPONSE du service RH
 *  (demande utilisateur : « Les réponses aux demandes doivent également être
 *  accessibles via le QR Code contient url comme les qr de fiche de paie
 *  principale du portail ») : la personne qui scanne le QR code imprimé sur
 *  la réponse arrive ICI, SANS CONNEXION, et la page atteste l'authenticité :
 *   - jeton VALIDE  → carte verte « Réponse authentique » + détails de la
 *     demande (référence, type, employé, statut, traitée le) + boutons
 *     d'ouverture / téléchargement de CHAQUE document de réponse (servis par
 *     l'API publique /api/demandes/qr/[reference]/file?t=…&doc=…) ;
 *   - jeton INVALIDE ou demande inconnue → carte rouge « Réponse non
 *     reconnue » : aucun détail n'est dévoilé (valeur anti-fraude : un
 *     document falsifié ou un lien altéré est détecté d'un coup d'œil).
 *
 *  SÉCURITÉ :
 *   - la page est publique (exemptée du middleware, cf. src/middleware.ts —
 *     la famille /verification est déjà exclue pour le QR Fiche en ligne)
 *     MAIS protégée par le JETON HMAC-SHA256 signé propre à la RÉFÉRENCE de
 *     la demande (jetonReponseValide() — comparaison en temps constant) ;
 *   - le jeton n'ouvre QUE cette demande (aucun listage possible) ;
 *   - supprimer la demande révoque mécaniquement le lien (INTROUVABLE) ;
 *   - page explicitement exclue de l'indexation (robots noindex).
 * ============================================================================
 */
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { dateFr, jetonReponseValide } from "@/lib/stamp";
import { dechiffrerChamp } from "@/lib/db-crypto";
import { libelleType, masquerCin, nomEmployeDepuisFiches } from "@/lib/demandes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vérification d'une réponse — AutoRH",
  robots: { index: false, follow: false },
};

type Verdict = "AUTHENTIQUE" | "JETON_INVALIDE" | "INTROUVABLE" | "REQUETE_INVALIDE";

/** Taille lisible (cohérente avec les listes de l'application). */
function tailleLisible(n: number): string {
  const v = Number(n || 0);
  if (!isFinite(v) || v <= 0) return "0 Ko";
  if (v >= 1048576) return (v / 1048576).toFixed(1).replace(".", ",") + " Mo";
  return Math.max(1, Math.round(v / 1024)) + " Ko";
}

const STATUTS_LIBELLES: Record<string, string> = {
  EN_ATTENTE: "En attente",
  ACCEPTEE: "Acceptée",
  REFUSEE: "Refusée",
  INFORMATION_REQUISE: "Information requise",
};

export default async function VerificationReponsePage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reference } = await params;
  const sp = await searchParams;
  const jeton = typeof sp.t === "string" ? sp.t : null;

  // ---- Validation (aucune fuite d'information en cas d'échec) ----
  let verdict: Verdict = "AUTHENTIQUE";
  let demande: {
    reference: string;
    typeLibelle: string;
    employe: string;
    statutLibelle: string;
    traitePar: string;
    traiteLe: string;
    creeLe: string;
  } | null = null;
  let documents: { id: string; nomFichier: string; tailleLisible: string; recuLe: string }[] = [];

  const ref = String(reference ?? "").trim();
  // Référence DEM-AAAA-NNNNN (même discipline que l'API fichier : bornes +
  // liste blanche de caractères — rien d'autre n'est révélé en cas d'échec).
  if (!ref || ref.length > 40 || !/^[A-Za-z0-9_-]+$/.test(ref)) {
    verdict = "REQUETE_INVALIDE";
  } else {
    const record = await db.demandeAdministrative.findUnique({
      where: { reference: ref },
      include: { documents: { orderBy: { recuLe: "asc" } } },
    });
    if (!record) {
      // Demande supprimée / inconnue : le QR imprimé d'une réponse retirée
      // du serveur ne révèle plus RIEN (révocation mécanique).
      verdict = "INTROUVABLE";
    } else if (!jetonReponseValide(ref, jeton)) {
      verdict = "JETON_INVALIDE";
    } else {
      // Nom de l'employé : champ nom/prénom de la demande, sinon les fiches
      // de paie (même résolution que le reste de l'application).
      let donneesForm: Record<string, unknown> = {};
      try {
        donneesForm = JSON.parse(dechiffrerChamp(record.donnees) || "{}");
      } catch {
        donneesForm = {};
      }
      const nomFormulaire =
        [donneesForm["prenom"], donneesForm["nom"]]
          .filter(Boolean)
          .join(" ")
          .trim() || String(donneesForm["nomParrain"] ?? "").trim();
      const employe =
        nomFormulaire || (await nomEmployeDepuisFiches(record.cin)) || "";
      demande = {
        reference: record.reference,
        typeLibelle: libelleType(record.type),
        employe,
        statutLibelle: STATUTS_LIBELLES[record.statut] ?? record.statut,
        traitePar: String(record.traitePar ?? "").trim(),
        traiteLe: record.traiteLe ? dateFr(record.traiteLe) : "",
        creeLe: dateFr(record.createdAt),
      };
      documents = record.documents.map((doc) => ({
        id: doc.id,
        nomFichier: doc.nomFichier,
        tailleLisible: tailleLisible(doc.taille),
        recuLe: dateFr(doc.recuLe),
      }));
    }
  }

  const baseUrl =
    verdict === "AUTHENTIQUE" && demande
      ? `/api/demandes/qr/${encodeURIComponent(demande.reference)}/file?t=${encodeURIComponent(jeton ?? "")}`
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg">
        {/* ---- Bandeau AutoRH ---- */}
        <div className="mb-4 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-slate-800">
            AutoRH — Vérification d&apos;une réponse administrative
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Cette page est ouverte par le code QR apposé sur le document vérifié.
          </p>
        </div>

        {verdict === "AUTHENTIQUE" && demande ? (
          <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-4">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <div>
                <p className="text-base font-semibold text-emerald-800">
                  Réponse authentique
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-emerald-700">
                  Cette réponse administrative est bien enregistrée sur le serveur
                  AutoRH de l&apos;établissement. Les détails ci-dessous proviennent
                  directement de l&apos;enregistrement officiel.
                </p>
              </div>
            </div>

            <dl className="divide-y divide-slate-100 px-5 py-2 text-sm">
              {[
                ["Référence", demande.reference],
                ["Type de demande", demande.typeLibelle],
                ["Employé", String(demande.employe ?? "").trim() || "—"],
                ["Statut", demande.statutLibelle],
                ...(demande.traitePar
                  ? ([["Traitée par", demande.traitePar]] as [string, string][])
                  : []),
                ...(demande.traiteLe
                  ? ([["Traitée le", demande.traiteLe]] as [string, string][])
                  : []),
                ["Demande créée le", demande.creeLe],
              ].map(([libelle, valeur]) => (
                <div key={libelle} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {libelle}
                  </dt>
                  <dd className="break-all text-right font-medium text-slate-800">{valeur}</dd>
                </div>
              ))}
            </dl>

            <div className="space-y-2 border-t border-slate-100 bg-slate-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Documents de la réponse ({documents.length})
              </p>
              {documents.length === 0 && (
                <p className="text-xs text-slate-500">
                  Aucun document joint à cette réponse sur le serveur.
                </p>
              )}
              {documents.map((doc, index) => (
                <div
                  key={doc.id}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2.5"
                >
                  <p className="break-all text-xs font-medium text-slate-800">
                    {index + 1}. {doc.nomFichier}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {doc.tailleLisible} — reçu le {doc.recuLe}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`${baseUrl}&doc=${encodeURIComponent(doc.id)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-center text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                    >
                      Ouvrir
                    </a>
                    <a
                      href={`${baseUrl}&doc=${encodeURIComponent(doc.id)}&download=1`}
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
                    >
                      Télécharger
                    </a>
                  </div>
                </div>
              ))}
              <p className="pt-1 text-center text-[11px] leading-relaxed text-slate-400">
                Lien propre à cette réponse (jeton signé) : il n&apos;ouvre aucune autre
                demande et cesse de fonctionner si la demande est retirée du serveur.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
            <div className="flex items-start gap-3 border-b border-red-100 bg-red-50 px-5 py-4">
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="mt-0.5 h-8 w-8 shrink-0 text-red-600"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <div>
                <p className="text-base font-semibold text-red-800">Réponse non reconnue</p>
                <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                  {verdict === "INTROUVABLE"
                    ? "Le code QR ne correspond à aucune réponse enregistrée sur ce serveur (document retiré ou référence inconnue)."
                    : "Le lien contenu dans le code QR est incomplet ou altéré — la vérification est refusée."}{" "}
                  Aucun détail de la réponse ne peut être affiché. En cas de doute, contactez le
                  service des ressources humaines de votre établissement.
                </p>
              </div>
            </div>
            <div className="px-5 py-4 text-xs text-slate-500">
              Vérification effectuée sur le serveur AutoRH — le contrôle est refusé sans
              révéler aucun détail du document.
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-[11px] text-slate-400">
          <Link href="/login" className="underline decoration-slate-300 hover:text-slate-500">
            Accès du personnel (connexion requise)
          </Link>
        </p>
      </div>
    </main>
  );
}
