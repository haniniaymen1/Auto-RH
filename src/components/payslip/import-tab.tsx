"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  CheckCircle2,
  XCircle,
  UploadCloud,
  FileText,
  Info,
  RotateCcw,
  Loader2,
  IdCard,
  Infinity as InfinityIcon,
  StopCircle,
  // NOUVEAU (v0.2.50) : alerte des incohérences nom / prénom détectées
  AlertTriangle,
} from "lucide-react";
import type { UploadResultItem, UploadResponse, FiabiliteCin } from "@/lib/types";
import { maskCin } from "@/lib/utils";
// NOUVEAU (Task 109) : classification d'authenticité d'un CIN affiché + format
// des taux (module isomorphe — aucune dépendance serveur).
import { classerCin, formaterTaux } from "@/lib/cin-validation";

interface ImportTabProps {
  onImported: () => void;
}

/** Extensions acceptées à l'import :
 *  - PDF (comportement historique) ;
 *  - PNG / JPG — lus directement par OCR (plus besoin de
 *    convertir une image en PDF avant l'import) ;
 *  - NOUVEAU (ajouté sans retirer les précédents) : ZIP (archive de
 *    plusieurs fiches), XLSX/XLS (classeurs Excel), DOCX (Word). */
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".zip",
  ".xlsx",
  ".xlsm",
  ".xls",
  ".docx",
];

function isAllowedFile(f: File): boolean {
  const n = f.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((e) => n.endsWith(e));
}

/** Nombre de fichiers envoyés par requête : permet un nombre TOTAL de fichiers
 * illimité sans saturer la mémoire (les lots sont traités successivement). */
const BATCH_SIZE = 5;
/** Au-delà de ce seuil, un fichier part SEUL dans sa propre requête
 * → taille de fichier illimitée sans faire exploser la mémoire. */
const SOLO_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20 Mo

/** Découpe une liste de fichiers en lots :
 *  - fichiers "lourds" (> 20 Mo) : envoyés un par un ;
 *  - fichiers "légers" : groupés par 5.
 *  Le nombre total de fichiers et la taille totale restent ILLIMITÉS. */
function buildBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let light: File[] = [];
  for (const f of files) {
    if (f.size > SOLO_SIZE_THRESHOLD) {
      if (light.length > 0) {
        batches.push(light);
        light = [];
      }
      batches.push([f]);
    } else {
      light.push(f);
      if (light.length >= BATCH_SIZE) {
        batches.push(light);
        light = [];
      }
    }
  }
  if (light.length > 0) batches.push(light);
  return batches;
}

/** Onglet d'import des fiches de paie PDF exportées depuis Sage.
 * Nombre de fichiers illimité + taille de fichier illimitée :
 * les fichiers sont découpés en lots et envoyés séquentiellement. */
export function ImportTab({ onImported }: ImportTabProps) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResultItem[]>([]);
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  // NOUVEAU (Task 109) : vérification des CIN cumulée sur TOUS les lots de
  // l'import (l'interface envoie plusieurs requêtes successives) — l'API
  // renvoie la vérification de chaque lot, on additionne les compteurs et on
  // recalcule les taux à l'affichage (demande utilisateur : « taux de
  // fiabilité et taux d'erreur après l'importation »).
  const [fiab, setFiab] = useState<
    { total: number; vrais: number; faux: number; nonDetectes: number } | null
  >(null);
  // NOUVEAU (v0.2.50) : nombre de fiches porteuses d'au moins une anomalie
  // nom / prénom, cumulé sur TOUS les lots de l'import (détection
  // automatique des incohérences — bandeau d'avertissement + alertes par
  // fichier dans les résultats).
  const [anomaliesNoms, setAnomaliesNoms] = useState(0);

  const uploadAll = useCallback(
    async (fileList: FileList | File[]) => {
      const all = Array.from(fileList);
      if (all.length === 0) return;

      const invalid = all.filter((f) => !isAllowedFile(f));
      if (invalid.length > 0) {
        toast({
          title: "Format refusé",
          description: `${invalid.length} fichier(s) ignoré(s) : seuls les PDF, PNG, JPG, ZIP, XLSX/XLS et DOCX sont acceptés.`,
          variant: "destructive",
        });
      }
      const pdfs = all.filter(isAllowedFile);
      if (pdfs.length === 0) return;

      cancelRef.current = false;
      setUploading(true);
      setResults([]);
      setFiab(null);
      setAnomaliesNoms(0);
      setTotal(pdfs.length);
      setProcessed(0);

      const allResults: UploadResultItem[] = [];
      const batches = buildBatches(pdfs);

      try {
        // Lots successifs → nombre de fichiers et taille ILLIMITÉS
        for (let b = 0; b < batches.length; b++) {
          if (cancelRef.current) break;

          const batch = batches[b];
          const formData = new FormData();
          batch.forEach((f) => formData.append("files", f));

          try {
            const res = await fetch("/api/payslips/upload", {
              method: "POST",
              body: formData,
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({}));
              throw new Error(err.error || `Erreur ${res.status}`);
            }

            const data: UploadResponse = await res.json();
            allResults.push(...data.results);
            // (Task 109) cumul de la vérification des CIN du lot terminé.
            if (data.fiabilite) {
              const f = data.fiabilite;
              setFiab((prev) =>
                prev
                  ? {
                      total: prev.total + f.total,
                      vrais: prev.vrais + f.vrais,
                      faux: prev.faux + f.faux,
                      nonDetectes: prev.nonDetectes + f.nonDetectes,
                    }
                  : {
                      total: f.total,
                      vrais: f.vrais,
                      faux: f.faux,
                      nonDetectes: f.nonDetectes,
                    }
              );
            }
            // (v0.2.50) cumul des fiches avec incohérence nom / prénom.
            if (data.anomaliesNoms) {
              setAnomaliesNoms((prev) => prev + data.anomaliesNoms!);
            }
          } catch (batchError) {
            // Un lot en échec n'interrompt pas l'import des suivants
            batch.forEach((f) =>
              allResults.push({
                fileName: f.name,
                status: "ERROR",
                message:
                  batchError instanceof Error
                    ? batchError.message
                    : "Échec de l'envoi du lot.",
              })
            );
          } finally {
            setProcessed((prev) => Math.min(prev + batch.length, pdfs.length));
            setResults([...allResults]);
          }
        }

        const success = allResults.filter((r) => r.status === "SUCCESS").length;
        const failed = allResults.length - success;
        onImported();

        toast({
          title: cancelRef.current ? "Import interrompu" : "Import terminé",
          description: `${success} fiche(s) importée(s), ${failed} échec(s) sur ${allResults.length} traité(s).`,
        });
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [toast, onImported]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (!uploading && e.dataTransfer.files) {
      uploadAll(e.dataTransfer.files);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const successCount = results.filter((r) => r.status === "SUCCESS").length;
  const failedCount = results.filter((r) => r.status === "ERROR").length;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Zone de dépôt */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UploadCloud className="h-5 w-5 text-emerald-600" />
            Importer les fiches de paie depuis Sage
          </CardTitle>
          <CardDescription>
            Exportez les bulletins de paie depuis Sage (PDF), puis déposez-les ici.
            Le système extrait automatiquement le contenu, détecte le CIN, le nom de
            l&apos;employé, la période et le net à payer.
            Les fiches <strong>sans texte</strong> (images, scans, conversions
            PNG → PDF) sont lues automatiquement par <strong>OCR</strong>.
            NOUVEAU : importez aussi une <strong>archive ZIP</strong> contenant
            plusieurs fiches (PDF, PNG/JPG, Excel, Word — tout mélangé), des{" "}
            <strong>classeurs Excel</strong> (1 fiche par feuille) ou des{" "}
            <strong>documents Word</strong> — les fiches multiples sont
            détectées et enregistrées automatiquement.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge variant="outline" className="border-emerald-600 text-emerald-700 gap-1">
              <InfinityIcon className="h-3.5 w-3.5" />
              Nombre de fichiers illimité
            </Badge>
            <Badge variant="outline" className="border-emerald-600 text-emerald-700 gap-1">
              <InfinityIcon className="h-3.5 w-3.5" />
              Taille de fichier illimitée
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div
            role="button"
            tabIndex={0}
            aria-label="Zone de dépôt des fichiers PDF, PNG, JPG, ZIP, XLSX et DOCX"
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !uploading) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDrop={handleDrop}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            className={`
              flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
              px-6 py-12 text-center cursor-pointer transition-colors
              ${dragActive ? "border-emerald-600 bg-emerald-50" : "border-neutral-300 hover:border-emerald-500 hover:bg-emerald-50/40"}
              ${uploading ? "pointer-events-none opacity-70" : ""}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.zip,.xlsx,.xlsm,.xls,.docx,application/pdf,image/png,image/jpeg,application/zip"
              multiple
              autoComplete="off"
              className="hidden"
              onChange={(e) => e.target.files && uploadAll(e.target.files)}
            />
            {uploading ? (
              <>
                <Loader2 className="h-10 w-10 text-emerald-600 animate-spin" />
                <p className="font-medium">
                  Traitement en cours — {processed} / {total} fichier(s)
                </p>
                <p className="text-sm text-muted-foreground">
                  Extraction du texte / OCR et détection du CIN…
                </p>
              </>
            ) : (
              <>
                <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
                  <UploadCloud className="h-7 w-7 text-emerald-700" />
                </div>
                <div>
                  <p className="font-medium">
                    Glissez-déposez vos fiches de paie ici (PDF, PNG, JPG, ZIP, XLSX, DOCX)
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    ou cliquez pour parcourir vos fichiers — import multiple illimité
                  </p>
                </div>
                <Badge variant="outline" className="mt-1">
                  PDF · PNG · JPG · ZIP · XLSX · DOCX — OCR intégré
                </Badge>
              </>
            )}
          </div>

          {/* Progression pendant l'upload */}
          {uploading && (
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">
                  {processed} / {total} fichier(s) traité(s)
                </span>
                <span className="text-muted-foreground tabular-nums">{percent}%</span>
              </div>
              <Progress value={percent} className="h-2.5" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  Les lots sont envoyés successivement : aucun blocage, quelle que
                  soit la quantité.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    cancelRef.current = true;
                  }}
                >
                  <StopCircle className="h-4 w-4 mr-1.5" />
                  Interrompre
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Résultats d'import */}
      {results.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Résultat de l&apos;import</CardTitle>
              <CardDescription>
                {successCount} réussi{successCount > 1 ? "s" : ""} · {failedCount}{" "}
                échec{failedCount > 1 ? "s" : ""}
                {total > processed && ` · ${total - processed} en attente`}
              </CardDescription>
            </div>
            {!uploading && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResults([]);
                  setFiab(null);
                  setAnomaliesNoms(0);
                }}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Nouvel import
              </Button>
            )}
          </CardHeader>
          {/* NOUVEAU (Task 109) : taux de fiabilité / d'erreur calculés après
              l'importation en vérifiant les CIN (vrais / faux / non détectés). */}
          {fiab && fiab.total > 0 && (
            <FiabilitePanel f={fiab} />
          )}
          {/* NOUVEAU (v0.2.50) : bandeau de signalement des incohérences
              nom / prénom détectées automatiquement à l'importation. */}
          {anomaliesNoms > 0 && (
            <CardContent className="pb-0">
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-1">
                <p className="text-sm font-medium text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {anomaliesNoms} fiche{anomaliesNoms > 1 ? "s" : ""} avec un
                  nom / prénom à vérifier
                </p>
                <p className="text-xs text-amber-800/90">
                  Le nom de ces fiches diffère des autres fiches du même CIN
                  (ordre inversé, faute de frappe probable, nom différent) ou
                  présente un format suspect (nom manquant, chiffres…). Le
                  détail est affiché sous chaque fichier concerné et au
                  survol de la pastille « Nom » de l&apos;onglet Toutes les
                  fiches.
                </p>
              </div>
            </CardContent>
          )}
          <CardContent className="space-y-2.5 max-h-96 overflow-y-auto">
            {results.map((r, idx) => (
              <ResultRow key={`${r.fileName}-${idx}`} result={r} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Aide */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Comment récupérer les fiches de paie depuis Sage ?</AlertTitle>
        <AlertDescription className="text-sm space-y-2 mt-2">
          <p>
            <strong>1.</strong> Dans Sage Paie, ouvrez le module « Éditions » puis
            générez les bulletins de paie en PDF (un fichier par employé, ou un
            export global).
          </p>
          <p>
            <strong>2.</strong> Déposez les PDF ici : le contenu de chaque bulletin est
            indexé automatiquement (CIN, nom, période, net à payer). Vous pouvez
            déposer autant de fichiers que nécessaire, sans limite de taille.
          </p>
          <p>
            <strong>3.</strong> Recherchez ensuite n&apos;importe quelle fiche par
            numéro de CIN depuis l&apos;onglet « Recherche CIN ».
          </p>
          <p className="text-muted-foreground">
            Remarque : les fiches <strong>sans texte extractible</strong> (images,
            photos, scans, conversions PNG → PDF) sont désormais lues
            automatiquement par OCR (reconnaissance de caractères, français) — vous
            pouvez aussi déposer directement vos fichiers <strong>PNG / JPG</strong>{" "}
            sans les convertir en PDF.
          </p>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/** NOUVEAU (Task 109) : panneau de vérification des CIN après importation —
 * nombre de CIN corrects (vrais) et incorrects (faux), fiches sans CIN, et
 * taux de fiabilité / d'erreur calculés sur le total des fiches importées. */
function FiabilitePanel({
  f,
}: {
  f: { total: number; vrais: number; faux: number; nonDetectes: number };
}) {
  const tauxFiabilite = f.total > 0 ? (f.vrais / f.total) * 100 : 0;
  const tauxErreur = f.total > 0 ? (f.faux / f.total) * 100 : 0;
  return (
    <CardContent className="pb-0">
      <div className="rounded-lg border p-3 bg-neutral-50 space-y-2">
        <p className="text-sm font-medium flex items-center gap-2">
          <IdCard className="h-4 w-4 text-emerald-700 shrink-0" />
          Vérification des CIN — fiabilité{" "}
          <span className="text-emerald-700">{formaterTaux(tauxFiabilite)}</span>
          {" · "}erreur{" "}
          <span className={f.faux > 0 ? "text-red-600" : "text-muted-foreground"}>
            {formaterTaux(tauxErreur)}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            {f.vrais} CIN correct{f.vrais > 1 ? "s" : ""} (vrai{f.vrais > 1 ? "s" : ""})
          </Badge>
          <Badge className={f.faux > 0 ? "bg-red-600 text-white hover:bg-red-600" : "bg-neutral-400 text-white hover:bg-neutral-400"}>
            {f.faux} incorrect{f.faux > 1 ? "s" : ""} (faux{f.faux > 1 ? "x" : ""})
          </Badge>
          <Badge variant="outline">
            {f.nonDetectes} sans CIN détecté{f.nonDetectes > 1 ? "s" : ""}
          </Badge>
          <span className="text-muted-foreground">sur {f.total} fiche{f.total > 1 ? "s" : ""} importée{f.total > 1 ? "s" : ""}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Un CIN est « vrai » quand son format est un numéro de carte d&apos;identité
          tunisienne authentique (8 chiffres, ou 9 biométrique). Les CIN « faux »
          (lettres, longueur anormale, zéros) et les fiches sans CIN méritent une
          vérification du bulletin d&apos;origine.
        </p>
      </div>
    </CardContent>
  );
}

function ResultRow({ result }: { result: UploadResultItem }) {
  const success = result.status === "SUCCESS";
  // NOUVEAU (Task 109) : badge CIN coloré selon l'authenticité du format —
  // vert = vrai (format tunisien authentique), rouge = faux (hors format).
  const cinAuthentique = success && result.cin ? classerCin(result.cin) === "valide" : null;
  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 bg-white">
      {success ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          {result.fileName}
        </p>
        <p className={`text-xs mt-0.5 ${success ? "text-muted-foreground" : "text-red-600"}`}>
          {result.message}
        </p>
        {/* Task 16 : mentions nominative et salariale des résultats d'import masquées
            (demande administrateur). La détection continue en arrière-plan,
            seul l'affichage change. */}
        {success && result.period && (
          <p className="text-xs text-muted-foreground mt-1">
            <span>Période : {result.period}</span>
          </p>
        )}
        {/* NOUVEAU (v0.2.50) : signalement des erreurs / incohérences nom &
            prénom détectées automatiquement pour CE fichier (alertes amber). */}
        {result.anomalies && result.anomalies.length > 0 && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 space-y-1">
            {result.anomalies.map((a, i) => (
              <p key={i} className="text-xs text-amber-800 flex items-start gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span className="whitespace-pre-line">{a}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      {result.cin && (
        <Badge
          variant="outline"
          className={`font-mono shrink-0 ${
            cinAuthentique === false
              ? "border-red-600 text-red-600" // (Task 109) CIN « faux » : format non authentique
              : "border-emerald-600 text-emerald-700"
          }`}
        >
          <IdCard className="h-3 w-3 mr-1" />
          {/* Task 17 : CIN masqué — seuls les 3 derniers caractères sont visibles */}
          {maskCin(result.cin)}
        </Badge>
      )}
    </div>
  );
}
