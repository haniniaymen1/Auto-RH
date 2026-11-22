"use client";

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
// NOUVEAU (Task 29) : case à cocher pour la SÉLECTION MULTIPLE
import { Checkbox } from "@/components/ui/checkbox";
import {
  Eye,
  Download,
  Trash2,
  FileText,
  Search,
  IdCard,
  CalendarDays,
  Inbox,
  ScanSearch,
  X,
  // NOUVEAU (Task 99) : contrôles de pagination serveur
  ChevronLeft,
  ChevronRight,
  Globe2,
} from "lucide-react";
// MODIFIÉ (Task 16) : affichage des colonnes « Employé » et « Net à payer » retiré
// (tableau desktop + cartes mobiles) à la demande de l'administrateur.
// La détection et le filtrage par nom restent fonctionnels en arrière-plan.
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import type { PayslipListItem, PaginationMeta } from "@/lib/types";
// (NOUVEAU — demande utilisateur) poignées de redimensionnement des colonnes
import { utiliserColonnesRedimensionnables } from "@/components/payslip/colonnes-redimensionnables";
import { maskCin } from "@/lib/utils";

interface AllTabProps {
  payslips: PayslipListItem[];
  loading: boolean;
  onView: (p: PayslipListItem) => void;
  onDeleted: () => void;
  // NOUVEAU (Task 99) : PAGINATION SERVEUR — la liste reçoit une seule page
  // (100 fiches) et ses métadonnées ; la navigation demande les pages au
  // serveur. La recherche CIN s'effectue AUSSI côté serveur sur TOUTES les
  // fiches (onServerSearch), pas seulement sur la page affichée.
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onServerSearch: (cin: string) => void;
}

/** Onglet listant les fiches de paie importées, UNE PAGE À LA FOIS (serveur). */
export function AllTab({
  payslips,
  loading,
  onView,
  onDeleted,
  meta,
  onPageChange,
  onServerSearch,
}: AllTabProps) {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  // (NOUVEAU — demande utilisateur, point 9) redimensionnement manuel des colonnes
  const refTableauFiches = useRef<HTMLDivElement>(null);
  utiliserColonnesRedimensionnables(refTableauFiches, "fiches-paie", payslips.length + (loading ? 1 : 0));
  // NOUVEAU (Task 99) : saisie « Aller à la page ».
  const [pageVoulue, setPageVoulue] = useState("");
  const [toDelete, setToDelete] = useState<PayslipListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  // NOUVEAU (Task 29) : SÉLECTION MULTIPLE — identifiants cochés, dialogue
  // de confirmation groupé et état d'envoi de la suppression groupée.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  /** NOUVEAU : relance la détection CIN + période sur toutes les fiches
   * déjà importées (utile après une mise à jour des formats reconnus). */
  const handleRedetect = async () => {
    setRedetecting(true);
    try {
      const res = await fetch("/api/payslips/redetect", { method: "POST" });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      toast({
        title: "Redétection terminée",
        description: `${data.updated}/${data.total} fiche(s) analysée(s) — ${data.cinFound} CIN détecté(s), ${data.periodFound} période(s) détectée(s).`,
      });
      onDeleted(); // rafraîchit la liste et les statistiques
    } catch {
      toast({
        title: "Échec de la redétection",
        description: "Une erreur est survenue. Réessayez.",
        variant: "destructive",
      });
    } finally {
      setRedetecting(false);
    }
  };

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return payslips;
    // (Task 99) le filtre local ne porte que sur LA PAGE AFFICHÉE — pour
    // chercher un CIN dans TOUTES les fiches, utiliser la recherche serveur
    // (bouton ci-dessous ou onglet « Recherche CIN »).
    return payslips.filter(
      (p) =>
        p.fileName.toLowerCase().includes(f) ||
        (p.employeeName ?? "").toLowerCase().includes(f) ||
        (p.period ?? "").toLowerCase().includes(f) ||
        (p.cin ?? "").toLowerCase().includes(f)
    );
  }, [payslips, filter]);

  /** NOUVEAU (Task 99) : navigation « Aller à la page » bornée. */
  const allerALaPage = () => {
    const n = parseInt(pageVoulue, 10);
    if (!Number.isFinite(n)) return;
    onPageChange(Math.min(Math.max(1, n), meta.totalPages));
    setPageVoulue("");
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/payslips/${toDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      toast({
        title: "Fiche supprimée",
        description: `« ${toDelete.fileName} » a été supprimée définitivement.`,
      });
      onDeleted();
    } catch {
      toast({
        title: "Échec de la suppression",
        description: "Une erreur est survenue. Réessayez.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  /* ---------------------------------------------------------------- */
  /* NOUVEAU (Task 29) : SUPPRESSION MULTIPLE                          */
  /* ---------------------------------------------------------------- */

  /** Coche / décoche UNE fiche. */
  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  /** Coche / décoche TOUTES les fiches FILTRÉES (le filtre local s'applique). */
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someFilteredSelected = filtered.some((p) => selected.has(p.id));
  const toggleAllFiltered = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filtered) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  };

  /** Suppression GROUPÉE : une seule requête, résultat détaillé. */
  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/payslips/delete-many", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected) }),
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      const parts: string[] = [`${data.deleted} fiche(s) supprimée(s)`];
      if (data.missing > 0) parts.push(`${data.missing} introuvable(s)`);
      if (data.failed > 0) parts.push(`${data.failed} échec(s)`);
      toast({
        title:
          data.failed > 0 ? "Suppression partiellement réussie" : "Suppression multiple terminée",
        description: parts.join(" — ") + ".",
        variant: data.failed > 0 ? "destructive" : undefined,
      });
      setSelected(new Set());
      onDeleted(); // rafraîchit la liste et les statistiques
    } catch {
      toast({
        title: "Échec de la suppression multiple",
        description: "Une erreur est survenue. Réessayez.",
        variant: "destructive",
      });
    } finally {
      setBulkDeleting(false);
      setBulkConfirmOpen(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="animate-pulse h-16" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {/* (Task 99) le TOTAL vient du serveur (toutes les fiches), pas de
              la page affichée ; l'état du filtre local est précisé. */}
          <span className="font-semibold text-foreground">
            {meta.total.toLocaleString("fr-FR")}
          </span>{" "}
          fiche{meta.total > 1 ? "s" : ""} de paie au total
          {meta.totalPages > 1 && (
            <>
              {" "}- page {meta.page} sur {meta.totalPages.toLocaleString("fr-FR")}
            </>
          )}
          {filter.trim() &&
            ` (filtre local : ${filtered.length} sur cette page)`}
          {/* NOUVEAU (Task 29) : compteur de sélection courante */}
          {selected.size > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {selected.size} sélectionnée{selected.size > 1 ? "s" : ""}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {/* NOUVEAU (Task 29) : bouton de SUPPRESSION MULTIPLE (visible si
              au moins une fiche est cochée) + bouton d'annulation */}
          {selected.size > 0 && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelected(new Set())}
                disabled={bulkDeleting}
                title="Annuler la sélection"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
                <span className="hidden sm:inline">Annuler</span>
                <span className="sr-only">Annuler la sélection</span>
              </Button>
              <Button
                size="sm"
                onClick={() => setBulkConfirmOpen(true)}
                disabled={bulkDeleting}
                title="Supprimer toutes les fiches cochées"
                className="shrink-0 bg-red-600 hover:bg-red-700 text-white"
              >
                <Trash2 className={`h-4 w-4 ${bulkDeleting ? "animate-pulse" : ""}`} />
                <span className="hidden sm:inline">
                  {bulkDeleting ? "Suppression…" : `Supprimer la sélection (${selected.size})`}
                </span>
                <span className="sr-only">Supprimer la sélection</span>
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRedetect}
            disabled={redetecting}
            title="Relancer la détection du CIN, de la période et du nom sur toutes les fiches déjà importées"
            className="shrink-0"
          >
            <ScanSearch className={`h-4 w-4 ${redetecting ? "animate-pulse" : ""}`} />
            <span className="hidden sm:inline">
              {redetecting ? "Redétection…" : "Redétecter CIN & périodes"}
            </span>
            <span className="sr-only">Redétecter CIN et périodes</span>
          </Button>
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Filtrer CETTE page : fichier, période…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
              aria-label="Filtrer la page affichée"
            />
          </div>
        </div>
      </div>

      {/* NOUVEAU (Task 99) : RECHERCHE CIN CÔTÉ SERVEUR — porte sur TOUTES
          les fiches (la base peut compter 240 000 fiches), pas seulement la
          page affichée ; le résultat s'affiche dans l'onglet « Recherche CIN ». */}
      {filter.trim().length >= 3 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
          <p className="text-xs text-emerald-900 flex-1">
            Le filtre ci-dessus ne porte que sur la page affichée. Pour chercher
            « <strong className="font-mono">{filter.trim()}</strong> » dans
            <strong> toutes les {meta.total.toLocaleString("fr-FR")} fiches</strong> (serveur) :
          </p>
          <Button
            size="sm"
            onClick={() => onServerSearch(filter.trim())}
            className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
            title="Rechercher ce CIN côté serveur, sur toutes les fiches"
          >
            <Globe2 className="h-4 w-4 mr-1.5" />
            Rechercher dans toutes les fiches
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center gap-3">
            <Inbox className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {meta.total === 0
                ? "Aucune fiche de paie importée. Rendez-vous dans l'onglet « Importer »."
                : filter.trim()
                  ? "Aucune fiche de cette page ne correspond à ce filtre local — utilisez la recherche serveur ci-dessus pour chercher dans TOUTES les fiches."
                  : "Aucune fiche sur cette page."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Tableau — desktop */}
          {/* (MODIFIÉ — demande utilisateur, point 9) poignées de redimensionnement */}
          <div ref={refTableauFiches} className="hidden md:block rounded-xl border overflow-hidden bg-white">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  {/* NOUVEAU (Task 29) : colonne de SÉLECTION MULTIPLE */}
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        allFilteredSelected
                          ? true
                          : someFilteredSelected
                            ? "indeterminate"
                            : false
                      }
                      onCheckedChange={(v) => toggleAllFiltered(v === true)}
                      aria-label="Tout sélectionner"
                      title="Tout sélectionner (fiches filtrées)"
                    />
                  </TableHead>
                  <TableHead>Fichier</TableHead>
                  {/* Task 16 : colonne « Employé » masquée */}
                  <TableHead>Période</TableHead>
                  <TableHead>CIN</TableHead>
                  {/* NOUVEAU (v0.2.107 — demande utilisateur, point 1) : le
                      matricule est récupéré automatiquement depuis la fiche
                      de paie elle-même (extraction à l'import). */}
                  <TableHead>Matricule</TableHead>
                  {/* Task 16 : colonne « Net à payer » masquée */}
                  <TableHead>Importé le</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow
                    key={p.id}
                    className={
                      selected.has(p.id) ? "bg-emerald-50/70 hover:bg-emerald-50" : "hover:bg-emerald-50/40"
                    }
                  >
                    {/* NOUVEAU (Task 29) : case à cocher de la ligne */}
                    <TableCell>
                      <Checkbox
                        checked={selected.has(p.id)}
                        onCheckedChange={(v) => toggleOne(p.id, v === true)}
                        aria-label={`Sélectionner ${p.fileName}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <button
                          onClick={() => onView(p)}
                          className="flex items-center gap-2 text-left font-medium text-emerald-700 hover:underline min-w-0"
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate max-w-[200px]">{p.fileName}</span>
                        </button>
                        {/* (SUPPRIMÉ 0.2.52) pastille ⚠ Nom retirée à la demande de
                            l'utilisateur (cadre rouge) : la détection des erreurs
                            / incohérences de nom et prénom reste active (journal,
                            résultats d'import, e-mails) mais le tableau « Toutes
                            les fiches » n'affiche plus la pastille. */}
                      </div>
                    </TableCell>
                    {/* Task 16 : cellule « Employé » masquée */}
                    <TableCell>{p.period ?? "—"}</TableCell>
                    <TableCell>
                      {/* Task 17 : CIN masqué — seuls les 3 derniers caractères sont visibles */}
                      {p.cin ? (
                        <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                          {maskCin(p.cin)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">non détecté</span>
                      )}
                    </TableCell>
                    {/* NOUVEAU (v0.2.107) : MATRICULE de la fiche (extrait
                        automatiquement à l'import — ligne « — » si absent). */}
                    <TableCell>
                      {p.matricule ? (
                        <span className="font-mono text-xs">{p.matricule}</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    {/* Task 16 : cellule « Net à payer » masquée */}
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(p.uploadedAt), "dd/MM/yyyy HH:mm", { locale: fr })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => onView(p)} title="Voir">
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">Voir</span>
                        </Button>
                        <Button size="sm" variant="outline" asChild title="Télécharger">
                          <a href={`/api/payslips/${p.id}/file?download=1`} download>
                            <Download className="h-4 w-4" />
                            <span className="sr-only">Télécharger</span>
                          </a>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setToDelete(p)}
                          title="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span className="sr-only">Supprimer</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Cartes — mobile */}
          <div className="md:hidden space-y-3">
            {filtered.map((p) => (
              <Card key={p.id} className={selected.has(p.id) ? "border-emerald-300 bg-emerald-50/40" : ""}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5 w-full min-w-0">
                      <button
                        onClick={() => onView(p)}
                        className="flex items-start gap-2 text-left font-medium text-emerald-700 w-full min-w-0"
                      >
                        <FileText className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-all">{p.fileName}</span>
                      </button>
                      {/* (SUPPRIMÉ 0.2.52) pastille ⚠ Nom retirée à la demande de
                          l'utilisateur (cartes mobiles : même décision). */}
                    </div>
                    {/* NOUVEAU (Task 29) : case à cocher de la carte */}
                    <Checkbox
                      checked={selected.has(p.id)}
                      onCheckedChange={(v) => toggleOne(p.id, v === true)}
                      aria-label={`Sélectionner ${p.fileName}`}
                      className="shrink-0 mt-0.5"
                    />
                  </div>
                  {/* Task 16 : champs « Employé » et « Net à payer » masqués (cartes mobiles) */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Période</p>
                      <p>{p.period ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">CIN</p>
                      {p.cin ? (
                        <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                          <IdCard className="h-3 w-3 mr-1" />
                          {/* Task 17 : CIN masqué */}
                          {maskCin(p.cin)}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">non détecté</span>
                      )}
                    </div>
                    {/* NOUVEAU (v0.2.107) : matricule de la fiche (mobile) */}
                    <div>
                      <p className="text-xs text-muted-foreground">Matricule</p>
                      {p.matricule ? (
                        <p className="font-mono text-xs">{p.matricule}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs">—</p>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    Importé le {format(new Date(p.uploadedAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => onView(p)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <Eye className="h-4 w-4 mr-1.5" /> Voir
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/api/payslips/${p.id}/file?download=1`} download>
                        <Download className="h-4 w-4 mr-1.5" /> PDF
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-600 hover:bg-red-50"
                      onClick={() => setToDelete(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Supprimer</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* NOUVEAU (Task 99) : contrôles de PAGINATION SERVEUR — Précédent /
          Suivant / Aller à la page (indispensables à 2 400 pages). */}
      {meta.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page <= 1 || loading}
            onClick={() => onPageChange(meta.page - 1)}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Précédent
          </Button>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Page <strong className="text-foreground">{meta.page.toLocaleString("fr-FR")}</strong> sur{" "}
              {meta.totalPages.toLocaleString("fr-FR")}
            </span>
            <span className="hidden sm:inline text-muted-foreground/50">|</span>
            <span className="hidden sm:inline">Aller à :</span>
            <Input
              type="number"
              min={1}
              max={meta.totalPages}
              value={pageVoulue}
              onChange={(e) => setPageVoulue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") allerALaPage();
              }}
              placeholder="N°"
              className="h-8 w-20 text-xs"
              aria-label="Numéro de page"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={!pageVoulue || loading}
              onClick={allerALaPage}
            >
              <ChevronRight className="h-4 w-4" />
              <span className="sr-only">Aller à la page</span>
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={meta.page >= meta.totalPages || loading}
            onClick={() => onPageChange(meta.page + 1)}
          >
            Suivant
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Confirmation suppression UNITAIRE (inchangée) */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette fiche de paie ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le fichier « {toDelete?.fileName} » et son contenu indexé seront
              définitivement supprimés. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Suppression…" : "Supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOUVEAU (Task 29) : confirmation de la SUPPRESSION MULTIPLE */}
      <AlertDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => !open && !bulkDeleting && setBulkConfirmOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Supprimer {selected.size} fiche{selected.size > 1 ? "s" : ""} de paie ?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Les {selected.size} fiche{selected.size > 1 ? "s cochées seront" : " cochée sera"}{' '}
              définitivement supprimée{selected.size > 1 ? "s" : ""} (fichiers et
              contenus indexés). Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleBulkDelete();
              }}
              disabled={bulkDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {bulkDeleting ? "Suppression…" : "Tout supprimer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
