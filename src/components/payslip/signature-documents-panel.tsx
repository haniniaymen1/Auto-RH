"use client";
/**
 * ============================================================================
 *  NOUVEAU (Task 225, v0.2.115) — PANNEAU « SIGNATURE DES DOCUMENTS IMPORTÉS »
 * ============================================================================
 *
 *  DEMANDE : tous les fichiers importés (fiches de paie, réponses aux
 *  demandes, tout autre document pris en charge) doivent pouvoir être signés
 *  électroniquement avec le CERTIFICAT CHARGÉ :
 *
 *    1. les informations du certificat électronique chargé sont AFFICHÉES
 *       (ex. « Jean Dupont / MA SOCIETE SARL ») ;
 *    2. l'utilisateur téléverse N'IMPORTE QUEL fichier pris en charge ;
 *    3. le fichier est signé AUTOMATIQUEMENT avec le certificat chargé et
 *       sa clé privée associée (PDF → PAdES intégré ; autre format →
 *       PKCS#7/CMS détaché livré en ZIP original + signature) ;
 *    4. le fichier signé est GÉNÉRÉ puis TÉLÉCHARGÉ automatiquement ;
 *    5. les copies conservées restent re-téléchargeables (registre).
 *
 *  Aucune donnée sensible n'est affichée : le panneau consomme
 *  /api/signature-api/signer (GET état, POST signature, GET ?id&telecharger).
 * ============================================================================
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface CertificatInfos {
  fichier: string;
  format: string;
  sujet: string;
  titulaire: string;
  organisation: string;
  emetteur: string;
  serie: string;
  empreinte: string;
  valideDu: string | null;
  valideAu: string | null;
  importLe: string | null;
}

interface LigneRegistre {
  id: string;
  nomFichier: string;
  reference: string;
  nature: string;
  tailleOctets: number;
  signataire: string;
  verifStatut: string;
  verifMessage: string;
  signeLe: string;
  signePar: string;
  mode: string;
  environnement: string;
}

interface EtatModule {
  actif: boolean;
  mode: string;
  environnement: string;
  raison: string;
  certificatCharge: boolean;
  clePrete: boolean;
  certificat: CertificatInfos | null;
  avertissements: string[];
  registre: LigneRegistre[];
}

function taille(o: number): string {
  if (o >= 1_048_576) return (o / 1_048_576).toFixed(2) + " Mo";
  if (o >= 1024) return (o / 1024).toFixed(1) + " Ko";
  return o + " o";
}

function dateHeure(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dateCourte(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

const NATURE_LIBELLE: Record<string, string> = {
  PADES_PDF: "PDF signé (PAdES)",
  CMS_DETACHE_ZIP: "ZIP (original + signature PKCS#7)",
  CMS_DETACHE_SEUL: "Signature PKCS#7 (.p7s)",
};

export default function SignatureDocumentsPanel() {
  const [etat, setEtat] = useState<EtatModule | null>(null);
  const [charge, setCharge] = useState(true);
  const [erreurEtat, setErreurEtat] = useState("");
  const [fichier, setFichier] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [succes, setSucces] = useState("");
  const [echec, setEchec] = useState("");
  const [survol, setSurvol] = useState(false);
  const entree = useRef<HTMLInputElement | null>(null);

  const rafraichir = useCallback(async () => {
    setCharge(true);
    setErreurEtat("");
    try {
      const r = await fetch("/api/signature-api/signer", { cache: "no-store" });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        setErreurEtat(String(json.error || "Impossible de lire l'état du module de signature."));
        setEtat(null);
      } else {
        setEtat(json as unknown as EtatModule);
      }
    } catch {
      setErreurEtat("Communication impossible avec le module de signature.");
    } finally {
      setCharge(false);
    }
  }, []);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  const telechargerCopie = async (id: string) => {
    setEchec("");
    setSucces("");
    try {
      const r = await fetch("/api/signature-api/signer?id=" + encodeURIComponent(id) + "&telecharger=1");
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setEchec(String(j.error || "Téléchargement impossible."));
        return;
      }
      const dispo = r.headers.get("Content-Disposition") || "";
      const mUtf8 = /filename\*=UTF-8''([^;]+)/.exec(dispo);
      let nom = "document-signe";
      try {
        if (mUtf8) nom = decodeURIComponent(mUtf8[1]);
      } catch {
        nom = nom.replace(/[^\x20-\x7E]/g, "_");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setEchec("Téléchargement impossible (erreur réseau).");
    }
  };

  const signer = async () => {
    setSucces("");
    setEchec("");
    if (!fichier) {
      setEchec("Choisissez d'abord le fichier à signer.");
      return;
    }
    setEnCours(true);
    try {
      const form = new FormData();
      form.append("fichier", fichier);
      if (reference.trim()) form.append("reference", reference.trim());
      const r = await fetch("/api/signature-api/signer", { method: "POST", body: form });
      const typeRep = r.headers.get("Content-Type") || "";
      if (!r.ok || typeRep.includes("application/json")) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setEchec(String(j.error || "La signature a échoué."));
        return;
      }
      // Fichier signé : téléchargement immédiat
      const dispo = r.headers.get("Content-Disposition") || "";
      const mUtf8 = /filename\*=UTF-8''([^;]+)/.exec(dispo);
      let nom = "document-signe";
      if (mUtf8) {
        try {
          nom = decodeURIComponent(mUtf8[1]);
        } catch {
          nom = nom.replace(/[^\x20-\x7E]/g, "_");
        }
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      const nature = r.headers.get("X-Signature-Nature") || "";
      const verif = r.headers.get("X-Signature-Verif") || "";
      let cert = "";
      try {
        cert = decodeURIComponent(r.headers.get("X-Signature-Certificat") || "");
      } catch {
        cert = r.headers.get("X-Signature-Certificat") || "";
      }
      let msg = "";
      try {
        msg = decodeURIComponent(r.headers.get("X-Signature-Message") || "");
      } catch {
        msg = r.headers.get("X-Signature-Message") || "";
      }
      const deja = r.headers.get("X-Signature-Deja-Signe") === "1";
      setSucces(
        (nature === "PADES_PDF"
          ? "PDF signé (PAdES) : " + nom
          : nature === "CMS_DETACHE_ZIP"
            ? "Archive signée téléchargée : " + nom + " (original intact + signature PKCS#7 + mode d'emploi)"
            : "Signature PKCS#7 téléchargée : " + nom) +
        (verif === "VALIDE" ? " — intégrité vérifiée." : "") +
        (cert ? " — Signataire : " + cert : "") +
        (deja ? " (copie conservée servie — ce contenu était déjà signé)" : "") +
        (msg && !cert ? " " + msg : "")
      );
      setFichier(null);
      setReference("");
      if (entree.current) entree.current.value = "";
      await rafraichir();
    } catch {
      setEchec("La signature a échoué (erreur réseau ou serveur).");
    } finally {
      setEnCours(false);
    }
  };

  /* ---------------------------------------------------------------- */

  if (charge) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        Chargement du module de signature…
      </div>
    );
  }

  if (erreurEtat) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {erreurEtat}{" "}
        <button onClick={rafraichir} className="ml-2 underline hover:no-underline">
          Réessayer
        </button>
      </div>
    );
  }

  if (!etat) return null;
  const cert = etat.certificat;
  const pretASigner = etat.actif && etat.certificatCharge && etat.clePrete;

  return (
    <div className="space-y-4">
      {/* ---------- 1. Certificat électronique chargé ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">
            Certificat électronique chargé
          </h3>
          <div className="flex items-center gap-2">
            {cert ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                Certificat chargé
              </span>
            ) : (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                Aucun certificat
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
              Mode {etat.mode === "API_EXTERNE" ? "API externe" : "local"} · {etat.environnement}
            </span>
          </div>
        </div>
        {cert ? (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Titulaire</div>
              <div className="mt-0.5 font-medium text-slate-800">
                {cert.titulaire || cert.sujet || "—"}
              </div>
              {cert.organisation ? (
                <div className="text-xs text-slate-500">Organisation : {cert.organisation}</div>
              ) : null}
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Émetteur</div>
              <div className="mt-0.5 font-medium text-slate-800">{cert.emetteur || "—"}</div>
              <div className="text-xs text-slate-500">N° série : {cert.serie || "—"}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Validité</div>
              <div className="mt-0.5 font-medium text-slate-800">
                du {dateCourte(cert.valideDu)} au {dateCourte(cert.valideAu)}
              </div>
              <div className="text-xs text-slate-500">
                {cert.fichier} · {cert.format}
              </div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">
                Empreinte SHA-256
              </div>
              <div className="mt-0.5 break-all font-mono text-xs text-slate-700">
                {cert.empreinte ? cert.empreinte.slice(0, 32) + "…" : "—"}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-600">
            Aucun certificat électronique n&apos;est chargé. Le certificat (avec sa clé privée) est
            importé par le superadministrateur dans <strong>Paramètres → API de certification &amp; signature</strong>.
          </p>
        )}
        {etat.avertissements.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {etat.avertissements.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- 2. Signature d'un document téléversé ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-800">
          Signer un document avec le certificat chargé
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Déposez n&apos;importe quel fichier pris en charge par le système (fiche de paie, réponse à
          une demande, tout autre document). Un <strong>PDF</strong> reçoit une signature
          cryptographique <strong>PAdES intégrée</strong> ; tout autre format reçoit une signature
          PKCS#7/CMS détachée livrée en <strong>archive ZIP</strong> (original intact + signature + mode
          d&apos;emploi de vérification). Le fichier signé est généré puis téléchargé
          automatiquement, et conservé chiffré dans le registre ci-dessous.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setSurvol(true);
          }}
          onDragLeave={() => setSurvol(false)}
          onDrop={(e) => {
            e.preventDefault();
            setSurvol(false);
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setFichier(f);
              setEchec("");
              setSucces("");
            }
          }}
          className={
            "rounded-lg border-2 border-dashed p-6 text-center transition-colors " +
            (survol ? "border-emerald-400 bg-emerald-50" : "border-slate-300 bg-slate-50")
          }
        >
          <p className="text-sm text-slate-600">
            {fichier ? (
              <>
                <span className="font-medium text-slate-800">{fichier.name}</span>{" "}
                <span className="text-slate-500">({taille(fichier.size)})</span>
              </>
            ) : (
              <>Glissez-déposez le fichier ici, ou</>
            )}
          </p>
          <button
            type="button"
            onClick={() => entree.current?.click()}
            className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Parcourir…
          </button>
          <input
            ref={entree}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFichier(f);
              setEchec("");
              setSucces("");
            }}
          />
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Référence libre (facultatif) — ex. Fiche 03/2026, Réponse demande n° 12…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            maxLength={200}
          />
          <button
            type="button"
            onClick={signer}
            disabled={enCours || !fichier || !pretASigner}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enCours ? "Signature en cours…" : "Signer et télécharger"}
          </button>
        </div>
        {!pretASigner && (
          <p className="mt-2 text-xs text-amber-700">
            {etat.mode === "API_EXTERNE"
              ? "Mode API externe : seuls les PDF peuvent être délégués au service externe ; les autres formats exigent le mode local (Paramètres)."
              : "La signature exige un certificat actif AVEC sa clé privée (voir les avertissements ci-dessus)."}
          </p>
        )}
        {succes && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            {succes}
          </div>
        )}
        {echec && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            {echec}
          </div>
        )}
      </div>

      {/* ---------- 3. Registre des documents signés ---------- */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">
          Documents signés manuellement (20 derniers)
        </h3>
        {etat.registre.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun document signé manuellement pour l&apos;instant. Les fiches de paie et les réponses
            aux demandes restent signées automatiquement (Paramètres → périmètre).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Document</th>
                  <th className="py-2 pr-3">Nature</th>
                  <th className="py-2 pr-3">Vérification</th>
                  <th className="py-2 pr-3">Signé le</th>
                  <th className="py-2 pr-3">Par</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {etat.registre.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 align-top">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-800">{l.nomFichier}</div>
                      <div className="text-xs text-slate-500">
                        {taille(l.tailleOctets)}
                        {l.reference ? " · " + l.reference : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">
                      {NATURE_LIBELLE[l.nature] || l.nature}
                      <div className="text-xs text-slate-400">
                        {l.mode === "API_EXTERNE" ? "API externe" : "local"} · {l.environnement}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      {l.verifStatut === "VALIDE" ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                          Intègre
                        </span>
                      ) : l.verifStatut === "INVALIDE" ? (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
                          Invalide
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          Non vérifié
                        </span>
                      )}
                      {l.verifMessage ? (
                        <div className="mt-1 max-w-xs text-xs text-slate-500">{l.verifMessage}</div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{dateHeure(l.signeLe)}</td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{l.signePar || "—"}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => telechargerCopie(l.id)}
                        className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        Télécharger la copie signée
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
