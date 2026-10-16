/**
 * ============================================================================
 *  NOUVEAU (Task 180) — PAGE PUBLIQUE DE VÉRIFICATION « FICHE EN LIGNE »
 * ============================================================================
 *
 *  GET /verification/fiche/[id]?t=<jeton>
 *
 *  Destination du QR code « Fiche en ligne » apposé sur les fiches de paie
 *  (mode QR « FICHE » de la rubrique Signature électronique & QR code) :
 *  la personne qui scanne le QR code imprimé arrive ICI, SANS CONNEXION, et
 *  la page atteste l'authenticité du document :
 *   - jeton VALIDE  → carte verte « Document authentique » + détails de la
 *     fiche (employé, CIN, période, net à payer, importée le, référence,
 *     empreinte de contrôle) + boutons d'ouverture / téléchargement du PDF
 *     tamponné servi par l'API publique /api/payslips/qr/[id]/file ;
 *   - jeton INVALIDE ou fiche inconnue → carte rouge « Document non
 *     reconnu » : aucun détail n'est dévoilé (valeur anti-fraude : un
 *     document falsifié ou un lien altéré est détecté d'un coup d'œil).
 *
 *  SÉCURITÉ :
 *   - la page est publique (exemptée du middleware, cf. src/middleware.ts)
 *     MAIS protégée par le JETON HMAC-SHA256 signé propre à la fiche
 *     (jetonFicheValide() — comparaison en temps constant) : sans le jeton,
 *     ou avec un jeton altéré, AUCUNE information n'est révélée ;
 *   - le jeton n'ouvre QUE la fiche indiquée (aucun listage possible) ;
 *   - page explicitement exclue de l'indexation (robots noindex).
 * ============================================================================
 */
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { dateFr, empreinteFiche, jetonFicheValide, type InfosFiche } from "@/lib/stamp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vérification de fiche de paie — AutoRH",
  robots: { index: false, follow: false },
};

type Verdict = "AUTHENTIQUE" | "JETON_INVALIDE" | "INTROUVABLE" | "REQUETE_INVALIDE";

export default async function VerificationFichePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const jeton = typeof sp.t === "string" ? sp.t : null;

  // ---- Validation (aucune fuite d'information en cas d'échec) ----
  let verdict: Verdict = "AUTHENTIQUE";
  let fiche: (InfosFiche & { fileName: string }) | null = null;

  const identifiant = String(id ?? "").trim();
  if (!identifiant || identifiant.length > 64 || !/^[A-Za-z0-9_-]+$/.test(identifiant)) {
    verdict = "REQUETE_INVALIDE";
  } else {
    const record = await db.payslip.findUnique({ where: { id: identifiant } });
    if (!record) {
      // Fiche supprimée / inconnue : le QR imprimé d'une fiche retirée du
      // serveur ne révèle plus RIEN (révocation mécanique).
      verdict = "INTROUVABLE";
    } else if (!jetonFicheValide(identifiant, jeton)) {
      verdict = "JETON_INVALIDE";
    } else {
      fiche = {
        id: record.id,
        employeeName: record.employeeName,
        cin: record.cin,
        period: record.period,
        netSalary: record.netSalary,
        uploadedAt: record.uploadedAt,
        fileName: record.fileName,
      };
    }
  }

  const fichierUrl =
    verdict === "AUTHENTIQUE" && fiche
      ? `/api/payslips/qr/${fiche.id}/file?t=${encodeURIComponent(jeton ?? "")}`
      : null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-lg">
        {/* ---- Bandeau AutoRH ---- */}
        <div className="mb-4 text-center">
          <h1 className="text-lg font-semibold tracking-tight text-slate-800">
            AutoRH — Vérification de fiche de paie
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            Cette page est ouverte par le code QR apposé sur le document vérifié.
          </p>
        </div>

        {verdict === "AUTHENTIQUE" && fiche ? (
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
                  Document authentique
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-emerald-700">
                  Cette fiche de paie est bien enregistrée sur le serveur AutoRH de
                  l&apos;établissement. Les détails ci-dessous proviennent directement de
                  l&apos;enregistrement officiel.
                </p>
              </div>
            </div>

            <dl className="divide-y divide-slate-100 px-5 py-2 text-sm">
              {[
                ["Employé", String(fiche.employeeName ?? "").trim() || "—"],
                ["CIN", String(fiche.cin ?? "").trim() || "—"],
                ["Période", String(fiche.period ?? "").trim() || "—"],
                ["Net à payer", String(fiche.netSalary ?? "").trim() || "—"],
                ["Importée le", dateFr(fiche.uploadedAt)],
                ["Référence du document", fiche.id],
                ["Empreinte de contrôle", empreinteFiche(fiche)],
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
              {fichierUrl && (
                <>
                  <a
                    href={fichierUrl}
                    className="block w-full rounded-md bg-emerald-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                  >
                    Ouvrir la fiche de paie
                  </a>
                  <a
                    href={fichierUrl + "&download=1"}
                    className="block w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    Télécharger le document
                  </a>
                </>
              )}
              <p className="pt-1 text-center text-[11px] leading-relaxed text-slate-400">
                Lien propre à ce document (jeton signé) : il n&apos;ouvre aucune autre fiche
                et cesse de fonctionner si la fiche est retirée du serveur.
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
                <p className="text-base font-semibold text-red-800">Document non reconnu</p>
                <p className="mt-0.5 text-xs leading-relaxed text-red-700">
                  {verdict === "INTROUVABLE"
                    ? "Le code QR ne correspond à aucune fiche de paie enregistrée sur ce serveur (document retiré ou référence inconnue)."
                    : "Le lien contenu dans le code QR est incomplet ou altéré — la vérification est refusée."}{" "}
                  Aucun détail du document ne peut être affiché. En cas de doute, contactez le
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
