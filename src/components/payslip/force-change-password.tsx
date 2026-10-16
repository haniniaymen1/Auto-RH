"use client";

import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KeyRound, AlertCircle, ShieldAlert, LogOut } from "lucide-react";
import { erreursPolitiqueMotDePasse } from "@/lib/password-policy";

/**
 * NOUVEAU (Task 64) — ÉCRAN DE CHANGEMENT DE MOT DE PASSE OBLIGATOIRE.
 *
 * Politique : TOUS les utilisateurs (RH, IT, superadministrateur) doivent
 * changer leur mot de passe TOUS LES 15 JOURS.
 *
 * Cet écran remplace TOUTE l'application tant que le mot de passe n'est pas
 * changé (aucune navigation possible) ; côté serveur, toutes les autres API
 * répondent 403 dans le même temps (aucun contournement possible).
 * Le changement exige le mot de passe ACTUEL (preuve d'identité).
 */
export function ForceChangePassword({ onDone }: { onDone: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    if (newPassword === currentPassword) {
      setError("Le nouveau mot de passe doit être DIFFÉRENT du mot de passe actuel.");
      return;
    }
    // (NOUVEAU — politique de complexité) : 8 caractères minimum, avec
    // minuscule + majuscule + chiffre + symbole (contrôle immédiat côté
    // interface ; le serveur applique la même règle).
    const manquants = erreursPolitiqueMotDePasse(newPassword);
    if (manquants.length) {
      setError("Mot de passe insuffisant : il doit contenir " + manquants.join(", ") + ".");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onDone();
        return;
      }
      setError(data.error ?? "Changement impossible. Réessayez.");
    } catch {
      setError("Erreur réseau. Vérifiez que le serveur est démarré.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // même en cas d'erreur réseau, on tente la redirection
    }
    window.location.replace("/login");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md space-y-6">
        {/* MODIFIÉ (Task 115) : logo Trailmix fourni par l'utilisateur
            (logo AutoRH fourni par l'utilisateur — vert émeraude + blanc). */}
        <div className="flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-trailmix.png" alt="Logo AutoRH" className="h-12 w-auto" />
          <div>
            <h1 className="font-bold text-xl leading-tight">Fiches de Paie</h1>
            <p className="text-xs text-muted-foreground">Sécurité du compte</p>
          </div>
        </div>

        <Card className="shadow-sm border-amber-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Changement de mot de passe obligatoire
            </CardTitle>
            <CardDescription>
              Votre mot de passe a <b>expiré</b>. Pour protéger les fiches de paie, la politique
              de sécurité impose son changement <b>tous les 15 jours</b>, pour tous les
              utilisateurs (RH, Informatique et superadministrateur). Vous devrez le changer à
              nouveau dans 15 jours.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="current">Mot de passe actuel</Label>
                <Input
                  id="current"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="new">Nouveau mot de passe</Label>
                <Input
                  id="new"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Au moins <b>8 caractères</b>, avec obligatoirement une <b>minuscule</b>, une
                  <b> majuscule</b>, un <b>chiffre</b> et un <b>symbole</b> (ex. !@#$%*+=?),
                  différent du mot de passe actuel. Il sera à nouveau à changer dans 15 jours.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm">Confirmer le nouveau mot de passe</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={loading}
              >
                <KeyRound className="h-4 w-4" />
                {loading ? "Changement…" : "Changer mon mot de passe"}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleLogout}
                disabled={loading}
              >
                <LogOut className="h-4 w-4" />
                Se déconnecter
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Tant que le changement n&apos;est pas effectué, les fiches et les réglages restent
          inaccessibles (vérifié également côté serveur).
        </p>
      </div>
    </div>
  );
}
