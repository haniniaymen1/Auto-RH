"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ExternalLink, FileText } from "lucide-react";
// MODIFIÉ (Task 16) : affichage du nom de l'employé retiré de l'en-tête
// de la visionneuse (demande administrateur). Le CIN et la période restent.
import type { PayslipListItem } from "@/lib/types";
import { maskCin } from "@/lib/utils";

interface PdfDialogProps {
  payslip: PayslipListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Fiches servies en IMAGE (PNG/JPG) — lues avec <img> au lieu de l'iframe :
 *  en cas de fichier tronqué/corrompu, onError récupère le message EXPLICITE
 *  renvoyé par le serveur (Task 15bis-2) et l'affiche dans un panneau clair
 *  au lieu de l'icône d'image cassée muette de l'iframe. */
function estImageParNom(nom: string): boolean {
  return /\.(png|jpe?g)$/i.test(nom || "");
}

/** Visionneuse PDF/image intégrée + infos de la fiche. */
export function PdfDialog({ payslip, open, onOpenChange }: PdfDialogProps) {
  const [erreurImage, setErreurImage] = useState<string | null>(null);

  // Nouvelle fiche sélectionnée → réinitialisation du diagnostic.
  useEffect(() => {
    setErreurImage(null);
  }, [payslip?.id]);

  if (!payslip) return null;

  const fileUrl = `/api/payslips/${payslip.id}/file`;
  const image = estImageParNom(payslip.fileName);

  /** Échec de décodage <img> : le serveur renvoie désormais un message
   *  explicite (422/404/500) — on le récupère pour l'afficher tel quel. */
  async function surErreurImage() {
    let message =
      "Le fichier image n'a pas pu être chargé. Ouvrez-le dans un nouvel onglet pour afficher la cause exacte renvoyée par le serveur.";
    try {
      const r = await fetch(fileUrl);
      const j = await r.json().catch(() => null);
      if (j && typeof j.error === "string") message = j.error;
    } catch {
      /* message par défaut conservé */
    }
    setErreurImage(message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b bg-muted/40 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileText className="h-5 w-5 shrink-0 text-emerald-600" />
            <span className="truncate">{payslip.fileName}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm mt-1">
            {/* Task 16 : nom de l'employé masqué */}
            {payslip.period && <span>Période : {payslip.period}</span>}
            {payslip.cin && (
              <Badge variant="outline" className="border-emerald-600 text-emerald-700 font-mono">
                {/* Task 17 : CIN masqué — seuls les 3 derniers caractères sont visibles */}
                CIN : {maskCin(payslip.cin)}
              </Badge>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-neutral-200 overflow-hidden">
          {image ? (
            erreurImage ? (
              /* (Task 15bis-2) panneau de diagnostic explicite — remplace
                 l'icône d'image cassée muette de l'iframe. */
              <div className="w-full h-full flex items-center justify-center p-6 overflow-auto">
                <div className="max-w-xl w-full rounded-lg border border-amber-300 bg-amber-50 p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-6 w-6 shrink-0 text-amber-600 mt-0.5" />
                    <div className="space-y-2">
                      <p className="font-semibold text-amber-900">
                        Aperçu indisponible : problème avec le fichier de cette fiche
                      </p>
                      <p className="text-sm text-amber-900 whitespace-pre-wrap">
                        {erreurImage}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Fiche image : <img> adaptée à la largeur, défilement vertical
                 si l'image est haute (bulletins portrait). */
              <div className="w-full h-full overflow-auto flex items-start justify-center p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl}
                  alt={`Fiche de paie ${payslip.fileName}`}
                  className="max-w-full h-auto shadow-md bg-white"
                  onError={surErreurImage}
                />
              </div>
            )
          ) : (
            <iframe
              src={fileUrl}
              title={`Fiche de paie ${payslip.fileName}`}
              className="w-full h-full border-0"
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t bg-muted/40 shrink-0">
          <p className="text-xs text-muted-foreground hidden sm:block">
            Si le document ne s&apos;affiche pas, ouvrez-le dans un nouvel onglet.
            <br />
            {/* (Task 15bis-2) un problème de fichier (vide, tronqué, corrompu,
                clé de chiffrement) affiche DÉSORMAIS la cause exacte dans la
                visionneuse — plus d'icône d'image cassée sans explication. */}
            Un problème de fichier ? La cause exacte s&apos;affiche ici même :
            fichier vide, tronqué, corrompu ou clé de chiffrement modifiée.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href={fileUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" />
              Nouvel onglet
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
