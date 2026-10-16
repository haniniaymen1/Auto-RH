"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Users2, ShieldCheck, ShieldOff, Trash2, Search, RefreshCw, KeyRound, UserCog, UserPlus, Lock, Crown, RotateCcw } from "lucide-react";
// (NOUVEAU — demande utilisateur) poignées de redimensionnement des colonnes
import { utiliserColonnesRedimensionnables } from "@/components/payslip/colonnes-redimensionnables";

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  // NOUVEAU (v0.2.129) : suivi d'activation du mot de passe initial (15 min)
  passwordExpiresAt: string | null;
  activatedAt: string | null;
  // NOUVEAU (v0.2.129 — demande utilisateur) : case « Manager » + responsable
  isManager: boolean;
  managerId: string | null;
  manager?: { id: string; name: string; email: string } | null;
  // NOUVEAU (v0.2.129) : statut calculé côté serveur
  statutActivation: "actif" | "attente" | "expire" | "desactive";
}

/**
 * Onglet « Utilisateurs » — visible par les informaticiens (rôle IT)
 * ET par le superadministrateur (Task 34).
 * (MODIFIÉ Task 173 — « Permissions du rôle IT » + « Rôle RH ») :
 * - IT : CONSULTATION SEULE de la liste des utilisateurs — aucun bouton
 *   d'action (pas de création, modification, suppression, activation/
 *   désactivation, ni de changement de rôle ou de permissions) ;
 * - SUPERADMIN : gestion COMPLÈTE des comptes RH et IT — créer un compte,
 *   activer/désactiver, supprimer, réinitialiser le mot de passe
 *   (réinitialisation des accès) et basculer le rôle RH ↔ IT ;
 * - RH : n'a pas du tout accès à cet onglet (ni à l'API — 403 serveur).
 *
 * (v0.2.192 — demande utilisateur) UTILISATION SANS DÉFILEMENT HORIZONTAL :
 * la colonne Actions est COLLANTE à droite (sticky, fond opaque, séparation +
 * ombre) — les 5 boutons de gestion restent visibles et cliquables même quand
 * le tableau défile ; les colonnes secondaires sont masquées sur les écrans
 * étroits (Manager < XL, Créé le < LG) et l'e-mail est tronqué avec infobulle.
 */
export function UsersTab({ meId, meRole }: { meId: string; meRole?: string }) {
  const { toast } = useToast();
  const estSuper = meRole === "SUPERADMIN"; // NOUVEAU (Task 34)
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  // (NOUVEAU — demande utilisateur, point 9) redimensionnement manuel des colonnes
  const refTableauUtilisateurs = useRef<HTMLDivElement>(null);
  utiliserColonnesRedimensionnables(refTableauUtilisateurs, "utilisateurs", users.length + (loading ? 1 : 0));
  const [filter, setFilter] = useState("");
  const [toDelete, setToDelete] = useState<UserRow | null>(null);
  // NOUVEAU (Task 34) : actions réservées au superadministrateur
  const [toReset, setToReset] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [toRole, setToRole] = useState<UserRow | null>(null);
  // NOUVEAU (Task 172) : création de comptes RH/IT (superadmin)
  const [ouvrirCreation, setOuvrirCreation] = useState(false);
  const [nouveauNom, setNouveauNom] = useState("");
  const [nouvelEmail, setNouvelEmail] = useState("");
  const [nouveauRole, setNouveauRole] = useState<"RH" | "IT">("RH");
  const [nouveauMdp, setNouveauMdp] = useState("");
  const [creationEnCours, setCreationEnCours] = useState(false);
  // (MODIFIÉ v0.2.131 — demande utilisateur) : la case à cocher « Manager »
  // et la liste déroulante « Manager responsable » ONT ÉTÉ RETIRÉES de la
  // fenêtre « Créer un compte utilisateur » : la désignation des managers se
  // fait désormais depuis la fenêtre « Mot de passe initial — CIN » de
  // l'onglet Accès portail (champs PortalAccess.isManager / managerId).
  // NOUVEAU (v0.2.129) : réactivation d'un compte expiré (nouveau mot de passe unique + e-mail)
  const [toReactiver, setToReactiver] = useState<UserRow | null>(null);
  const [reactivationEnCours, setReactivationEnCours] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users ?? []);
      }
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleActive(user: UserRow) {
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: user.isActive ? "Compte désactivé" : "Compte activé",
          description: `${user.name} — ${user.email}`,
        });
        load();
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }

  async function deleteUser(user: UserRow) {
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Compte supprimé", description: `${user.name} — ${user.email}` });
        load();
      } else {
        toast({ title: "Suppression impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }

  // NOUVEAU (Task 34) : réinitialisation du mot de passe (superadmin)
  // (MODIFIÉ — politique de complexité) : contrôle immédiat côté interface.
  function politiqueMotDePasseRespectee(mdp: string): string[] {
    const erreurs: string[] = [];
    if (!mdp || mdp.length < 8) erreurs.push("au moins 8 caractères");
    if (!/[a-z]/.test(mdp)) erreurs.push("une lettre minuscule (a-z)");
    if (!/[A-Z]/.test(mdp)) erreurs.push("une lettre majuscule (A-Z)");
    if (!/[0-9]/.test(mdp)) erreurs.push("un chiffre (0-9)");
    if (!/[^A-Za-z0-9]/.test(mdp)) erreurs.push("un symbole (ex. !@#$%*+=?)");
    return erreurs;
  }

  async function resetPassword(user: UserRow) {
    const manquants = politiqueMotDePasseRespectee(resetPwd);
    if (manquants.length) {
      toast({
        title: "Mot de passe insuffisant",
        description: "Il doit contenir " + manquants.join(", ") + ".",
        variant: "destructive",
      });
      return;
    }
    try {
      const res = await fetch(`/api/users/${user.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPwd }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Mot de passe réinitialisé", description: `${user.name} — ${user.email}` });
        setToReset(null);
        setResetPwd("");
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }

  // NOUVEAU (Task 34) : bascule du rôle RH ↔ IT (superadmin)
  async function changeRole(user: UserRow, role: "RH" | "IT") {
    try {
      const res = await fetch(`/api/users/${user.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Rôle mis à jour", description: data.message || `${user.name} — ${role}` });
        setToRole(null);
        load();
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }

  // NOUVEAU (v0.2.129) : réactivation d'un compte dont le délai d'activation
  // de 15 minutes a expiré — génère un NOUVEAU mot de passe initial UNIQUE
  // (différent de tous les précédents) et l'envoie par e-mail (valable 15 min).
  async function reactiverCompte(user: UserRow) {
    setReactivationEnCours(true);
    try {
      const res = await fetch(`/api/users/${user.id}/reactiver`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Compte réactivé", description: data.message || `${user.name} — nouveau mot de passe envoyé.` });
        setToReactiver(null);
        load();
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setReactivationEnCours(false);
    }
  }

  // NOUVEAU (v0.2.129 — demande utilisateur) : coche/décoche « Manager » sur
  // un compte existant — la liste déroulante des managers se met à jour.
  async function basculerManager(user: UserRow) {
    try {
      const res = await fetch(`/api/users/${user.id}/manager`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isManager: !user.isManager }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({
          title: user.isManager ? "Retiré des managers" : "Marqué comme manager",
          description: data.message || `${user.name}`,
        });
        load();
      } else {
        toast({ title: "Action impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }

  // NOUVEAU (Task 172) : création d'un compte RH/IT (superadmin uniquement)
  async function creerCompte() {
    const manquants = politiqueMotDePasseRespectee(nouveauMdp);
    if (manquants.length) {
      toast({
        title: "Mot de passe insuffisant",
        description: "Il doit contenir " + manquants.join(", ") + ".",
        variant: "destructive",
      });
      return;
    }
    setCreationEnCours(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nouveauNom,
          email: nouvelEmail,
          password: nouveauMdp,
          role: nouveauRole,
          // (MODIFIÉ v0.2.131) : isManager/managerId RETIRÉS du formulaire de
          // création — voir la note en tête du composant.
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast({ title: "Compte créé", description: data.message || `${nouveauNom} — ${nouvelEmail}` });
        setOuvrirCreation(false);
        setNouveauNom("");
        setNouvelEmail("");
        setNouveauRole("RH");
        setNouveauMdp("");
        // (MODIFIÉ v0.2.131) : plus d'états Manager à réinitialiser ici.
        // Le rechargement rafraîchit le tableau (statuts d'activation…).
        load();
      } else {
        toast({ title: "Création impossible", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setCreationEnCours(false);
    }
  }

  const filtered = users.filter((u) => {
    const f = filter.trim().toLowerCase();
    if (!f) return true;
    return (
      u.name.toLowerCase().includes(f) ||
      u.email.toLowerCase().includes(f) ||
      u.role.toLowerCase().includes(f)
    );
  });

  // (MODIFIÉ v0.2.131) : le mémo managersDisponibles a été RETIRÉ — la liste
  // déroulante « Manager responsable » n'existe plus dans cette interface ;
  // l'équivalent côté employés vit dans portal-access-tab.tsx (managersPortail).

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users2 className="h-5 w-5 text-emerald-600" />
              {estSuper ? "Comptes utilisateurs — superadministration" : "Comptes utilisateurs"}
            </CardTitle>
            <CardDescription>
              {estSuper
                ? "Vous êtes connecté en SUPERADMINISTRATION : gestion complète des comptes RH et IT — création, activation/désactivation, suppression, réinitialisation des accès (mot de passe) et changement de rôle."
                : "Rôle IT : consultation seule de la liste des utilisateurs. La création, la modification, l'activation/désactivation, la suppression des comptes et le changement des rôles ou permissions sont réservés au superadministrateur."}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* NOUVEAU (Task 172) : création de comptes RH/IT — superadministrateur */}
            {estSuper && (
              <Button
                size="sm"
                onClick={() => {
                  setNouveauNom("");
                  setNouvelEmail("");
                  setNouveauRole("RH");
                  setNouveauMdp("");
                  setOuvrirCreation(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <UserPlus className="h-4 w-4" />
                Créer un compte
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} className="shrink-0">
              <RefreshCw className="h-4 w-4" />
              Actualiser
            </Button>
          </div>
        </div>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filtrer par nom, email ou rôle…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </CardHeader>
      <CardContent>
        {/* Tableau desktop (MODIFIÉ — demande utilisateur, point 9 : poignées de redimensionnement) */}
        <div ref={refTableauUtilisateurs} className="hidden md:block rounded-md border overflow-x-auto">
          {/* (v0.2.192) : le conteneur reste scrollable, mais la colonne Actions
              est collante à droite — plus besoin de défiler vers la gauche/droite
              pour atteindre les boutons de gestion. */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rôle</TableHead>
                <TableHead>Statut</TableHead>
                {/* NOUVEAU (v0.2.129) : manager responsable du compte —
                    (v0.2.192) masquée sous XL pour réduire la largeur du tableau */}
                <TableHead className="hidden xl:table-cell">Manager</TableHead>
                {/* (v0.2.192) masquée sous LG pour réduire la largeur du tableau */}
                <TableHead className="hidden lg:table-cell">Créé le</TableHead>
                {/* MODIFIÉ (v0.2.192 — demande utilisateur) : colonne Actions COLLANTE
                    à droite — les boutons restent toujours accessibles sans faire
                    défiler le tableau horizontalement (opt-in data-col-sticky du
                    hook de redimensionnement, qui respecte la position collante). */}
                <TableHead
                  className="sticky right-0 z-10 bg-background text-right border-l border-border/60"
                  data-col-sticky="right"
                  data-col-min={200}
                >
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Chargement…
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Aucun compte trouvé.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.name}
                      {u.id === meId && (
                        <span className="ml-2 text-xs text-muted-foreground">(vous)</span>
                      )}
                    </TableCell>
                    {/* (v0.2.192) e-mail tronqué avec infobulle — évite d'élargir la colonne */}
                    <TableCell className="text-muted-foreground max-w-[220px] truncate" title={u.email}>
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <BadgeRole role={u.role} />
                        {/* NOUVEAU (v0.2.129) : badge « Manager » (case à cocher) */}
                        {u.isManager && (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700" title="Ce compte est un manager : il figure dans la liste déroulante « Manager responsable »">
                            <Crown className="h-3 w-3 mr-1" />
                            Manager
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* NOUVEAU (v0.2.129) : statut d'activation (15 min) */}
                      <BadgeStatut u={u} />
                    </TableCell>
                    {/* (v0.2.192) colonne Manager masquée sous XL */}
                    <TableCell className="hidden xl:table-cell text-muted-foreground text-sm">
                      {/* NOUVEAU (v0.2.129) : manager responsable (liste déroulante) */}
                      {u.manager ? (
                        <span title={u.manager.email}>{u.manager.name}</span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    {/* (v0.2.192) colonne Créé le masquée sous LG */}
                    <TableCell className="hidden lg:table-cell text-muted-foreground text-sm">
                      {new Date(u.createdAt).toLocaleDateString("fr-FR")}
                    </TableCell>
                    {/* MODIFIÉ (v0.2.192) : cellule Actions COLLANTE à droite —
                        fond opaque + séparation + ombre portée pour rester lisible
                        au-dessus des colonnes défilées ; les 5 boutons restent
                        utilisables SANS défilement horizontal. */}
                    <TableCell className="sticky right-0 z-10 bg-card text-right border-l border-border/60 shadow-[-10px_0_10px_-8px_rgba(0,0,0,0.18)]">
                      {/* MODIFIÉ (Task 173) : le rôle IT consulte la liste
                          SANS aucun bouton d'action — toutes les gestions
                          (activer/désactiver, supprimer, mot de passe,
                          rôle) sont superadministrateur. */}
                      {!estSuper ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                          title="Consultation seule : la gestion des comptes est réservée au superadministrateur"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Consultation seule
                        </span>
                      ) : (
                      <div className="flex justify-end gap-1.5">
                        {/* NOUVEAU (v0.2.129) : compte DONT LE DÉLAI D'ACTIVATION A EXPIRÉ —
                            la simple activation est interdite : bouton « Réactiver »
                            (NOUVEAU mot de passe initial unique envoyé par e-mail). */}
                        {u.statutActivation === "expire" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setToReactiver(u)}
                            className="border-amber-300 text-amber-700 hover:bg-amber-50"
                            title="Générer un NOUVEAU mot de passe initial (unique) et l'envoyer par e-mail — valable 15 minutes"
                          >
                            <RotateCcw className="h-4 w-4" />
                            <span className="hidden lg:inline ml-1">Réactiver</span>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={u.id === meId}
                            onClick={() => toggleActive(u)}
                            title={
                              u.id === meId
                                ? "Votre propre compte"
                                : u.isActive
                                  ? "Désactiver ce compte"
                                  : "Réactiver ce compte"
                            }
                          >
                            {u.isActive ? (
                              <ShieldOff className="h-4 w-4" />
                            ) : (
                              <ShieldCheck className="h-4 w-4" />
                            )}
                            <span className="hidden lg:inline ml-1">
                              {u.isActive ? "Désactiver" : "Activer"}
                            </span>
                          </Button>
                        )}
                        {/* NOUVEAU (v0.2.129 — demande utilisateur) : bascule « Manager » */}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={u.id === meId}
                          onClick={() => basculerManager(u)}
                          className={u.isManager ? "border-amber-300 bg-amber-50 text-amber-700" : ""}
                          title={
                            u.isManager
                              ? "Retirer ce compte de la liste des managers"
                              : "Marquer ce compte comme Manager (il apparaîtra dans la liste déroulante des managers)"
                          }
                        >
                          <Crown className="h-4 w-4" />
                          <span className="hidden lg:inline ml-1">Manager</span>
                        </Button>
                        {/* NOUVEAU (Task 34) : réinitialisation mot de passe + rôle (superadmin) */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setResetPwd("");
                            setToReset(u);
                          }}
                          title="Réinitialiser le mot de passe de ce compte"
                        >
                          <KeyRound className="h-4 w-4" />
                          <span className="hidden lg:inline ml-1">Mot de passe</span>
                        </Button>
                        {u.role !== "SUPERADMIN" && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={u.id === meId}
                            onClick={() => setToRole(u)}
                            title="Changer le rôle (RH ↔ IT)"
                          >
                            <UserCog className="h-4 w-4" />
                            <span className="hidden lg:inline ml-1">Rôle</span>
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={u.id === meId}
                          onClick={() => setToDelete(u)}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          title={
                            u.id === meId
                              ? "Votre propre compte"
                              : "Supprimer ce compte"
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Cartes mobile */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <p className="text-center text-muted-foreground py-6">Chargement…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted-foreground py-6">Aucun compte trouvé.</p>
          ) : (
            filtered.map((u) => (
              <div key={u.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm truncate">
                    {u.name}
                    {u.id === meId && <span className="ml-1 text-xs text-muted-foreground">(vous)</span>}
                  </p>
                  {/* NOUVEAU (v0.2.129) : statut d'activation (15 min) */}
                  <BadgeStatut u={u} />
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <BadgeRole role={u.role} />
                    {u.isManager && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                        <Crown className="h-3 w-3 mr-1" />
                        Manager
                      </Badge>
                    )}
                  </div>
                  {/* MODIFIÉ (Task 173) : l'IT consulte SANS aucun bouton
                      (mobile comme desktop) — gestion superadmin seule. */}
                  {!estSuper ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" />
                      Consultation seule
                    </span>
                  ) : (
                  <div className="flex gap-1.5">
                    {u.statutActivation === "expire" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setToReactiver(u)}
                        className="border-amber-300 text-amber-700"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={u.id === meId}
                        onClick={() => toggleActive(u)}
                      >
                        {u.isActive ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      </Button>
                    )}
                    {/* NOUVEAU (v0.2.129 — demande utilisateur) : bascule « Manager » (mobile) */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={u.id === meId}
                      onClick={() => basculerManager(u)}
                      className={u.isManager ? "border-amber-300 bg-amber-50 text-amber-700" : ""}
                    >
                      <Crown className="h-4 w-4" />
                    </Button>
                    {/* NOUVEAU (Task 34) : actions superadmin (mobile) */}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResetPwd("");
                        setToReset(u);
                      }}
                    >
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    {u.role !== "SUPERADMIN" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={u.id === meId}
                        onClick={() => setToRole(u)}
                      >
                        <UserCog className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={u.id === meId}
                      onClick={() => setToDelete(u)}
                      className="text-red-600"
                      title="Supprimer ce compte"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>

      {/* Confirmation de suppression */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce compte ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} ({toDelete?.email}) ne pourra plus se connecter. Cette action est
              définitive — la personne devra faire recréer son compte par le superadministrateur
              (onglet « Utilisateurs »).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteUser(toDelete)}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOUVEAU (Task 34) : réinitialisation du mot de passe (superadmin) */}
      <AlertDialog open={!!toReset} onOpenChange={(open) => !open && setToReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réinitialiser le mot de passe ?</AlertDialogTitle>
            <AlertDialogDescription>
              Saisissez le NOUVEAU mot de passe à attribuer à {toReset?.name} ({toReset?.email}).
              L&apos;ancien mot de passe cessera immédiatement de fonctionner.
              {/* (MODIFIÉ v0.2.129) : non-réutilisation + validité 15 minutes */}
              Il ne doit PAS être un mot de passe déjà attribué à ce compte ; pour un compte RH/IT,
              il est valable 15 MINUTES (délai d&apos;activation). Communiquez le nouveau mot de
              passe à la personne par un canal sûr.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Nouveau mot de passe (8 caractères min. — minuscules, majuscules, chiffres, symboles)"
            value={resetPwd}
            onChange={(e) => setResetPwd(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => toReset && resetPassword(toReset)}>
              Réinitialiser
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOUVEAU (Task 34) : changement de rôle RH ↔ IT (superadmin) */}
      <AlertDialog open={!!toRole} onOpenChange={(open) => !open && setToRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Changer le rôle ?</AlertDialogTitle>
            <AlertDialogDescription>
              {toRole?.name} ({toRole?.email}) est actuellement{" "}
              <b>{toRole?.role === "IT" ? "Informatique (IT)" : "RH"}</b>. Choisissez le nouveau rôle —
              il prend effet à la prochaine connexion de la personne.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            {toRole?.role === "IT" ? (
              <AlertDialogAction onClick={() => toRole && changeRole(toRole, "RH")}>
                Passer en RH
              </AlertDialogAction>
            ) : (
              <AlertDialogAction onClick={() => toRole && changeRole(toRole, "IT")}>
                Passer en Informatique (IT)
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOUVEAU (v0.2.129) : réactivation d'un compte expiré — NOUVEAU mot de
          passe initial UNIQUE généré automatiquement et envoyé par e-mail
          (valable 15 minutes). Le SuperAdmin ne choisit PAS le mot de passe. */}
      <AlertDialog open={!!toReactiver} onOpenChange={(open) => !open && setToReactiver(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réactiver ce compte avec un NOUVEAU mot de passe ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le délai d&apos;activation de 15 minutes de {toReactiver?.name} ({toReactiver?.email}) a
              expiré : le compte a été automatiquement désactivé et l&apos;ancien mot de passe n&apos;est
              plus accepté. La réactivation va GÉNÉRER AUTOMATIQUEMENT un nouveau mot de passe
              initial — unique, différent de tous les mots de passe précédemment attribués à ce
              compte — et l&apos;envoyer par e-mail. Il sera valable 15 MINUTES.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivationEnCours}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={reactivationEnCours}
              onClick={(e) => {
                e.preventDefault();
                toReactiver && reactiverCompte(toReactiver);
              }}
            >
              {reactivationEnCours ? "Réactivation…" : "Générer et envoyer par e-mail"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NOUVEAU (Task 172) : création d'un compte RH ou IT — superadministrateur.
          Répond à la demande « Gestion des rôles et des permissions » :
          « Peut gérer les comptes RH et IT : créer un compte… ». */}
      <AlertDialog open={ouvrirCreation} onOpenChange={setOuvrirCreation}>
        <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Créer un compte utilisateur</AlertDialogTitle>
            <AlertDialogDescription>
              Créez un compte RH (Ressources Humaines) ou IT (Informatique). Le mot de passe
              initial doit respecter la politique de sécurité (8 caractères minimum, avec
              minuscule, majuscule, chiffre et symbole).
              {/* (MODIFIÉ v0.2.129) : validité de 15 MINUTES du mot de passe initial */}
              Il est envoyé par e-mail et n&apos;est VALABLE QUE 15 MINUTES : passé ce délai sans
              connexion, le compte est automatiquement désactivé (réactivation possible par un
              nouveau mot de passe envoyé par e-mail).
              {/* (Task 221) l'e-mail de création part de l'adresse du service informatique configurée */}
              L&apos;e-mail d&apos;identification sera envoyé depuis l&apos;adresse du service
              informatique configurée dans les paramètres SMTP.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label htmlFor="creation-nom" className="text-sm font-medium">
                Nom complet
              </label>
              <Input
                id="creation-nom"
                placeholder="Ex. Trabelsi Sonia"
                value={nouveauNom}
                onChange={(e) => setNouveauNom(e.target.value)}
                maxLength={80}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="creation-email" className="text-sm font-medium">
                Adresse e-mail (identifiant de connexion)
              </label>
              <Input
                id="creation-email"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder="ex. prenom.nom@entreprise.tn"
                value={nouvelEmail}
                onChange={(e) => setNouvelEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="creation-role" className="text-sm font-medium">
                Rôle du compte
              </label>
              <select
                id="creation-role"
                value={nouveauRole}
                onChange={(e) => setNouveauRole(e.target.value === "IT" ? "IT" : "RH")}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="RH">RH — Ressources Humaines (paie, import, accès portail…)</option>
                <option value="IT">IT — Informatique (comptes IT, demandes… droits limités)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="creation-mdp" className="text-sm font-medium">
                Mot de passe initial
              </label>
              <Input
                id="creation-mdp"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="8 caractères min. — minuscules, majuscules, chiffres, symboles"
                value={nouveauMdp}
                onChange={(e) => setNouveauMdp(e.target.value)}
              />
              {/* (MODIFIÉ v0.2.129) : précision de la validité de 15 minutes */}
              <p className="text-xs text-muted-foreground">
                Valable 15 minutes à compter de l&apos;envoi de l&apos;e-mail : la personne doit se
                connecter et activer son compte dans ce délai, sinon le compte est automatiquement
                désactivé.
              </p>
            </div>
              {/* (MODIFIÉ v0.2.131 — demande utilisateur) : la case à cocher   */}
              {/* « Manager » et la liste déroulante « Manager responsable »    */}
              {/* ont été RETIRÉES de cette fenêtre. La désignation des         */}
              {/* managers se fait désormais dans la fenêtre « Mot de passe     */}
              {/* initial — CIN » de l'onglet Accès portail.                    */}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={creationEnCours}>Annuler</AlertDialogCancel>
            <AlertDialogAction
              disabled={creationEnCours || !nouveauNom.trim() || !nouvelEmail.trim() || !nouveauMdp}
              onClick={(e) => {
                e.preventDefault();
                creerCompte();
              }}
            >
              {creationEnCours ? "Création…" : "Créer le compte"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** NOUVEAU (Task 34) : badge de rôle (3 niveaux : RH, IT, Superadministrateur). */
function BadgeRole({ role }: { role: string }) {
  if (role === "SUPERADMIN") {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
        Superadministrateur
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={role === "IT" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-emerald-300 bg-emerald-50 text-emerald-700"}
    >
      {role === "IT" ? "Informatique" : "RH"}
    </Badge>
  );
}

/**
 * NOUVEAU (v0.2.129) : badge de STATUT D'ACTIVATION du compte :
 *  - « attente » : mot de passe initial en cours de validité — affiche le
 *    temps restant avant la désactivation automatique (compte à minute) ;
 *  - « expire » : délai de 15 minutes dépassé sans connexion — le compte a
 *    été désactivé AUTOMATIQUEMENT, l'ancien mot de passe n'est plus accepté ;
 *  - « desactive » : désactivé manuellement par le superadministrateur ;
 *  - sinon : Actif (compte activé ou mot de passe classique).
 */
function BadgeStatut({ u }: { u: UserRow }) {
  if (u.statutActivation === "attente") {
    const expiration = u.passwordExpiresAt ? new Date(u.passwordExpiresAt).getTime() : 0;
    const minutes = Math.max(0, Math.ceil((expiration - Date.now()) / 60000));
    return (
      <Badge className="bg-amber-500 hover:bg-amber-500 text-white whitespace-nowrap">
        En attente — expire dans {minutes} min
      </Badge>
    );
  }
  if (u.statutActivation === "expire") {
    return (
      <Badge className="bg-red-600 hover:bg-red-600 text-white whitespace-nowrap">
        Délai expiré — désactivé
      </Badge>
    );
  }
  return (
    <Badge variant={u.isActive ? "default" : "secondary"} className={u.isActive ? "bg-emerald-600" : ""}>
      {u.isActive ? "Actif" : "Désactivé"}
    </Badge>
  );
}
