"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Eye,
  Download,
  Search,
  IdCard,
  FileWarning,
  CalendarDays,
  FileText,
  // NOUVEAU (Task 99) : contrôles de pagination serveur des résultats
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
// MODIFIÉ (Task 16) : affichage des colonnes « Employé » et « Net à payer » retiré
// (tableau desktop + cartes mobiles) à la demande de l'administrateur.
import type { PayslipListItem, PaginationMeta } from "@/lib/types";
import { maskCin } from "@/lib/utils";
// (NOUVEAU — demande utilisateur) poignées de redimensionnement des colonnes
import { utiliserColonnesRedimensionnables } from "@/components/payslip/colonnes-redimensionnables";

interface SearchTabProps {
  query: string;
  setQuery: (q: string) => void;
  onSearch: (q: string) => void;
  onSearchChange: (q: string) => void;
  loading: boolean;
  searched: boolean;
  results: PayslipListItem[];
  onView: (p: PayslipListItem) => void;
  // NOUVEAU (Task 17) : dernier CIN recherché — sert à afficher le CIN masqué
  // dans la ligne de résultat une fois le champ vidé après la recherche.
  lastSearched: string;
  // NOUVEAU (Task 99) : PAGINATION SERVEUR des résultats — la recherche
  // s'effectue sur TOUTES les fiches côté serveur ; les résultats tiennent
  // dans des pages de 100.
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}

/** Onglet principal : recherche des fiches par CIN présent DANS LE CONTENU du PDF. */
export function SearchTab({
  query,
  setQuery,
  onSearch,
  onSearchChange,
  loading,
  searched,
  results,
  onView,
  lastSearched,
  meta,
  onPageChange,
}: SearchTabProps) {
  const [focused, setFocused] = useState(false);
  // (NOUVEAU — demande utilisateur, point 9) redimensionnement manuel des colonnes
  const refTableauRecherche = useRef<HTMLDivElement>(null);
  utiliserColonnesRedimensionnables(refTableauRecherche, "recherche-fiches", results.length);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <div className="space-y-6">
      {/* Barre de recherche */}
      <Card className="border shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <form onSubmit={handleSubmit} className="space-y-3" role="search">
            <label
              htmlFor="cin-search"
              className="text-sm font-medium flex items-center gap-2"
            >
              <IdCard className="h-4 w-4 text-emerald-600" />
              Numéro de CIN à rechercher
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="cin-search"
                  type="text"
                  inputMode="text"
                  placeholder="CIN complet — ex. : 09123456 ou A123456"
                  value={query}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  autoComplete="off"
                  className={`pl-9 h-11 font-mono text-base tracking-wide ${focused ? "ring-2 ring-emerald-600/20 border-emerald-600" : ""}`}
                />
              </div>
              <Button
                type="submit"
                size="lg"
                className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={loading || query.trim().length < 3}
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 mr-2 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Recherche…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Rechercher
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <strong>Recherche exacte</strong> : la recherche analyse le contenu intégral
              des fiches de paie (PDF exportés de Sage) et affiche uniquement les fiches
              contenant <strong>exactement ce numéro de CIN</strong>. Une partie de CIN
              (ex. : 12345) ne retournera aucun résultat — saisissez le numéro complet.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Résultats */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!loading && searched && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {/* (Task 99) le TOTAL vient du serveur : la recherche a porté
                  sur TOUTES les fiches, pas seulement sur les résultats
                  affichés de cette page. */}
              <span className="font-semibold text-foreground">
                {meta.total.toLocaleString("fr-FR")}
              </span>{" "}
              fiche{meta.total > 1 ? "s" : ""} de paie trouvée
              {meta.total > 1 ? "s" : ""} avec un CIN se terminant par{" "}
              {/* Task 17 : CIN masqué — seuls les 3 derniers caractères sont visibles */}
              <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                {maskCin(lastSearched)}
              </Badge>{" "}
              dans son contenu
              {meta.totalPages > 1 && (
                <>
                  {" "}- page {meta.page} sur {meta.totalPages}
                </>
              )}
            </p>
          </div>

          {results.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-3">
                <FileWarning className="h-10 w-10 text-muted-foreground/50" />
                <div>
                  <p className="font-medium">Aucune fiche de paie trouvée</p>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md">
                    Aucune fiche ne contient exactement ce CIN. Vérifiez que le numéro
                    est complet et identique à celui inscrit dans la fiche de paie, ou
                    importez les fiches depuis Sage via l&apos;onglet « Importer ».
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Tableau — desktop (MODIFIÉ — demande utilisateur, point 9 : poignées de redimensionnement) */}
              <div ref={refTableauRecherche} className="hidden md:block rounded-xl border overflow-hidden bg-white">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[26%]">Fichier</TableHead>
                      {/* Task 16 : colonne « Employé » masquée */}
                      <TableHead>Période</TableHead>
                      <TableHead>CIN</TableHead>
                      {/* Task 16 : colonne « Net à payer » masquée */}
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((p) => (
                      <TableRow key={p.id} className="hover:bg-emerald-50/40">
                        <TableCell>
                          <button
                            onClick={() => onView(p)}
                            className="flex items-center gap-2 text-left font-medium text-emerald-700 hover:underline"
                          >
                            <FileText className="h-4 w-4 shrink-0" />
                            <span className="truncate max-w-[240px]">{p.fileName}</span>
                          </button>
                          {/* Task 36 : extrait du contenu (snippet) retiré à la demande de l'administrateur —
                              aucune donnée issue du contenu des bulletins n'apparaît dans les résultats */}
                        </TableCell>
                        {/* Task 16 : cellule « Employé » masquée */}
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                            {p.period ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {/* Task 17 : CIN masqué */}
                          <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                            {maskCin(p.cin ?? "")}
                          </Badge>
                        </TableCell>
                        {/* Task 16 : cellule « Net à payer » masquée */}
                        <TableCell className="text-right">
                          <ActionsCell payslip={p} onView={onView} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Cartes — mobile */}
              <div className="md:hidden space-y-3">
                {results.map((p) => (
                  <Card key={p.id} className="overflow-hidden">
                    <CardContent className="p-4 space-y-3">
                      <button
                        onClick={() => onView(p)}
                        className="flex items-start gap-2 text-left font-medium text-emerald-700 w-full"
                      >
                        <FileText className="h-4 w-4 shrink-0 mt-0.5" />
                        <span className="break-all">{p.fileName}</span>
                      </button>
                      {/* Task 16 : champs « Employé » et « Net à payer » masqués (cartes mobiles) */}
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Période</p>
                          <p>{p.period ?? "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">CIN</p>
                          {/* Task 17 : CIN masqué */}
                          <Badge variant="outline" className="font-mono border-emerald-600 text-emerald-700">
                            {maskCin(p.cin ?? "")}
                          </Badge>
                        </div>
                      </div>
                      {/* Task 36 : extrait du contenu (snippet) retiré (cartes mobiles) */}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={() => onView(p)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                          <Eye className="h-4 w-4 mr-1.5" /> Voir
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <a href={`/api/payslips/${p.id}/file?download=1`}>
                            <Download className="h-4 w-4 mr-1.5" /> PDF
                          </a>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </>
          )}

          {/* NOUVEAU (Task 99) : contrôles de pagination serveur des résultats. */}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={meta.page <= 1 || loading}
                onClick={() => onPageChange(meta.page - 1)}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Précédent
              </Button>
              <p className="text-xs text-muted-foreground">
                Page {meta.page} sur {meta.totalPages.toLocaleString("fr-FR")} —
                {" "}{meta.total.toLocaleString("fr-FR")} fiche(s) au total
              </p>
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
        </div>
      )}

      {!loading && !searched && (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-14 text-center gap-3">
            <div className="h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
              <IdCard className="h-7 w-7 text-emerald-700" />
            </div>
            <div>
              <p className="font-medium">Recherchez une fiche de paie par CIN</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md">
                Saisissez le numéro de CIN <strong>complet</strong> de l&apos;employé : le
                système parcourt le contenu de toutes les fiches importées depuis Sage et
                affiche chaque bulletin contenant exactement ce numéro.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ActionsCell({
  payslip,
  onView,
}: {
  payslip: PayslipListItem;
  onView: (p: PayslipListItem) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => onView(payslip)}
        title="Afficher la fiche"
      >
        <Eye className="h-4 w-4" />
        <span className="sr-only">Voir</span>
      </Button>
      <Button size="sm" variant="outline" asChild title="Télécharger le PDF">
        <a href={`/api/payslips/${payslip.id}/file?download=1`} download>
          <Download className="h-4 w-4" />
          <span className="sr-only">Télécharger</span>
        </a>
      </Button>
    </div>
  );
}
