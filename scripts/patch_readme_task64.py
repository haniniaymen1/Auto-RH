#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 64 — mise à jour du README :
  1. ports 3000 -> 4000 et 3001 -> 4001 (global) ;
  2. libellés OTP -> mot de passe aux endroits décrivant la connexion ;
  3. réécriture de la section 6 (portail protégé par CIN + mot de passe) ;
  4. adaptation de la section 24 (sessions) ;
  5. ajout de la section 31 « mots de passe : initial, changement obligatoire,
     expiration 15 jours + nouveaux ports 4000/4001 ».
UTF-8 préservé ; remplacements idempotents avec comptage.
"""
import io
import sys

CHEMIN = "/home/z/my-project/README-DEPLOIEMENT-LOCAL.md"

REMPLACEMENTS = [
    # Ports
    ("3000", "4000"),
    ("3001", "4001"),
    # Libellés connexion portail
    ("CIN + code OTP", "CIN + mot de passe"),
    ("CIN + OTP sur 4001", "CIN + mot de passe sur 4001"),
    ("et le portail OTP continue de fonctionner à l'identique",
     "et le portail continue de fonctionner à l'identique"),
    ("portail OTP 54/54", "portail 54/54"),
    ("la suite portail OTP reste", "la suite portail reste"),
    ("recherches, imports, portail OTP", "recherches, imports, portail"),
    ("secrets TOTP du portail",
     "secrets TOTP historiques du portail (remplacés par des mots de passe hachés scrypt, chiffrés à leur tour)"),
    ("cin (chiffré **déterministe**), secret TOTP",
     "cin (chiffré **déterministe**), mot de passe (haché scrypt PUIS chiffré AES-256)"),
    ("textes, TOTP, emails", "textes, mots de passe, emails"),
    # Section 24 : sécurité des sessions
    ("La connexion exige toujours le code TOTP à 6 chiffres : la session longue\n  évite les ressaisies répétées sur un poste de confiance, elle ne remplace\n  jamais la vérification d'identité initiale.",
     "La connexion exige toujours le CIN + le mot de passe : la session longue\n  évite les ressaisies répétées sur un poste de confiance, elle ne remplace\n  jamais la vérification d'identité initiale (et l'expiration des 15 jours\n  impose le changement de mot de passe même sur une session ouverte)."),
    ("le code à 6 chiffres conserve son mode « one-time-code » compatible avec\nles applications d'authentification sur mobile.",
     "le champ mot de passe utilise le mode « new-password » compatible avec les\ngestionnaires de mots de passe (aucun historique de saisie, esprit section 27)."),
    ("verrouillage\n  après trop d'essais, anti-rejeu des codes, recherches et PDF verrouillés sur\n  le CIN de la session.",
     "verrouillage\n  après trop d'essais, écran de changement forcé du mot de passe (15 jours),\n  recherches et PDF verrouillés sur le CIN de la session."),
]

NOUVELLE_SECTION = """
---

## 31. Mots de passe : initial, changement OBLIGATOIRE, expiration tous les 15 jours (18/09/2026)

Cette mise à jour remplace définitivement la connexion par code OTP et renforce la politique des mots de passe pour **TOUTES les catégories d'utilisateurs sans exception** : employés du portail, comptes RH, comptes IT et superadministrateur.

### Nouveaux ports : 4000 et 4001

| Interface | Ancien port | Nouveau port |
|---|---|---|
| Administration RH/IT (login) | 3000 | **4000** |
| Portail employés (CIN + mot de passe) | 3001 | **4001** |

Tous les lanceurs (`.vbs`, `.bat`, `.sh`), le service en arrière-plan, Docker et la documentation ont été mis à jour : rien à configurer, les adresses deviennent `http://localhost:4000` (administration) et `http://localhost:4001` (portail). Pensez à communiquer les NOUVELLES adresses à vos collègues et à autoriser les nouveaux ports dans le pare-feu si l'accès réseau est utilisé.

### Portail employés : mot de passe initial à usage unique

1. Dans l'administration, onglet **« Accès portail »**, le bouton **« Créer l'accès »** génère un **mot de passe initial** affiché **UNE SEULE FOIS** (bouton copier inclus) — communiquez-le à l'employé.
2. À sa première connexion (`CIN + mot de passe initial`), le portail **l'oblige à choisir son propre mot de passe** (écran « Bienvenue — choisissez votre mot de passe ») : le mot de passe initial ne fonctionne plus ensuite (usage unique).
3. En cas d'oubli ou de compromission : bouton **« Réinitialiser »** de l'onglet — un NOUVEAU mot de passe initial à usage unique est généré, l'ancien mot de passe cesse de fonctionner et le changement obligatoire est re-déclenché.
4. Les accès créés avant cette version (OTP) restent listés avec le badge **« À réinitialiser »** : utilisez « Réinitialiser » pour leur donner un mot de passe initial.

### Expiration automatique TOUS LES 15 JOURS (tout le monde)

- **Employés du portail** : 15 jours après chaque changement, le portail refuse les fiches et affiche « Mot de passe expiré — changement obligatoire » ; l'employé choisit un nouveau mot de passe et retrouve immédiatement ses fiches.
- **RH, IT et superadministrateur** : à la connexion (ou sur une session déjà ouverte), l'interface affiche l'écran **« Changement de mot de passe obligatoire »** qui remplace toute l'application ; côté serveur, TOUTES les autres fonctions (fiches, imports, comptes, accès portail) répondent refus tant que le changement n'est pas fait. Aucun contournement possible.
- Règles du nouveau mot de passe : **au moins 8 caractères**, différent du mot de passe actuel et (portail) du numéro CIN. Le compteur repart pour 15 jours pleins après chaque changement.
- Création de compte (inscription) et réinitialisation par le superadministrateur : le nouveau mot de passe repart également pour 15 jours complets.

### Sécurité des mots de passe employés

Le mot de passe de chaque employé est **haché scrypt** (même schéma que les comptes RH/IT : `scrypt:salt:hash`, comparaison à temps constant) PUIS **chiffré AES-256** dans la base comme les autres champs sensibles. Le mot de passe initial en clair n'est jamais stocké. La session de changement (« pending ») dure 10 minutes et ne donne accès à AUCUNE fiche tant que le nouveau mot de passe n'est pas enregistré.
"""


def main() -> int:
    with io.open(CHEMIN, encoding="utf-8") as f:
        texte = f.read()

    for ancien, nouveau in REMPLACEMENTS:
        if ancien == nouveau:
            continue
        n = texte.count(ancien)
        if n == 0:
            # idempotence : rien à remplacer, peut être déjà fait
            if nouveau in texte:
                print(f"  [déjà fait] {ancien[:50]}…")
                continue
            print(f"  [ABSENT] {ancien[:60]}…")
            continue
        texte = texte.replace(ancien, nouveau)
        print(f"  [ok ×{n}] {ancien[:60]}…")

    # Réécriture du bloc « Ce que voit le salarié » (section 6)
    ancien_bloc = """À côté de l'interface d'administration (protégée par login), le site inclut un **portail public destiné à tous les salariés** : une page unique, extrêmement simple, qui ne contient **que la recherche par numéro de CIN**.

### Ce que voit le salarié

- Une seule page : un champ **Numéro CIN** et un bouton **Rechercher** — aucun compte, aucun mot de passe.
- Il saisit son CIN (ex. `09123456`) : toutes les fiches de paie **contenant ce CIN dans leur contenu** s'affichent (période, net à payer, nom).
- Il peut **ouvrir le PDF** ou le **télécharger** directement.
- Le portail tourne sur **son propre port : 4001**, différent de l'administration (4000) : les salariés ne peuvent pas accéder aux fonctions RH/IT.
- **Identité visuelle identique** : le portail affiche le même logo que la page d'administration (carré vert + document blanc), dans l'en-tête ET dans l'onglet du navigateur (favicon). Aucun fichier image externe n'est nécessaire : le logo est intégré directement dans la page."""
    nouveau_bloc = """À côté de l'interface d'administration (protégée par login), le site inclut un **portail destiné à tous les salariés**, protégé par une connexion personnelle **CIN + mot de passe** (section 31).

### Ce que voit le salarié

- Une page de connexion : il saisit son **numéro CIN** et **son mot de passe** (initial remis par le service RH la première fois, puis son propre mot de passe).
- Après connexion, ses fiches de paie **contenant SON CIN dans leur contenu** s'affichent (période, net à payer, nom) ; il peut **ouvrir le PDF** ou le **télécharger** directement.
- À la première connexion, il est **obligé** de remplacer le mot de passe initial par le sien ; ensuite, **tous les 15 jours**, le portail lui demande d'en choisir un nouveau (expiration automatique, section 31).
- Le portail tourne sur **son propre port : 4001**, différent de l'administration (4000) : les salariés ne peuvent pas accéder aux fonctions RH/IT.
- **Identité visuelle identique** : le portail affiche le même logo que la page d'administration (carré vert + document blanc), dans l'en-tête ET dans l'onglet du navigateur (favicon). Aucun fichier image externe n'est nécessaire : le logo est intégré directement dans la page."""
    if ancien_bloc in texte:
        texte = texte.replace(ancien_bloc, nouveau_bloc)
        print("  [ok] section 6 : bloc « Ce que voit le salarié » réécrit")
    else:
        print("  [info] section 6 : bloc déjà réécrit ou absent")

    # Titre section 6
    ancien_titre = "## 6. Portail Employés — consultation sans connexion (port 4001)"
    nouveau_titre = "## 6. Portail Employés — consultation protégée par CIN + mot de passe (port 4001)"
    if ancien_titre in texte:
        texte = texte.replace(ancien_titre, nouveau_titre)
        print("  [ok] titre section 6 réécrit")

    # Sécurité du portail (section 6) : mention OTP/tokens
    ancien_sec6 = "- Aucune liste générale : seules les fiches **contenant le CIN saisi** sont renvoyées ; le contenu complet des bulletins n'est jamais exposé (métadonnées minimales uniquement)."
    nouveau_sec6 = "- Aucune liste générale : la session est verrouillée sur le CIN connecté ; le contenu complet des bulletins n'est jamais exposé (métadonnées minimales uniquement)."
    if ancien_sec6 in texte:
        texte = texte.replace(ancien_sec6, nouveau_sec6)
        print("  [ok] sécurité section 6 adaptée")

    # Ajout de la section 31 (une seule fois)
    if "## 31. Mots de passe" not in texte:
        if not texte.endswith("\n"):
            texte += "\n"
        texte = texte.rstrip("\n") + "\n" + NOUVELLE_SECTION
        print("  [ok] section 31 ajoutée")
    else:
        print("  [déjà fait] section 31 présente")

    with io.open(CHEMIN, "w", encoding="utf-8") as f:
        f.write(texte)
    print("README mis à jour.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
