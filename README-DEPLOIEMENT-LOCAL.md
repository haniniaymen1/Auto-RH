# Déploiement local du site Fiches de Paie

Guide complet pour installer et faire tourner le site **Fiches de Paie** (fiches de paie Sage + recherche par CIN) sur un ordinateur local : votre PC de bureau, un poste du service RH ou un petit serveur d'entreprise.

> ## NOUVEAUTÉ 15/09/2026 (v2) — nom faux (« COTES »), logo et titre
>
> **1. Détection du NOM corrigée** (fiches scannées / PNG converti en PDF) :
> l'OCR pouvait lire la bande d'en-tête et afficher un nom faux (« COTES »)
> ou partiel (« RIT TEST » au lieu de « EMPLOYE TEST »). Le site détecte
> désormais ces lectures suspectes et relit automatiquement la fiche en
> haute lisibilité, puis garde la meilleure lecture — comme il le faisait
> déjà pour le CIN. Après mise à jour, cliquez **« Redétecter CIN &
> périodes »** pour corriger les fiches déjà importées. La relecture peut
> prendre quelques dizaines de secondes par fiche concernée : c'est normal.
>
> **2. Le nom « Auto-RH » a été retiré** : l'application s'affiche
> désormais « Fiches de Paie » partout (onglet du navigateur, en-tête,
> connexion, portail employés).
>
> **3. Nouvelle icône « fiche »** : l'ancien favicon « Z » est remplacé par
> l'icône fiche verte (identique au logo de l'interface).
>
> Aucune règle de détection existante n'a été retirée : uniquement des ajouts.

> ## NOUVEAUTÉ 15/09/2026 — « données non détectées » : corrigé
>
> Cette version corrige le problème de fiches importées avec **Employé vide / Période vide /
> CIN non détecté**. Toutes les fonctionnalités précédentes sont CONSERVÉES (aucune règle
> retirée, uniquement des ajouts). Après la mise à jour, cliquez simplement sur
> **« Redétecter CIN & périodes »** : les fiches déjà importées sont relues avec les
> nouveaux lecteurs — PNG/JPG, Excel, Word et PDF sont désormais tous relisibles.
>
> 1. **Images PNG / JPG et PDF « image » (PNG converti en PDF, scans)** — quand la 1re
>    passe OCR lit mal le tableau d'en-tête (matricule / nom / N° CIN), une 2de passe
>    « haute lisibilité » (image agrandie 2x + segmentation adaptée aux tableaux) est
>    lancée automatiquement. Le bulletin specimen se lit désormais intégralement.
> 2. **CIN au format « SPEC-0001 » / « SPECIMEN-001 »** — les fiches « tableau » dont
>    l'en-tête de colonne « N° CIN » est sur une ligne et la valeur sur la ligne
>    suivante sont reconnues (recherche exacte OK, y compris via le portail employés).
> 3. **Classeurs Excel « 1 bulletin par ligne »** — une feuille du type
>    `Matricule | Nom et prénom | … | N° CIN | Net à payer` avec 50 employés crée
>    maintenant 50 fiches (1 par ligne), chacune avec ses propres données ; la ligne
>    TOTAL est ignorée. Les classeurs « 1 feuille = 1 bulletin » restent traités
>    comme avant.
> 4. **PDF contenant plusieurs bulletins** — dès que chaque page porte un CIN
>    différent (ex. 50 pages = 50 CIN), le PDF est découpé en 1 fiche par page
>    (fonctionnalité déjà existante, désormais déclenchée aussi pour ces formats).
> 5. **Redétection multi-format** — le bouton « Redétecter CIN & périodes » relit
>    aussi les fiches importées depuis PNG/JPG, XLSX/XLS et DOCX (avant : PDF seul).
>
> Fichiers d'essai fournis : `test-data/bulletins_specimen_50.xlsx` (50 bulletins en
> 1 classeur) et `test-data/bulletins_specimen_50.pdf` (50 bulletins dans 1 PDF).

---

## 1. Prérequis

| Élément | Détail |
|---|---|
| **Node.js 20 ou 22 (LTS)** | Téléchargement : <https://nodejs.org> — cochez « Add to PATH » pendant l'installation. npm est inclus automatiquement. |
| **Le dossier du site** | Les scripts du site (archive `auto-rh-scripts-site-web.zip`) extraits quelque part, par exemple `C:\Fiches de Paie` sous Windows ou `~/auto-rh` sous Linux/Mac. Évitez les dossiers avec des accents dans le nom. |
| **Connexion Internet** | Nécessaire uniquement pendant la première installation (téléchargement des dépendances). Ensuite, le site fonctionne **100 % hors ligne**. |
| **Docker (optionnel)** | Seulement si vous choisissez l'option Docker (partie 4). |

> Aucune autre base de données n'est nécessaire : le site utilise **SQLite** (un simple fichier), déjà inclus.

---

## 2. Option A — Démarrage en 1 clic (recommandé)

Des scripts automatiques font **tout** à votre place : vérification de Node.js, création du fichier `.env`, installation des dépendances, création de la base de données, construction du site, démarrage et ouverture du navigateur.

> Le site comporte **deux interfaces** :
> - **Administration** (RH / Informaticiens, connexion par login) → port **3000**
> - **Portail Employés** (page unique de recherche par CIN, **sans connexion**) → port **3001**
>
> Pour lancer les deux d'un coup : **`DEMARRER-SILENCIEUX-WINDOWS.vbs`** (Windows, sans fenêtre) ou `DEMARRER-TOUT-LINUX-MAC.sh` (Linux/macOS).

### Sous Windows

1. Extraire l'archive du site (clic droit → « Extraire tout »), par exemple dans `C:\Fiches de Paie`.
2. **Double-cliquer sur `DEMARRER-SILENCIEUX-WINDOWS.vbs`** : aucune fenêtre noire n'apparaît, la préparation (installation, base de données, build si nécessaire) puis les deux serveurs (administration + portail) démarrent en arrière-plan, et une petite fenêtre confirme le démarrage.
3. Le site s'ouvre automatiquement sur <http://localhost:3000> (administration) et <http://localhost:3001> (portail). Pour arrêter : `ARRETER-SILENCIEUX-WINDOWS.vbs`.

- La **première exécution** prend 3 à 5 minutes (installation + build). C'est normal, et cela ne se produit qu'une seule fois.
- Les exécutions suivantes démarrent en quelques secondes.

### Sous Linux / macOS

```bash
cd /chemin/vers/auto-rh
bash DEMARRER-LINUX-MAC.sh
```

Le script affiche à la fin l'adresse d'accès local **et** l'adresse réseau (ex. `http://192.168.1.20:3000`) à communiquer à vos collègues.

> Arrêter le site : fermer la fenêtre / appuyer sur `Ctrl+C` dans le terminal.
> Relancer le site : relancer le même script.

---

## 3. Option B — Installation manuelle pas à pas

Utile si vous voulez comprendre chaque étape ou intégrer le site dans vos propres procédures.

### Étape 1 — Installer les dépendances

Ouvrir un terminal **dans le dossier du site** puis :

```bash
npm install
```

Cela télécharge tous les modules nécessaires (Next.js, Prisma, pdf-parse…) dans le dossier `node_modules`.

### Étape 2 — Configurer la base de données

Prisma exige un **chemin absolu** vers le fichier SQLite. Créez un fichier `.env` à la racine du projet contenant une seule ligne :

- **Windows** (exemple) :
  ```
  DATABASE_URL=file:C:/Fiches de Paie/db/custom.db
  ```
  > Utilisez des barres obliques `/` (pas `\`) et le chemin réel de votre dossier.

- **Linux / macOS** (exemple) :
  ```
  DATABASE_URL=file:/home/monuser/auto-rh/db/custom.db
  ```

Puis générez le client et créez la base :

```bash
npx prisma generate
npx prisma db push
```

La commande `db push` crée automatiquement le fichier `db/custom.db` avec les tables `Payslip` et `ImportLog`. Elle est sans danger si vous la relancez.

### Étape 3 — Construire le site (mode production)

```bash
npm run build
```

Cette commande compile le site et prépare un dossier `.next/standalone` autonome. Le script gère aussi la copie des fichiers statiques, sur tous les systèmes d'exploitation.

### Étape 4 — Démarrer le site

```bash
npm run start
```

Le site est alors disponible sur **http://localhost:3000**. Laissez le terminal ouvert pendant l'utilisation ; `Ctrl+C` arrête le serveur.

> Pour utiliser un autre port (si le 3000 est déjà pris) :
> - Windows (PowerShell) : `$env:PORT=4000; npm run start`
> - Linux / macOS : `PORT=4000 npm run start`

### Résumé des commandes

| Commande | Rôle |
|---|---|
| `npm install` | Installer les dépendances (1re fois) |
| `npx prisma generate` | Générer le client de base de données (1re fois) |
| `npx prisma db push` | Créer / mettre à jour la base SQLite |
| `npm run build` | Construire le site (à refaire après chaque modification du code) |
| `npm run start` | Démarrer le serveur de production |

---

## 4. Option C — Docker (avancé)

Si Docker est installé sur la machine, c'est la méthode la plus propre : le site tourne isolé dans un conteneur et redémarre tout seul.

```bash
docker compose up -d
```

C'est tout. **Deux conteneurs** démarrent et redémarrent automatiquement au reboot de la machine (`restart: unless-stopped`) :

- `auto-rh` — l'**administration** RH/IT sur <http://localhost:3000> (connexion par login) ;
- `auto-rh-portail` — le **portail employés** sur <http://localhost:3001> (recherche par CIN sans connexion).

Commandes utiles :

```bash
docker compose logs -f     # voir les logs du site
docker compose down        # arrêter le site
docker compose up -d --build   # reconstruire après une mise à jour du code
```

Les données persistent dans les dossiers `./db` (base SQLite) et `./storage` (PDF importés) du projet, qui sont montés dans le conteneur.

---

## 5. Accès depuis les autres postes du réseau local

Le serveur écoute par défaut sur **toutes les interfaces réseau** (`0.0.0.0`) : vos collègues peuvent donc y accéder depuis n'importe quel navigateur du réseau de l'entreprise, sans rien installer chez eux.

1. Trouvez l'adresse IP du poste qui héberge le site :
   - **Windows** : invite de commandes → `ipconfig` → ligne « Adresse IPv4 » (ex. `192.168.1.20`)
   - **Linux** : `hostname -I`
   - **macOS** : `ipconfig getifaddr en0`
2. Communiquez l'adresse aux collègues : `http://192.168.1.20:3000`
3. Si la page ne s'affiche pas depuis un autre poste, autorisez le port 3000 **et le port 3001** (portail employés) dans le pare-feu :
   - **Windows** : Paramètres → Pare-feu Windows Defender → Règles de trafic entrant → Nouvelle règle → Port → TCP 3000 → Autoriser (puis refaire avec TCP 3001).
   - **Linux** : `sudo ufw allow 3000/tcp` puis `sudo ufw allow 3001/tcp`

> Astuce : demandez à votre administrateur réseau de réserver l'IP du poste (bail DHCP fixe) pour que l'adresse ne change jamais.

---

## 6. Portail Employés — consultation sans connexion (port 3001)

À côté de l'interface d'administration (protégée par login), le site inclut un **portail public destiné à tous les salariés** : une page unique, extrêmement simple, qui ne contient **que la recherche par numéro de CIN**.

### Ce que voit le salarié

- Une seule page : un champ **Numéro CIN** et un bouton **Rechercher** — aucun compte, aucun mot de passe.
- Il saisit son CIN (ex. `09123456`) : toutes les fiches de paie **contenant ce CIN dans leur contenu** s'affichent (période, net à payer, nom).
- Il peut **ouvrir le PDF** ou le **télécharger** directement.
- Le portail tourne sur **son propre port : 3001**, différent de l'administration (3000) : les salariés ne peuvent pas accéder aux fonctions RH/IT.
- **Identité visuelle identique** : le portail affiche le même logo que la page d'administration (carré vert + document blanc), dans l'en-tête ET dans l'onglet du navigateur (favicon). Aucun fichier image externe n'est nécessaire : le logo est intégré directement dans la page.

### Lancer le portail

| Méthode | Commande / fichier |
|---|---|
| Windows (double-clic, silencieux) | `DEMARRER-SILENCIEUX-WINDOWS.vbs` (démarre les deux interfaces) |
| Linux / macOS | `bash DEMARRER-PORTAIL-LINUX-MAC.sh` |
| Les deux interfaces ensemble | `DEMARRER-SILENCIEUX-WINDOWS.vbs` / `bash DEMARRER-TOUT-LINUX-MAC.sh` |
| Manuel (après `npm install`) | `npm run start:portail` ou `node scripts/portail-server.js` |

Le portail lit la **même base** et les **mêmes PDF** que l'administration : toute fiche importée côté RH est immédiatement consultable par le salarié concerné. Changer le port si besoin : variable `PORTAL_PORT` dans le fichier `.env` (3001 par défaut).

### Sécurité du portail

- Aucune liste générale : seules les fiches **contenant le CIN saisi** sont renvoyées ; le contenu complet des bulletins n'est jamais exposé (métadonnées minimales uniquement).
- L'ouverture/téléchargement d'un PDF **revérifie le CIN** dans le contenu de la fiche : impossible d'accéder au fichier sans connaître le CIN du salarié.
- **Limiteur anti-abus** intégré : 30 recherches et 60 fichiers par minute et par adresse IP.
- Le portail n'expose aucune fonction d'administration (import, suppression, comptes…) : ces fonctions restent sur le port 3000 derrière le login RH/IT.
- Réservé au réseau interne de l'entreprise : ne pas exposer le port 3001 directement sur Internet.

> Confidentialité : un salarié ne peut voir que les fiches qui contiennent SON numéro CIN. En cas de CIN identique partagé par erreur dans plusieurs bulletins, corrigez les fiches côté administration.

---

## 7. Où sont stockées vos données ? (sauvegarde)

| Donnée | Emplacement | Contenu |
|---|---|---|
| Base de données | `db/custom.db` | Index de toutes les fiches (CIN, employé, période, net à payer, texte extrait) |
| Fichiers PDF | `storage/payslips/` | Les fiches de paie PDF importées, telles quelles |

**Sauvegarder le site = copier ces deux dossiers.** Pour restaurer : remettez-les en place dans le dossier du site et relancez.

Pour repartir de zéro : supprimez `db/custom.db` et le contenu de `storage/payslips/`, puis relancez le script de démarrage (la base vide est recréée automatiquement).

---

## 8. Connexion et comptes utilisateurs (accès sécurisé)

Le site est **entièrement protégé** : sans connexion, aucune page ni donnée n'est accessible.

### Rôles et permissions (mis à jour — voir aussi la section 30)

- **Rôle RH (Ressources Humaines)** : recherche par CIN, consultation des fiches, import et suppression des bulletins, accès portail (avec modification du nom et prénom des employés), demandes administratives.
- **Rôle IT (Informatique)** : droits **techniques uniquement** — configuration du serveur mail (SMTP) et du QR code / signature électronique (onglet « Paramètres »), et **consultation seule** de la liste des utilisateurs.
- **Superadministrateur (SUPERADMIN)** : tous les droits — gestion complète des comptes RH et IT et de l'ensemble des paramètres.

### Création des comptes

> **La création de compte par code d'activation est SUPPRIMÉE.** Les comptes RH et IT sont créés **exclusivement par le superadministrateur**, depuis l'onglet « Utilisateurs » de l'administration (bouton « Créer un compte »). Le superadministrateur peut aussi activer/désactiver, supprimer, réinitialiser les accès (mot de passe) et changer le rôle d'un compte.

### Gestion des comptes (superadministrateur)

Dans l'onglet « Utilisateurs », le superadministrateur peut :
- **Créer** un compte RH ou IT ;
- **Désactiver** un compte (ex. départ d'un employé) : la personne est déconnectée immédiatement et ne peut plus se connecter ;
- **Réactiver** un compte désactivé ;
- **Supprimer** définitivement un compte ;
- **Réinitialiser le mot de passe** (réinitialisation des accès) ;
- **Changer le rôle** RH ↔ IT.

Le superadministrateur ne peut pas désactiver ni supprimer son propre compte, ni le dernier compte superadministrateur actif. Le rôle IT **consulte** la liste des utilisateurs sans aucun droit d'action ; le rôle RH n'y a pas accès.

### Paramètres de sécurité (.env)

| Variable | Rôle |
|---|---|
| `AUTH_SECRET` | Clé de signature des sessions — générée automatiquement au premier démarrage, ne pas divulguer. La régénérer déconnecte tout le monde. |

Les sessions durent **1 jour** (ou **30 jours** avec « Se souvenir de moi »). Les mots de passe sont stockés hachés (scrypt) — jamais en clair.

---

## 9. Lancer le site automatiquement au démarrage du PC

### Windows — dossier « Démarrage »

1. Double-cliquez simplement sur `DEMARRER-SILENCIEUX-WINDOWS.vbs` une première
   fois : le raccourci « Auto-RH - Demarrage silencieux » est créé
   **automatiquement** dans le dossier Démarrage (aucune action manuelle, la
   création est vérifiée et refaite silencieusement à chaque lancement —
   section 30).
2. (Facultatif) Appuyez sur `Win + R`, tapez `shell:startup`, Entrée pour voir
   le raccourci créé, ou pour le supprimer si vous ne souhaitez plus le
   démarrage automatique.
3. Le site démarrera (réduit) à chaque ouverture de session.

### Linux — service systemd

Créez `/etc/systemd/system/auto-rh.service` :

```ini
[Unit]
Description=Fiches de Paie - Fiches de paie Sage
After=network.target

[Service]
Type=simple
User=VOTRE_UTILISATEUR
WorkingDirectory=/home/VOTRE_UTILISATEUR/auto-rh
ExecStart=/usr/bin/node scripts/start-prod.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Puis :

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now auto-rh
sudo systemctl status auto-rh   # vérifier que c'est actif
```

### macOS — launchd (résumé)

Créez `~/Library/LaunchAgents/com.auto-rh.plist` avec un `ProgramArguments` pointant vers `node scripts/start-prod.js` et `WorkingDirectory` vers le dossier du site, puis chargez-le avec `launchctl load`.

> La fenêtre/le service reste en arrière-plan : le site est simplement disponible en permanence sur http://localhost:3000.

---

## 10. Dépannage (FAQ)

**« Node.js n'est pas reconnu » / le script demande d'installer Node**
Node.js n'est pas installé ou pas dans le PATH. Réinstallez-le depuis <https://nodejs.org> en laissant toutes les cases par défaut, puis fermez/rouvrez le terminal et relancez.

**Le port 3000 est déjà utilisé**
Démarrez sur un autre port : `PORT=4000 npm run start` (Linux/Mac) ou `$env:PORT=4000; npm run start` (PowerShell). L'adresse devient http://localhost:4000.

**Le port 3001 (portail) est déjà utilisé**
Mettez `PORTAL_PORT=3002` dans le fichier `.env` puis relancez le portail.

**Le salarié voit « Aucune fiche de paie trouvée » alors que sa fiche existe**
Le CIN saisi ne correspond pas exactement à celui imprimé dans le PDF (faute de frappe, CIN absent du bulletin). Vérifiez dans l'administration (port 3000) que le bulletin contient bien ce CIN dans son contenu.

**Erreur `Error: Environment variable not found: DATABASE_URL`**
Le fichier `.env` est absent ou contient un chemin relatif. Il doit contenir un **chemin absolu** (partie 3, étape 2). Les scripts de démarrage créent ce fichier automatiquement.

**La page s'ouvre mais affiche une erreur 500**
La base n'existe pas ou le `.env` pointe vers un mauvais chemin. Relancez `npx prisma db push` puis redémarrez.

**« npm install » échoue ou reste bloqué**
Vérifiez la connexion Internet / le proxy d'entreprise. Réessayez avec : `npm install --no-audit --no-fund`. En cas d'erreur persistante, supprimez le dossier `node_modules` et relancez.

**Un PDF importé n'apparaît pas dans la recherche**
Le PDF est probablement **scanné en image** (sans couche texte) : la recherche par CIN ne peut pas lire son contenu. Ce cas est signalé à l'import (« Aucun texte extractible »). Utilisez des fiches exportées en PDF texte depuis Sage.

**Le site est lent après plusieurs milliers de fiches**
Tout est normalement fluide (la recherche est indexée). En cas de besoin, sauvegardez puis archivez les anciennes années : supprimez les fiches concernées depuis l'onglet « Toutes les fiches ».

**Comment mettre à jour le site après une modification du code ?**
Relancez `npm run build` puis redémarrez le serveur (`npm run start` ou le script de démarrage). Les données (base + PDF) ne sont pas touchées par le build.

---

**« Erreur serveur » dans la configuration SMTP et IMAP (panneau Envoi d'e-mails)**
Trois causes possibles — le panneau affiche désormais le DÉTAIL de l'erreur et la solution (v0.2.167). Pour un diagnostic complet en une commande : `node scripts/diagnostic-config-email.js` (vérifie .env, base, clé de chiffrement, dépendances, réseau, SMTP réel, IMAP réel).
1. *Clé de chiffrement désynchronisée* (base illisible, souvent accompagnée d'échecs de connexion) : le `.env` a été régénéré alors que la base était chiffrée avec l'ancienne clé. Réparez avec : `node scripts/reparer-cle-chiffrement.js` (sauvegarde automatique, puis rechiffrement avec la clé actuelle du .env), puis redémarrez.
2. *Base pas à jour* : relancez le lanceur habituel (il exécute `prisma db push`), ou `npx prisma db push` puis redémarrez.
3. *Serveur SMTP/IMAP injoignable depuis ce réseau* (port bloqué) : le test affiche l'étape exacte qui échoue ; ouvrez les ports sortants 465 (SMTP SSL) et 993 (IMAP SSL), ou essayez un autre réseau. Sonde réseau seule : `node scripts/sonde_connectivite_email.js`.

**Le site tourne encore sur l'ANCIENNE version après extraction d'une mise à jour (ZIP)**
Corrigé en v0.2.167 : les lanceurs reconstruisent automatiquement le site quand la version du package change (`scripts/verifier-build-a-jour.js`). Sur une installation antérieure, forcez une fois : `npx next build && node scripts/copy-standalone-assets.js` puis redémarrez.

**« Couldn't find any `pages` or `app` directory » pendant la construction du site (v0.2.168)**
Cette erreur de Next.js signifie presque toujours que **l'extraction du ZIP est incomplète** : le dossier `src\` (ou une partie) est absent — extraction arrêtée en cours, antivirus ayant mis des fichiers en quarantaine, déplacement manuel de fichiers, ou ZIP reconstitué depuis plusieurs e-mails **sans vérification du MD5**. Depuis la v0.2.168, le lanceur contrôle automatiquement l'extraction **avant** le build (`scripts/verifier-extraction.js` + `MANIFEST-LIVRAISON.txt` embarqués : présence **et taille exacte** de chaque fichier) et affiche la liste des fichiers manquants avec la marche à suivre. Remède : ré-extrayez **tout** le contenu du ZIP dans le dossier (remplacer les fichiers), en vérifiant d'abord le MD5 du fichier ZIP si celui-ci a été reconstitué depuis des parties e-mail (`certutil -hashfile <fichier.zip> MD5` — valeur attendue dans l'e-mail de livraison), puis relancez le lanceur.

## 11. Checklist rapide

- [ ] Node.js 20+ installé (`node -v` affiche `v20…` ou `v22…`)
- [ ] Double-clic sur `DEMARRER-SILENCIEUX-WINDOWS.vbs` (ou `bash DEMARRER-LINUX-MAC.sh`)
- [ ] Le navigateur ouvre http://localhost:3000
- [ ] Import de quelques fiches PDF depuis l'onglet « Importer »
- [ ] Recherche d'un CIN depuis l'onglet « Recherche CIN » → les fiches correspondantes s'affichent
- [ ] Portail employés démarré (`DEMARRER-PORTAIL-*.bat/.sh`) : recherche d'un CIN sur http://localhost:3001 → fiches affichées
- [ ] (Optionnel) Adresses `http://IP-du-poste:3000` (RH/IT) et `:3001` (salariés) communiquées + ports 3000 et 3001 autorisés dans le pare-feu

---

## 12. Dépannage portail : « Fichier PDF introuvable sur le serveur »

Ce message du portail employés (port 3001) signifie que **la fiche existe bien
dans la base** (le CIN a été trouvé), mais que le **dossier des PDF ne contient
pas le fichier** recherché. Cela arrive quand le portail n'est pas lancé depuis
le même dossier que le site d'administration (copie séparée, dossier déplacé,
site démarré depuis un autre répertoire).

### 12.1 Cause racine découverte et corrigée (IMPORTANT — lisez ceci)

Le serveur de production Next.js « standalone » (`.next/standalone/server.js`)
**change lui-même de répertoire courant** au démarrage
(`process.chdir(__dirname)`). Résultat avec les versions précédentes : les PDF
importés via l'administration (port 3000) étaient rangés dans
**`.next\standalone\storage\payslips\`** au lieu de **`storage\payslips\`**.
La base (db\custom.db) n'était pas touchée (chemin absolu), d'où des fiches
visibles mais leurs PDF introuvables par le portail.

**Le correctif (appliqué dans cette version) :**
- les scripts de démarrage définissent désormais la variable
  `AUTO_RH_STORAGE_DIR` (chemin absolu du dossier des PDF) ;
- le site (administration) enregistre et relit toujours les PDF dans le dossier
  canonique `<racine du projet>\storage\payslips` (`src/lib/storage-dir.ts`),
  quel que soit son répertoire courant ;
- à la lecture, l'administration ET le portail essayent **plusieurs dossiers**,
  y compris l'ancien emplacement `.next\standalone\storage\payslips` : vos
  fiches importées avec l'ancienne version restent donc accessibles, **sans
  rien réimporter** ;
- en dernier recours, le portail parcourt récursivement le dossier du projet
  (hors `node_modules`) pour retrouver un PDF égaré, et garde le résultat en
  cache.

**Que faire côté portail (suffisant pour débloquer immédiatement) :**
1. Remplacez `scripts\portail-server.js` par la nouvelle version (fournie dans
   ce ZIP) ;
2. Redémarrez les serveurs (`DEMARRER-SILENCIEUX-WINDOWS.vbs`) ;
3. Vos anciennes fiches (PDF dans `.next\standalone\storage\payslips`) sont de
   nouveau téléchargeables. Aucun rebuild du site n'est nécessaire pour ça.

**Que faire côté administration (recommandé, une fois) :**
1. Fermez la fenêtre du site (port 3000) ;
2. Supprimez le dossier `.next` du projet ;
3. Relancez `DEMARRER-SILENCIEUX-WINDOWS.vbs` (le build se refait, 2 à 4 minutes) ;
4. Les prochains imports seront rangés directement dans
   `storage\payslips\`, à l'emplacement standard (sauvegarde simple).

**Le portail cherche maintenant les PDF dans plusieurs dossiers, dans cet ordre :**
1. la variable d'environnement `STORAGE_DIR` si elle est définie ;
2. la variable d'environnement `AUTO_RH_STORAGE_DIR` (définie par les scripts
   de démarrage de cette version) ;
3. `<dossier du portail>/storage/payslips` (comportement d'origine, conservé) ;
4. `<répertoire de lancement>/storage/payslips` ;
5. `<dossier parent du portail>/storage/payslips` ;
6. la racine déduite de `DATABASE_URL` (ex. `file:C:/auto-rh/db/custom.db`)
   suivie de `/storage/payslips` — le dossier du site est ainsi retrouvé même
   si le portail est lancé depuis ailleurs ;
7. `<dossier du portail>/.next/standalone/storage/payslips` (PDF rangés par
   l'ancien bug) ;
8. `<répertoire de lancement>/.next/standalone/storage/payslips` ;
9. en dernier recours : recherche récursive dans tout le dossier du projet
   (hors `node_modules`, `.git`).

**Comment diagnostiquer :**
- Au démarrage, la console du portail affiche la liste des dossiers examinés et
  le nombre de PDF trouvés dans chacun.
- `http://localhost:3001/api/health` renvoie le détail (`storage` : chaque
  dossier, s'il existe, et son nombre de PDF).
- En cas d'échec, le message d'erreur liste les chemins exacts essayés.

**Solutions :**
- Lancez le portail depuis le MÊME dossier que le site (les scripts
  `DEMARRER-PORTAIL-*.bat/.sh` fournis le font déjà).
- Ou définissez `STORAGE_DIR` (ou `AUTO_RH_STORAGE_DIR`) vers le dossier
  `storage\payslips` du site. Exemple Windows :
  `set STORAGE_DIR=C:\auto-rh\storage\payslips` avant de lancer
  `node scripts\portail-server.js`.
- Si vous avez déplacé le projet, déplacez aussi le dossier `storage\payslips`
  (et `db\custom.db`) avec lui.


## 13. Sécuriser le dossier des fiches (accès local au disque)

**Réponse courte à la question « `storage\payslips` est-il exposé ? » : NON,
pas via le réseau.** Vos fiches importées (`storage\payslips`), votre base
(`db\custom.db`) et votre clé secrète (`.env`) ne sont **jamais** accessibles
par une simple URL : le dossier est en dehors du dossier `public` du site,
chaque lecture passe par une route API authentifiée (login RH/IT sur 3000,
CIN + code OTP sur 3001), les noms de fichiers sont imprévisibles, et le
portail n'expose que sa page de connexion et son API (tout le reste → 404).

**Le risque réel restant est LOCAL** : une personne ayant accès physique au
poste (ou un autre compte Windows sur la même machine) peut ouvrir le dossier
dans l'explorateur.

**Protection AUTOMATIQUE depuis le 17/09/2026 (section 29)** : à chaque
démarrage des serveurs, le site verrouille lui-même `.env`, `db`, `storage`
(dont `storage\payslips`), `logs` et `backups` — **sans aucun script à
lancer**. Vous n'avez donc **rien à faire** : la protection s'applique
seule, de façon silencieuse, réversible et sans risque pour le site.

**Protection manuelle (facultative, si vous voulez vérifier ou forcer)** —
outils natifs du système, en invite de commandes ouverte dans le dossier du
site. **Windows** :
`icacls "storage\payslips" /inheritance:r /grant:r "%USERNAME%:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F"`
idem pour `db`, puis `icacls ".env" /inheritance:r /grant:r "%USERNAME%:F" "*S-1-5-18:F" "*S-1-5-32-544:F"`
(seuls votre compte, les Administrateurs et le compte Système gardent
l'accès) ; retour arrière : `icacls "<élément>" /inheritance:e`.
**Linux / macOS** : `chmod 700 storage storage/payslips db` puis
`chmod 600 db/*.db .env`. Pour afficher l'état appliqué automatiquement :
`node scripts/securiser-auto.js --etat`.

## 14. Chiffrement AES-256 des fiches sur le disque (optionnel mais recommandé)

Le site intègre un **chiffrement AES-256-GCM** (standard international) du
dossier `storage\payslips` :

- chaque fiche importée est **chiffrée automatiquement** à l'enregistrement ;
- sur le disque, un fichier chiffré n'est **plus un PDF** : c'est un blob
  brouillé (en-tête `PAIESAGE1`), illisible sans la clé ;
- le site d'administration et le portail employés **déchiffrent à la volée** :
  les utilisateurs autorisés ne voient AUCUNE différence ;
- les fiches importées AVANT l'activation restent compatibles ; l'outil de
  migration les chiffre en une commande ;
- la clé est un secret aléatoire de 256 bits stocké dans le `.env`
  (ligne `AUTO_RH_STORAGE_KEY`), généré automatiquement au premier chiffrement.

**⚠ RÈGLE D'OR : sauvegardez le fichier `.env`** (clé USB en lieu sûr…).
Sans ce fichier, les fiches chiffrées sont mathématiquement **irrécupérables**.

**Procédure** : rien à faire — chaque fiche importée est **chiffrée
automatiquement** à l'enregistrement, et la migration initiale des fiches
existantes a déjà été effectuée. Aucun lanceur de chiffrement n'est inclus
dans l'archive livrée (retrait sur demande, 16/09/2026) ; l'outil reste
fourni pour l'administrateur dans `scripts\chiffrer-storage.js`, à lancer
dans un terminal : `node scripts/chiffrer-storage.js` (options `--verifier`
pour vérifier l'état, `--dechiffrer` pour un retour arrière), sous Windows
comme sous Linux/macOS. Après une opération manuelle de chiffrement ou de
déchiffrement, redémarrez site et portail (`DEMARRER-SILENCIEUX-WINDOWS.vbs`).

**Récapitulatif des protections** (du réseau vers le disque) :
1. accès réseau : connexion obligatoire (login RH/IT sur 3000, CIN + OTP sur 3001) ;
2. verrouillage NTFS/permissions (section 13) ;
3. chiffrement AES-256 (cette section) ;
4. noms de fichiers aléatoires.

## 15. Découpage automatique des PDF multi-fiches (1 fiche = 1 employé)

**Nouveauté (16/09/2026)** : vous pouvez importer un PDF contenant **plusieurs
pages, chaque page étant la fiche de paie d'un employé différent** (ou plusieurs
fiches du même employé). À l'import, l'application :

1. **lit chaque page** et détecte le **CIN** inscrit dessus (clé de
   correspondance employé ↔ fiche) ;
2. **découpe physiquement le PDF** en fiches individuelles : chaque fiche
   reçoit son **propre fichier PDF** (pages 1 à N regroupées par CIN, annexes
   comprises) ;
3. **affecte chaque fiche à son employé** dans la base (CIN, nom, période,
   net à payer, matricule) ;
4. supprime le document complet une fois toutes les fiches découpées
   (aucune page n'est perdue : les pages sans CIN restent rattachées à la
   fiche qui les précède).

**Résultat côté employé** : dans le portail (CIN + code OTP), l'employé qui
consulte « sa » fiche ne reçoit plus le document complet — il ne reçoit que
**SA fiche de paie, au format PDF**, prête à télécharger. Un employé présent
sur plusieurs pages du fichier (plusieurs mois) retrouve bien TOUTES ses
fiches, chacune dans son propre PDF.

**Affichage côté administration** : chaque fiche découpée apparaît avec un nom
clair, par exemple `bulletins_janvier (page 3).pdf` (page du document
original). Le message d'import confirme : « 50 fiches individuelles créées —
le PDF a été divisé par fiche de paie (affectation par CIN, un PDF par
employé) ».

**Robustesse (aucune régression possible)** : si un PDF résiste au découpage,
l'import replie automatiquement sur le comportement historique (fichier
complet partagé, comme avant) — la fiche est toujours importée. La
suppression d'une fiche ne casse plus les fiches voisines qui partageraient
encore un fichier (garde ajoutée).

**Fiches importées AVANT cette mise à jour** (fichier partagé par plusieurs
employés) : lancez l'outil de migration **une seule fois** en terminal,
ouvert dans le dossier du site — `node scripts\scinder-pdfs-multipages.js --verifier`
pour l'état puis `node scripts\scinder-pdfs-multipages.js` pour scinder
(lanceur .bat retiré de l'archive, section 28). Les originaux
sont conservés dans `storage/payslips/_originaux/` (réversibilité) — vous
pourrez les supprimer après vérification. Redémarrez ensuite le site et le
portail (`DEMARRER-SILENCIEUX-WINDOWS.vbs`). Les fiches découpées restent chiffrées
AES-256 (section 14) et le portail OTP continue de fonctionner à l'identique.

## 16. Découpage automatique des classeurs Excel multi-feuilles (1 fiche = 1 employé)

**Nouveauté (16/09/2026)** : vous pouvez importer un **classeur Excel**
(`.xlsx`, `.xlsm`, `.xls`) contenant **plusieurs feuilles (onglets), chaque
feuille étant la fiche de paie d'un employé** — c'est le cas des exports
« 1 bulletin par feuille ». À l'import, l'application :

1. **lit chaque feuille** et détecte le **CIN** inscrit dessus (clé de
   correspondance employé ↔ fiche — les mêmes règles de détection que les
   PDF s'appliquent : CIN, nom, période, net à payer, matricule) ;
2. **découpe physiquement le classeur** en fiches individuelles : chaque
   fiche reçoit son **propre fichier Excel** contenant uniquement SA feuille,
   copiée **haute fidélité** (valeurs, formules, polices, couleurs, bordures,
   fusions de cellules, largeurs de colonnes, images/logos) ;
3. **affecte chaque fiche à son employé** dans la base ;
4. supprime le classeur complet une fois toutes les fiches découpées (les
   feuilles sans CIN — annexes — restent rattachées à la fiche qui les
   précède, exactement comme pour les PDF).

**Cas « 1 bulletin par LIGNE »** : si une feuille est un **tableau avec une
ligne par employé** (plusieurs CIN dans la MÊME feuille), la découpe par
feuille est impossible sans emporter les salaires des autres. L'application
génère alors automatiquement pour chaque employé une **fiche Excel
individuelle étiquetée** (« Libellé | Valeur » : Matricule, N° CIN, Net à
payer, période…) reconstituée depuis SES données.

**Résultat côté employé** : dans le portail (CIN + code OTP), l'employé qui
consulte « sa » fiche reçoit **son propre fichier Excel individuel**, prête à
télécharger — jamais le classeur complet.

**Affichage côté administration** : chaque fiche découpée apparaît avec un nom
clair, par exemple `fiches_aout (feuille 2).xlsx` ou
`fiches_aout (feuille 2, ligne 1).xlsx` (feuille/ligne du classeur original).
Le message d'import confirme : « 3 fiches individuelles créées — le classeur
Excel a été divisé par fiche de paie (affectation par CIN, un fichier Excel
par employé) ».

**Robustesse (aucune régression possible)** : si un classeur résiste au
découpage (ancien format `.xls` illisible par le coupeur, structure atypique…),
l'import replie automatiquement sur le comportement historique (fichier complet
partagé, comme avant) — la fiche est toujours importée. Un classeur mono-fiche
(une seule feuille, un seul CIN) n'est **pas** découpé : il est importé tel
quel, comme avant. Les fichiers individuels sont **chiffrés AES-256** comme
toute écriture du stockage (section 14).

**Classeurs importés AVANT cette mise à jour** (classeur partagé par plusieurs
employés) : lancez l'outil de migration **une seule fois** en terminal,
ouvert dans le dossier du site — `node scripts\scinder-excel-multipages.js --verifier`
pour l'état puis `node scripts\scinder-excel-multipages.js` pour scinder
(lanceur .bat retiré de l'archive, section 28). Le script
localise le CIN de chaque fiche dans les feuilles (aucune ré-détection), coupe
le classeur, chiffre chaque fiche individuelle et déplace les originaux dans
`storage/payslips/_originaux/` (réversibilité). Les classeurs « 1 bulletin par
ligne » sont signalés non découpables par ce script : **réimportez-les** après
la mise à jour, le site générera les fiches étiquetées individuelles.
Redémarrez ensuite le site et le portail (`DEMARRER-SILENCIEUX-WINDOWS.vbs`).

## 17. Découpage automatique des documents Word multi-pages (1 fiche = 1 employé)

**Nouveauté (16/09/2026)** : vous pouvez importer un **document Word** (`.docx`)
contenant **plusieurs pages, chaque page étant la fiche de paie d'un employé** —
un employé peut d'ailleurs avoir plusieurs fiches dans le même document. À
l'import, l'application :

1. **reconnaît les pages** du document : sauts de page (Ctrl+Entrée), sauts de
   section, marqueurs de rendu de Word ; à défaut, chaque **nouveau CIN** ouvre
   une nouvelle fiche (même règle que le découpage texte historique) ;
2. **lit chaque page** et détecte le **CIN** inscrit dessus (clé de
   correspondance employé ↔ fiche — les mêmes règles de détection que les PDF
   s'appliquent : CIN, nom, période, net à payer, matricule) ;
3. **découpe physiquement le document** en fiches individuelles : chaque fiche
   reçoit son **propre fichier Word** contenant uniquement SES pages,
   reconstruit par **copie de l'archive originale** (styles, polices,
   tableaux, images/logos, en-têtes et mise en page conservés) ;
4. **affecte chaque fiche à son employé** dans la base ;
5. supprime le document complet une fois toutes les fiches découpées (les
   pages sans CIN — préambule, annexes — restent rattachées à la fiche qui
   les précède, exactement comme pour les PDF et l'Excel).

**Sécurité (confidentialité)** : une page contenant **plusieurs CIN
différents** (deux fiches sans saut sur la même page) ne peut pas être recopiée
dans un fichier individuel sans mélanger deux employés — l'import replie alors
automatiquement sur le comportement historique (document complet partagé). De
même, un document **mono-fiche** (un seul CIN) n'est **pas** découpé : il est
importé tel quel, comme avant.

**Résultat côté employé** : dans le portail (CIN + code OTP), l'employé qui
consulte « sa » fiche télécharge **son propre fichier Word individuel** —
jamais le document complet. Les fichiers individuels sont **chiffrés AES-256**
comme toute écriture du stockage (section 14).

**Affichage côté administration** : chaque fiche découpée apparaît avec un nom
clair, par exemple `bulletins_aout (page 2).docx`. Le message d'import
confirme : « 3 fiches individuelles créées — le document Word a été divisé par
fiche de paie (affectation par CIN, un fichier Word par employé) ».

**Robustesse (aucune régression possible)** : si un document résiste au
découpage (fichier illisible, structure atypique…), l'import replie
automatiquement sur le comportement historique — la fiche est toujours
importée.

**Documents importés AVANT cette mise à jour** (document partagé par plusieurs
employés) : lancez l'outil de migration **une seule fois** en terminal,
ouvert dans le dossier du site — `node scripts\scinder-docx-multipages.js --verifier`
pour l'état puis `node scripts\scinder-docx-multipages.js` pour scinder
(lanceur .bat retiré de l'archive, section 28). Le script localise le CIN de chaque fiche dans les pages
(aucune ré-détection), coupe le document, chiffre chaque fiche individuelle et
déplace les originaux dans `storage/payslips/_originaux/` (réversibilité).
Redémarrez ensuite le site et le portail (`DEMARRER-SILENCIEUX-WINDOWS.vbs`).

---

## 18. CIN tunisien à 9 chiffres (carte biométrique) — bulletins « Tunis Call Center »

**Nouveauté (16/09/2026)** : la détection du numéro de CIN gère désormais les
**CIN tunisiens récents à 9 chiffres** (carte biométrique, ex. `140000911`),
imprimés sur les nouveaux bulletins de paie (format « Tunis Call Center »).

### Le problème corrigé

Sur ces bulletins, le **N° CIN** (9 chiffres) est imprimé dans un tableau sous
l'en-tête de colonne « N° CIN », à côté du **N° CNSS** (8 chiffres suivi d'une
clé, ex. `17700137 - 04`). Avant cette correction, l'import retenait le
**N° CNSS à la place du CIN** — ou tronquait le CIN à 8 chiffres
(`14000091` au lieu de `140000911`) : la fiche était alors rattachée à un
mauvais « CIN » ou restait sans affectation exploitable.

### Ce qui est fait désormais (tous formats : Word, Excel, PDF, images)

1. **CIN à 9 chiffres reconnu** partout : après un libellé « N° CIN » sur la
   même ligne (`N° CIN : 140000911`), avec séparateurs (`14 0000 911`,
   `140000-911`…), et **sous l'en-tête de colonne « N° CIN »** même quand
   l'en-tête et la valeur sont éloignés de plusieurs lignes (tableaux Word/Excel) ;
2. **le N° CNSS n'est plus retenu à la place** : l'arbitrage « contexte de
   tableau » — déjà appliqué aux PDF scannés — s'applique aussi aux imports
   **Word et Excel** (un N° CNSS détecté comme CIN est remplacé par le CIN lu
   sous l'en-tête « N° CIN » ; un vrai CIN n'est jamais écrasé) ;
3. **le découpage automatique** (Word multi-pages, Excel multi-feuilles)
   reconnaît les lignes de CIN à 9 chiffres : chaque fiche est correctement
   affectée à son employé par CIN.

### Fiches importées avant la mise à jour ?

Les fiches importées avec un mauvais CIN (le N° CNSS) peuvent être réparées
**sans réimporter** : onglet administrateur → **Redétection** — l'application
relit le contenu de chaque fiche et applique les nouvelles règles (le CIN
devient `140000911`, le N° CNSS n'est plus retenu). Sinon, réimportez
simplement le fichier source : le découpage/affectation s'applique de nouveau.

### Vérifications

- Import du bulletin réel « Tunis Call Center » : CIN détecté = `140000911`
  (plus le N° CNSS) ; nom, période et net à payer extraits.
- Document Word de 3 bulletins (CIN 9 chiffres) : 3 fiches individuelles
  créées, chacune affectée à son employé ; le portail ne montre à l'employé
  connecté que SES fiches (isolation vérifiée).
- Redétection : une fiche simulée « avant-fix » (CIN = N° CNSS) est réparée
  automatiquement ; les 107 fiches existantes restent inchangées.
- Régressions complètes : portail OTP 54/54, liste 107 fiches / 0 sans CIN.

## 19. Classeurs « 1 bulletin vertical par feuille » (ex. Bulletins_de_paie_50_exemples)

**Nouveauté (16/09/2026)** : correction du signalement « les 50 pages dans le
fichier Excel ne sont pas séparées » pour les classeurs du type
`Bulletins_de_paie_50_exemples.xlsx` : **50 feuilles, chaque feuille étant UN
bulletin complet disposé verticalement** (en-tête « Matricule | Nom et Prénom |
Fonction | Département », puis état civil avec « N° CIN », puis les rubriques
Présence, Salaire de base… jusqu'au Net à payer).

### Le problème corrigé

Chaque feuille-bulletin **ressemblait** à un tableau « 1 bulletin par ligne »
(la ligne « Matricule | Nom et Prénom | … » ressemble à un en-tête de tableau)
: l'application la **cassait en ~20 fragments sans CIN** (un fragment par
ligne du bulletin) — le regroupement par CIN échouait et **tout le classeur
restait collé en UNE seule fiche** (repli historique), d'où des fiches non
séparées malgré la fonctionnalité de découpage.

### Ce qui est fait désormais

1. **Reconnaissance du bulletin vertical** : une feuille n'est plus explosée
   en lignes que si son en-tête possède une **colonne d'identité** (« N° CIN »
   ou « N° CNSS ») — condition nécessaire pour rattacher chaque ligne à un
   employé. Sans colonne d'identité, la feuille reste **entière** (1 feuille
   = 1 fiche candidate).
2. **Découpage physique conservé** : les 50 feuilles sont découpées en
   **50 fichiers Excel individuels** chiffrés (AES-256), un par employé, chacun
   contenant **sa seule feuille** copiée haute fidélité, affecté par CIN
   (`SPEC-0001` … `SPEC-0050` sur le fichier d'exemple) ; le classeur complet
   est ensuite supprimé du stockage.
3. **Isolation portail vérifiée** : l'employé qui se connecte avec son CIN
   reçoit exactement SA fiche (1 fichier = 1 feuille = 1 employé).
4. **Aucune régression** : les VRAIS tableaux « 1 bulletin par ligne »
   (en-tête avec colonnes « N° CIN » / « N° CNSS », ex.
   `bulletins_specimen_50.xlsx`) continuent d'être découpés exactement comme
   avant ; la suite portail OTP reste 54/54.

### Limite connue (inchangée)

Un classeur **mêlant** une feuille annexe AVANT un tableau « 1 bulletin par
ligne » (ex. `bulletins_specimen_50.xlsx` avec ses feuilles « Parametres » +
« Bulletins ») reste en **repli historique** : les fiches sont bien créées et
affectées par CIN (données correctes côté portail), mais partagent le fichier
complet au lieu de fichiers individuels — le découpage physique refuse de
scinder ce cas ambigu par prudence de confidentialité (l'annexe ne peut être
ni jetée ni attribuée à un seul employé). Les fiches concernées peuvent être
réimportées après suppression de la feuille annexe pour obtenir des fichiers
individuels.

## 20. Suppression multiple des fiches + tableau de bord épuré

**Nouveauté (16/09/2026)** : deux évolutions du portail d'administration à la
demande de l'administrateur.

### 1. Suppression multiple (onglet « Toutes les fiches »)

1. **Cochez** les fiches à supprimer : une nouvelle colonne de cases à cocher
   est disponible dans le tableau (desktop) et sur chaque carte (mobile), avec
   une case « tout sélectionner » dans l'en-tête (s'applique aux fiches
   **filtrées** — combinez avec le champ de filtre pour cibler, par exemple,
   toutes les fiches d'un import) ;
2. un bandeau de sélection apparaît : compteur « N sélectionnée(s) », bouton
   **Annuler** et bouton rouge **« Supprimer la sélection (N) »** ;
3. la suppression demande une **confirmation** (action irréversible) puis
   supprime en UNE requête les fiches cochées : **enregistrements + fichiers
   sur le disque** (même logique que la suppression unitaire, inchangée) ;
4. un récapitulatif détaillé est affiché : N supprimée(s) — N introuvable(s)
   — N échec(s).

Technique : nouvelle route **POST /api/payslips/delete-many**
(`{ ids: [...] }`, 1 à 1000 fiches par appel, protégée par session admin).
La suppression unitaire existante reste disponible sur chaque ligne.

### 2. Carte « Employés » retirée du tableau de bord

La carte statistique « **Employés — identifiés** » n'est plus affichée sur la
page d'accueil : le tableau de bord montre désormais **3 cartes** (Fiches de
paie, CIN détectés, Dernier import). L'API `/api/stats` reste inchangée (le
champ continue d'être calculé pour d'éventuels usages internes) — seul
l'affichage est retiré.

## 21. Fonctionnement en arrière-plan (sans fenêtre CMD)

**Nouveauté (16/09/2026)** : les deux serveurs peuvent désormais tourner
**entièrement en arrière-plan, sans aucune fenêtre noire visible** — fini les
deux fenêtres CMD qui devaient rester ouvertes en permanence.

### Utilisation quotidienne (4 fichiers à double-clic)

| Fichier                          | Rôle                                                                   |
|----------------------------------|------------------------------------------------------------------------|
| `DEMARRER-SILENCIEUX-WINDOWS.vbs`  | Démarre les 2 serveurs **en arrière-plan** (aucune fenêtre), ouvre le navigateur et affiche une confirmation. Crée aussi **automatiquement** le raccourci de démarrage à l'allumage du PC (section 30) |
| `ARRETER-SILENCIEUX-WINDOWS.vbs`   | Arrête proprement les 2 serveurs (confirmation par fenêtre)            |
| `ETAT-SILENCIEUX-WINDOWS.vbs`      | Affiche l'état (en fonctionnement / arrêté) dans une petite fenêtre    |
| `JOURNAUX-SILENCIEUX-WINDOWS.vbs`  | Ouvre le dossier `logs\` (journaux techniques en cas de problème)      |

Tout se passe comme avant (mêmes adresses, mêmes données) :

- **Administration** : `http://localhost:3000` (login requis) ;
- **Portail employés** : `http://localhost:3001` (CIN + code OTP).

### Ce qui se passe en coulisse

1. `DEMARRER-SILENCIEUX-WINDOWS.vbs` lance (sans fenêtre, style masqué) la
   tâche `PREPARER-AUTO-RH-SILENCIEUX.bat`, qui refait exactement les mêmes
   vérifications que le démarrage complet : fichier `.env` (secret conservés),
   `npm install` et `prisma` si nécessaire, construction du site si nécessaire ;
2. puis il appelle le moteur `scripts/auto-rh.js` qui démarre les deux
   serveurs en **processus détachés et masqués** (Windows : `windowsHide`) ;
3. les PIDs sont enregistrés dans `logs\auto-rh-processus.json` pour permettre
   un arrêt propre, et les consoles sont conservées dans
   `logs\auto-rh-administration.log` et `logs\auto-rh-portail.log`.

### Points importants

- **Première installation** : la construction peut prendre 3 à 5 minutes sans
  qu'aucune fenêtre n'apparaisse — une popup confirme la fin (ou consultez les
  journaux). Les démarrages suivants prennent quelques secondes.
- Le démarrage et l'arrêt sont **idempotents** : double-cliquer deux fois sur
  « Démarrer » ne crée pas de doublon ; arrêter alors que rien ne tourne est
  sans effet.
- **Le ZIP livré ne contient que les lanceurs silencieux** (aucune fenêtre CMD) :
  `DEMARRER-SILENCIEUX-WINDOWS.vbs` (qui crée aussi automatiquement le
  raccourci de démarrage à l'allumage — section 30),
  `ARRETER-SILENCIEUX-WINDOWS.vbs`,
  `ETAT-SILENCIEUX-WINDOWS.vbs`, `JOURNAUX-SILENCIEUX-WINDOWS.vbs`,
  la tâche technique
  `PREPARER-AUTO-RH-SILENCIEUX.bat` (appelée par le démarrage silencieux)
  et l'utilitaire interactif `CREER-SUPERADMIN-WINDOWS.bat` (section 25).
  Les anciens `.bat` visibles (`DEMARRER-WINDOWS.bat`, `DEMARRER-TOUT-WINDOWS.bat`,
  `DEMARRER-PORTAIL-WINDOWS.bat`) **ne sont plus dans l'archive** — ils restent
  présents dans le dépôt de développement pour qui préfère une console. Les
  lanceurs du chiffrement des fiches ont également été retirés de l'archive
  (le chiffrement est automatique à l'import — section 14). Si des serveurs
  avaient été lancés par des `.bat` visibles, `ARRETER-SILENCIEUX-WINDOWS.vbs`
  ne les tuera pas (aucun PID enregistré) : utilisez Ctrl+C dans ces fenêtres.
- Les journaux `logs\` peuvent être supprimés sans risque quand les serveurs
  sont arrêtés.
- Le moteur `scripts/auto-rh.js` est aussi utilisable en ligne de
  commande : `node scripts/auto-rh.js start|stop|restart|status` —
  il fonctionne également sous Linux et macOS (pratique pour un serveur).

### Dépannage express

| Symptôme | Solution |
|----------|----------|
| La popup dit « Le demarrage silencieux est toujours en cours » | Première installation en cours : patientez 2-3 min puis vérifiez avec `ETAT-SILENCIEUX-WINDOWS.vbs` |
| « Node.js n'est pas installe » | Installez la version LTS depuis https://nodejs.org puis relancez le VBS |
| Un port ne répond pas | Consultez `JOURNAUX-SILENCIEUX-WINDOWS.vbs` : un autre programme utilise peut-être le port 3000/3001 |
| « Des serveurs repondent mais n'ont PAS ete lances par le mode silencieux » | Les serveurs tournent dans des fenêtres CMD visibles : arrêtez-les avec Ctrl+C dans ces fenêtres |

## 22. Comptes utilisateurs — plus aucun code d'inscription

**(Supprimé — mise à jour 2026)** : l'inscription par code d'activation
(« Créer un compte (code d'activation requis) ») et le fichier
`SECURISER-INSCRIPTION-WINDOWS.bat` sont **SUPPRIMÉS** à la demande de
l'administrateur. La page d'inscription n'existe plus, l'API `/api/auth/signup`
non plus, et aucune variable `SIGNUP_CODE` n'est lue.

Désormais :

- les comptes **RH** et **IT** sont créés **exclusivement par le
  superadministrateur**, depuis l'onglet « Utilisateurs » de l'administration ;
- le superadministrateur gère aussi l'activation/désactivation, la
  suppression, la réinitialisation des accès (mot de passe) et le changement
  de rôle RH ↔ IT ;
- le premier compte superadministrateur se crée avec
  `CREER-SUPERADMIN-WINDOWS.bat` (à la racine) ou
  `node scripts/creer-superadmin.js` ;
- les anciennes lignes `SIGNUP_CODE` / `SIGNUP_CODE_HASH` éventuellement
  présentes dans un fichier `.env` existant deviennent **inertes** : elles ne
  sont plus lues par personne (vous pouvez les supprimer).

## 23. Sécuriser le contenu de la base de données (custom.db)

**Nouveauté (16/09/2026)** : jusqu'ici, le fichier `db/custom.db` était une
base SQLite **lisible en clair**. En l'ouvrant avec n'importe quel outil
(DB Browser for SQLite, Notepad…), on voyait tout : les **CIN**, les **noms
des employés**, le **net à payer**, les **matricules**, le **texte intégral
de chaque fiche**, les **secrets TOTP du portail** et les **emails des
comptes**. Quiconque accédait au fichier (clé USB, sauvegarde Windows,
poste volé, fichier transmis par erreur) lisait tout. Ce problème est
désormais corrigé : **les champs sensibles sont chiffrés AES-256-GCM à
l'intérieur même de la base**, et des outils de sauvegarde/protection sont
fournis.

### Ce qui est chiffré, champ par champ

| Table | Champs chiffrés | Champs laissés en clair (sans secret) |
|-------|-----------------|----------------------------------------|
| Fiches (Payslip) | cin, nom du fichier, texte intégral, contenu normalisé, nom de l'employé, période, net à payer, matricule | taille, n° de pages, date d'ajout, nom technique du fichier stocké |
| Accès portail (PortalAccess) | cin (chiffré **déterministe**), secret TOTP | compteurs anti force-brute, dates |
| Comptes RH/IT (User) | email (déterministe), nom | mot de passe (déjà haché scrypt depuis l'origine), rôle, dates |
| Journal des imports (ImportLog) | CIN détecté, nom du fichier, message | statut, taille, date |

Deux modes de chiffrement, selon l'usage du champ :

- **IV aléatoire** (protection maximale) pour les textes, noms, montants :
  la même valeur chiffrée deux fois donne deux résultats différents ;
- **déterministe** (préfixe `encbd1d:`) pour les champs sur lesquels
  l'application cherche par égalité : le CIN du portail et l'email de
  connexion. La même valeur donne la même empreinte, ce qui permet à la
  connexion par CIN (portail) et par email (RH/IT) de continuer à
  fonctionner **exactement comme avant**, tout en ne laissant rien de
  lisible sur le disque.

La clé est dérivée du **secret existant du site** (`AUTO_RH_STORAGE_KEY`,
repli `AUTH_SECRET`) avec des sels propres à la base : ce n'est **pas** la
même clé que celle des fichiers chiffrés. **Ne perdez pas cette clé** : sans
elle, la base devient illisible (exactement comme pour les fiches chiffrées
du dossier storage).

### Ce qui change pour vous : rien, tout est transparent

L'application d'administration et le portail employés chiffrent à l'écriture
et déchiffrent à la lecture **automatiquement** (middleware Prisma —
`src/lib/db.ts` + `src/lib/db-crypto.ts` côté site, `scripts/lib-crypto-bd.js`
côté portail). Aucune manipulation : les listes, recherches, statistiques,
téléchargements se comportent à l'identique (18 vérifications E2E + la
régression portail complète de 54 vérifications passent sur base chiffrée).

Seule différence visible : si vous ouvrez `db/custom.db` avec un outil
extérieur, vous voyez désormais des valeurs du type
`encbd1:53h7n…:…:…` au lieu des CIN et des salaires.

### Migrer les fiches déjà présentes (1 commande)

Le site chiffre tout ce qui est écrit **à partir de maintenant**. Les lignes
anciennes (vos 107 fiches) sont chiffrées par un outil fourni — **arrêtez les
serveurs d'abord** (ARRETER-SILENCIEUX-WINDOWS.vbs ou Ctrl+C dans les
fenêtres), puis :

```
node scripts\chiffrer-base.js             chiffre tout (c'est déjà fait sur
                                          l'installation livrée)
node scripts\chiffrer-base.js --statut    état sans rien modifier
node scripts\chiffrer-base.js --dechiffrer  retour arrière complet
```

Détails importants, gérés automatiquement par le script :

- une **sauvegarde automatique** du fichier de base est créée avant toute
  modification (`custom.db.avant-chiffrement-<date>`) — gardez-la jusqu'à
  vérification, puis **supprimez-la** (elle contient les anciennes données
  en clair, c'est son rôle) ;
- un **VACUUM** (réécriture intégrale du fichier) est exécuté après la
  migration : c'est indispensable, car SQLite garde sinon les anciennes
  valeurs dans ses pages internes même après mise à jour — un examen brut du
  fichier retrouverait les données d'origine. Après VACUUM, l'installation
  livrée est passée de 88 Mo à environ 0,6 Mo (texte dupliqué compacté) ;
- le chiffrement est **idempotent** : relancer le script ne rechiffre jamais
  une valeur déjà chiffrée ;
- une ligne restée en clair (écrite par un ancien outil) reste **lisible par
  l'application** : la migration est progressive, sans rupture.

### Sauvegardes chiffrées de la base

Nouvelle commande + lanceur Windows :

- **double-clic sur `SAUVEGARDER-BD-WINDOWS.bat`** : crée une copie
  **chiffrée AES-256-GCM** de la base dans `backups\` (format `.pgb`,
  sel unique par sauvegarde, clé = celle du site) avec contrôle SHA-256 ;
- rotation automatique : les **10 sauvegardes les plus récentes** sont
  conservées (réglable : `node scripts\sauvegarde-bd.js --garder 15`) ;
- restauration (jamais automatique, par précaution) :
  ```
  node scripts\sauvegarde-bd.js --liste
  node scripts\sauvegarde-bd.js --restaurer "SERVICE-RH-BD-..." --sortie db\custom.db
  ```
  Le fichier de destination doit ne pas exister (ou ajouter `--forcer`) ;
- conseil de rythme : une sauvegarde après chaque import de fiches, et de
  préférence **serveurs arrêtés** (cohérence parfaite) : ARRETER →
  SAUVEGARDER → DEMARRER.

### Restreindre l'accès aux dossiers sensibles (Windows)

**Automatique depuis le 17/09/2026 (section 29)** : les permissions NTFS de
`.env`, `db`, `storage`, `logs` et `backups` sont restreintes **à chaque
démarrage** par le site lui-même (compte courant + SYSTEM + Administrateurs,
via `scripts\securiser-auto.js`) — vous n'avez rien à faire. Les commandes
ci-dessous ne servent plus qu'à vérifier l'état ou à aller plus loin :

1. **Vérifier** : `node scripts\securiser-auto.js --etat` (ou
   `icacls "<élément>"` pour le détail brut) ;
2. **Chiffrer avec EFS** — Windows 10/11 **Pro** uniquement (option
   MANUELLE, non automatisée volontairement) :
   `cipher /e /i "<élément>"` : le disque lui-même chiffre ces dossiers, le
   site continue de tourner normalement ;
3. **Exporter le certificat EFS** — à faire impérativement après l'option 2
   (`cipher /r:certificat-efs-auto-rh`) et à conserver hors du poste : sans
   ce fichier `.pfx`, un problème de compte Windows rendrait les données
   illisibles ;
4. afficher l'état du chiffrement : `cipher /c "<élément>"`.

### Les anciennes copies en clair : à nettoyer

Chiffrez ou supprimez les vieilles copies qui contiennent encore les données
en clair, sinon le chiffrement de la base active n'a pas de valeur :

- `db\custom.db.bak-...` : anciennes copies laissées par des mises à jour ;
- `db\custom.db.avant-chiffrement-...` : la sauvegarde précédant la
  migration (gardez-la quelques jours, puis supprimez-la) ;
- anciennes sauvegardes non chiffrées éventuelles (clé USB, dossier
  Documents…).

### En résumé : ce qui est protégé, ce qui ne l'est pas

| Élément | État |
|---------|------|
| Fichiers des fiches sur le disque (storage) | Chiffrés AES-256 depuis la section 14 |
| Champs sensibles de la base (CIN, noms, salaires, textes, TOTP, emails) | **Chiffrés AES-256 (cette section)** |
| Comptes utilisateurs | Créés par le superadministrateur uniquement — plus aucun code d'inscription (section 22) |
| Sauvegardes de la base | **Chiffrées (cette section)** |
| Accès aux dossiers par les comptes Windows | **Restreignables (cette section)** |
| Poste entier (autres logiciels, cloud, virus) | Non couvert par le site : activez **BitLocker** (Windows Pro) ou un chiffrement de disque — complément recommandé |

La protection est « tout ou rien » autour de la clé du site : toute
personne ayant la clé (`AUTO_RH_STORAGE_KEY` dans `.env`) et le fichier
peut tout lire ; sans la clé, rien n'est lisible. Conservez `.env` et les
données dans le même périmètre de confiance, et gardez une copie de la clé
dans un endroit sûr séparé du poste.

## 24. Rester connecté au portail : « Se souvenir de moi » et sessions

### Le problème que cette section résout

Jusqu'ici, la session du portail employé durait 30 minutes maximum : passé ce
délai (ou après la fermeture du navigateur), l'employé devait ressaisir son
numéro de CIN et le code à 6 chiffres de son application d'authentification.
C'était sécurisé, mais pénible à l'usage quotidien — surtout pour des
consultations fréquentes de ses fiches de paie.

Le portail propose désormais la même option que la page d'administration :
une case **« Se souvenir de moi sur cet appareil »** sur l'écran de connexion,
cochée par défaut. Si l'employé la laisse cochée, la session dure **30 jours**
(même durée que « Se souvenir de moi » de la connexion administration) ; s'il
la décoche, la session reste limitée à **30 minutes**, comme avant.

### Ce qui change concrètement à l'écran

- Écran de connexion du portail : une nouvelle case à cocher apparaît entre
  le champ « Code d'authentification » et le bouton « Se connecter », avec la
  durée réelle affichée (par défaut « 30 jours »).
- Session glissante : tant que l'employé consulte le portail, sa session est
  **prolongée automatiquement** à chaque page chargée. Un employé actif n'est
  plus déconnecté en pleine consultation ; sans activité, la session expire
  après la durée choisie (30 minutes ou 30 jours).
- La case est mémorisée à la connexion : avec « Se souvenir de moi », la
  fermeture puis la réouverture du navigateur n'exige plus de nouvelle saisie
  CIN + code. Le bouton « Se déconnecter » purge immédiatement la session,
  même longue — pratique sur un poste partagé.

### Ce qui ne change pas : la sécurité

- Le cookie de session reste `HttpOnly`, signé HMAC-SHA256 avec `AUTH_SECRET`,
  `SameSite=Lax` : JavaScript ne peut pas le lire, il ne peut pas être forgé.
- La connexion exige toujours le code TOTP à 6 chiffres : la session longue
  évite les ressaisies répétées sur un poste de confiance, elle ne remplace
  jamais la vérification d'identité initiale.
- Les anciens jetons de session émis avant cette mise à jour restent valables
  jusqu'à leur expiration normale (compatibilité totale, rien à faire).
- Toutes les protections précédentes s'appliquent à l'identique : verrouillage
  après trop d'essais, anti-rejeu des codes, recherches et PDF verrouillés sur
  le CIN de la session.

### Confidentialité : le navigateur n'affiche plus les CIN déjà saisis

Au passage, l'écran de connexion ne déclenche plus l'autocomplétion du
navigateur : la liste déroulante qui réaffichait les numéros CIN tapés
précédemment sur le poste (un vrai problème de confidentialité sur un
écran partagé) a disparu. Le champ CIN n'est plus enregistré ni reproposé
par le navigateur (`autocomplete="off"` sur le formulaire et le champ), et
le code à 6 chiffres conserve son mode « one-time-code » compatible avec
les applications d'authentification sur mobile.

La commodité de ne pas ressaisir le CIN n'est pas perdue pour autant :
c'est désormais la case « Se souvenir de moi sur cet appareil » ci-dessus
qui s'en charge, côté serveur, sans rien afficher à l'écran. Si des CIN
avaient déjà été mémorisés par le navigateur AVANT cette mise à jour, ils
restent dans les données du navigateur mais ne sont plus jamais proposés ;
pour les effacer définitivement, supprimez-les dans les paramètres du
navigateur (Confidentialité > Données de formulaire enregistrées).

### Ajuster les durées (optionnel)

Les deux durées sont modifiables dans le fichier `.env` (en minutes), puis un
redémarrage des serveurs (ARRETER puis DEMARRER, ou les .bat) applique les
nouvelles valeurs :

| Variable `.env` | Rôle | Défaut |
|-----------------|------|--------|
| `PORTAL_SESSION_MAX_AGE_MINUTES` | Durée d'une session normale | `30` |
| `PORTAL_SESSION_REMEMBER_MINUTES` | Durée avec « Se souvenir de moi » | `43200` (30 jours) |

Exemples : `PORTAL_SESSION_REMEMBER_MINUTES=1440` pour une journée ;
`PORTAL_SESSION_REMEMBER_MINUTES=10080` pour une semaine. Valeur maximale
acceptée : 1 an. Toute valeur absente, invalide ou négative retombe sur le
défaut. Le libellé affiché sur l'écran de connexion suit automatiquement la
valeur configurée.

### Recommandation d'usage

- Poste personnel ou professionnel attitré : laisser la case cochée.
- Poste partagé (borne commune, salle serveur) : décocher la case — la
  session retombe à 30 minutes et se purge à la fermeture du navigateur.
- En cas de doute (poste perdu, départ d'un employé) : supprimer puis
  recréer l'accès portail depuis l'onglet « Accès portail » de
  l'administration ; la session longue devient immédiatement inutilisable
  avec l'ancien compte.

## 25. Superadministrateur : gestion complète des comptes RH et IT

### Le niveau superadministrateur

Au-dessus des rôles RH et IT existe désormais un rôle **SUPERADMINISTRATEUR**.
Connecté avec ce compte, l'onglet « Utilisateurs » de l'administration devient
une console de superadministration qui permet, sur TOUS les comptes RH et IT :

| Action | IT | Superadministrateur |
|--------|----|--------------------|
| Lister les comptes | ✓ | ✓ |
| Activer / désactiver un compte | ✓ | ✓ |
| Supprimer un compte | ✓ | ✓ |
| **Réinitialiser le mot de passe** d'un compte | — | ✓ |
| **Changer le rôle** d'un compte (RH ↔ IT) | — | ✓ |

- L'IT conserve TOUTES ses capacités historiques (rien n'est retiré) ; le
  superadministrateur ajoute les deux actions sensibles supplémentaires.
- Un compte superadministrateur ne peut PAS être créé par l'écran
  d'inscription : il n'existe que par le script ci-dessous — l'inscription
  publique reste limitée à RH et IT.
- La session est revalidée en base à CHAQUE appel : un compte supprimé ou
  désactivé est déconnecté immédiatement, même avec un cookie encore valide.

### Créer le premier superadministrateur (1 minute)

1. Double-cliquez sur **CREER-SUPERADMIN-WINDOWS.bat** (à la racine du projet).
2. Choisissez l'option 2 « CRÉER un compte superadministrateur ».
3. Saisissez l'email, le nom affiché, puis le mot de passe (8 caractères
   minimum, saisie masquée, demandé deux fois).
4. Connectez-vous avec cet email sur la page de connexion de
   l'administration : le badge « Superadministrateur » apparaît en haut à
   droite et l'onglet « Utilisateurs » passe en mode superadministration.

Autres options du menu : 1) voir l'état des comptes (lecture seule) ;
3) PROMOUVOIR un compte RH/IT existant en superadministrateur (sans changer
son mot de passe). Équivalents en ligne de commande :
`node scripts/creer-superadmin.js --statut` / `--creer --email a@b.tn --nom "Nom" --password XXX`
/ `--creer --role RH --email a@b.tn --nom "Nom" --password XXX` / `--promouvoir --email a@b.tn`.

> **Correctif 2 (abandon immédiat « X était inattendu. »)** : sous Windows, une
> parenthèse dans un message `echo` situé dans un bloc `if ( ... )` casse
> l'analyse du fichier par cmd.exe — le script s'arrêtait INSTANTANÉMENT avec
> « puis était inattendu. » avant même d'afficher le menu (indépendant des
> droits administrateur). Le fichier **CREER-SUPERADMIN-WINDOWS.bat** a été
> réécrit sans AUCUNE parenthèse et sans bloc `if (...)` (flux `goto` simples),
> avec en plus : affichage correct des accents (`chcp 65001`), vérification que
> le dossier complet a été extrait du ZIP (message explicite sinon), vérification
> que le projet est installé (invite à lancer DEMARRER-SILENCIEUX-WINDOWS.vbs sinon) et
> message d'erreur explicite si le menu échoue.
>
> **Correctif 1 (saisie masquée)** : sur un vrai terminal, le mot de passe
> s'affichait EN CLAIR pendant la frappe (écho parasite de readline) et les
> mots de passe avec accents (é, à, ç…) étaient incomplets. La saisie masquée
> a été réécrite : un seul lecteur de frappes, UTF-8 complet, flèches ignorées,
> Ctrl+U pour tout effacer.
>
> Si vous aviez extrait une ancienne version, retéléchargez le ZIP et
> remplacez le dossier, puis relancez CREER-SUPERADMIN-WINDOWS.bat.

### Suppression et sécurité

- Impossible de supprimer ou désactiver SON PROPRE compte (pas de
  verrouillage accidentel).
- Impossible de supprimer ou désactiver le DERNIER superadministrateur actif
  : il faut d'abord créer ou réactiver un autre compte superadministrateur.
- Le rôle d'un compte superadministrateur ne se modifie pas depuis l'interface
  (uniquement via le script) — verrou volontaire contre les erreurs.
- L'attribution du rôle SUPERADMIN via l'API est refusée : seul le script
  (exécuté sur le poste, par une personne ayant accès au dossier) crée ou
  promeut des superadministrateurs.
- Outil de secours en ligne de commande (si plus aucun superadministrateur ne
  peut se connecter) : `node scripts/supprime-utilisateur.js --email a@b.tn`
  (demande confirmation ; `--forcer` pour enchaîner ; refuse le dernier
  superadmin actif sauf `--forcer-dernier`).

### Confidentialité

Les comptes créés par le script sont stockés CHIFFRÉS dans la base
(email déterministe, nom chiffré — même mécanique que la section 23) : rien
n'apparaît en clair dans custom.db, y compris pour les comptes créés hors du
site. L'affichage du script (`--statut`) déchiffre à la volée pour lecture.

## 26. Résultats de recherche sans données de contenu

**Modifié (16/09/2026, à la demande de l'administrateur)** : la recherche par
CIN continue d'analyser le **contenu intégral** des fiches pour y retrouver le
numéro, mais elle n'affiche plus — et ne renvoie plus — **aucune donnée issue
de ce contenu**. L'extrait du bulletin (texte brut affiché autour du CIN)
qui apparaissait sous le nom du fichier dans les résultats a été supprimé,
aussi bien dans le tableau (ordinateur) que dans les cartes (mobile), et la
réponse interne de l'application ne contient plus aucun extrait de contenu.

Les résultats de recherche se limitent désormais aux seules informations déjà
affichées ailleurs : **nom du fichier**, **période** et **CIN masqué** (seuls
les 3 derniers caractères sont visibles — section 17). La recherche reste
exactement aussi précise qu'avant : seuls les bulletins contenant le numéro
de CIN **COMPLET et IDENTIQUE** sont retournés, et le portail employés reste
verrouillé sur le CIN de la session connectée.

Ce retrait complète les mesures de confidentialité précédentes (colonnes
« Employé » et « Net à payer » retirées, CIN masqué) : aucune donnée
sensible d'un bulletin ne circule plus vers le navigateur en dehors de la
consultation volontaire du PDF par un utilisateur autorisé.

## 27. Champs de saisie sans historique (auto-complétion désactivée)

**Nouveau (16/09/2026, à la demande de l'administrateur)** : l'historique de
saisie du navigateur — la liste des valeurs déjà tapées que le navigateur
propose sous les champs — est désactivé sur **TOUS les champs de saisie du
projet**. Concrètement, le composant de champ de l'application applique
désormais `autocomplete="off"` par défaut, et chaque formulaire le demande
explicitement : il n'y a plus aucune suggestion des recherches, emails,
codes ou noms précédemment saisis, sur aucun poste.

Sont concernés : le site d'administration (connexion : email et mot de
passe ; inscription : nom, email, mots de passe, code d'activation ;
recherche par CIN ; filtres des fiches et des utilisateurs ; sélection des
fichiers à importer) ainsi que le portail employés (formulaire complet :
CIN et code d'authentification — un CIN ou un code déjà saisi ne sera plus
jamais proposé ni complété par le navigateur).

Deux précisions utiles : sur le champ de mot de passe de la page de
connexion, l'attribut `autocomplete="new-password"` est utilisé car c'est
le seul signal que les navigateurs respectent réellement pour ne proposer
ni enregistrement ni historique sur un champ de connexion. Par ailleurs,
les gestionnaires de mots de passe intégrés aux navigateurs restent maîtres
de leurs propres coffres : l'application, elle, ne fournit aucune incitation
à mémoriser les saisies et n'en conserve aucune trace.

## 28. Lanceurs utilitaires retirés de l'archive (17/09/2026)

**Nouveau (17/09/2026, à la demande de l'administrateur)** : 6 utilitaires
optionnels ont été retirés des archives ZIP livrables — **aucun impact sur
le fonctionnement** : ils n'intervenaient ni au démarrage des serveurs, ni
à l'import des fiches, ni à la recherche, ni au portail employés.

À noter : `SECURISER-INSCRIPTION-WINDOWS.bat`, initialement compris dans ce
retrait, a été **réintégré** le même jour à la demande de l'administrateur
(section 22) — il reste fourni dans l'archive.

| Fichier retiré | Rôle | Alternative conservée |
|----------------|------|-----------------------|
| `SCINDER-FICHES-WINDOWS.bat` | migration ponctuelle des PDF multi-fiches importés avant la mise à jour | découpage automatique à l'import (section 15) + `node scripts\scinder-pdfs-multipages.js` |
| `SCINDER-EXCEL-WINDOWS.bat` | migration ponctuelle des classeurs Excel | découpage automatique à l'import (section 16) + `node scripts\scinder-excel-multipages.js` |
| `SCINDER-DOCX-WINDOWS.bat` | migration ponctuelle des documents Word | découpage automatique à l'import (section 17) + `node scripts\scinder-docx-multipages.js` |
| `SECURISER-DOSSIER-WINDOWS.bat` | permissions NTFS (accès local au disque) | **remplacé par la protection AUTOMATIQUE au démarrage (section 29)** + commandes `icacls` natives (section 13) |
| `SECURISER-DOSSIERS-WINDOWS.bat` | permissions NTFS + chiffrement EFS | **permissions : AUTOMATIQUES au démarrage (section 29)** ; EFS : commandes `cipher` natives (section 23) |
| `SECURISER-DOSSIER-LINUX-MAC.sh` | chmod Linux / macOS | **remplacé par la protection AUTOMATIQUE au démarrage (section 29)** + commandes `chmod` natives (section 13) |

Les capacités restent intactes : les outils en ligne de commande
(`scripts\scinder-pdfs-multipages.js`, `scripts\scinder-excel-multipages.js`,
`scripts\scinder-docx-multipages.js`, `scripts\gen-signup-code.js`,
`scripts\sauvegarde-bd.js`, `scripts\chiffrer-storage.js`) restent fournis
et documentés dans leurs sections respectives. Le démarrage, l'arrêt, l'état,
les journaux, la sauvegarde de la base, la création du superadministrateur et
l'ensemble des fonctionnalités du site et du portail sont inchangés.

Depuis le 17/09/2026 (fin de journée), les protections locales qu'assuraient
les 3 lanceurs SECURISER-DOSSIER sont de plus **automatisées** : voir la
section 29 ci-dessous — plus besoin d'aucun script, elles s'appliquent
seules à chaque démarrage.

## 29. Sécurisation AUTOMATIQUE des dossiers au démarrage (17/09/2026)

**Nouveau (17/09/2026, à la demande de l'administrateur)** : la protection
locale du disque, auparavant assurée par les menus manuels
`SECURISER-DOSSIER-WINDOWS.bat` / `SECURISER-DOSSIERS-WINDOWS.bat` /
`SECURISER-DOSSIER-LINUX-MAC.sh` (retirés de l'archive, section 28), est
désormais **intégrée au démarrage du site**. Vous n'avez **rien à lancer,
rien à penser** : chaque démarrage verrouille les dossiers sensibles tout
seul, en 1 seconde, silencieusement.

### Ce qui est protégé, et quand

À CHAQUE démarrage des serveurs — par `DEMARRER-SILENCIEUX-WINDOWS.vbs`
(démarrage silencieux), `DEMARRER-WINDOWS.bat`, `DEMARRER-PORTAIL-WINDOWS.bat`,
`DEMARRER-TOUT-*` ou les lanceurs Linux/macOS — le script interne
`scripts\securiser-auto.js` restreint les accès aux éléments sensibles :

| Élément | Contenu | Protection Windows | Protection Linux/macOS |
|---------|---------|--------------------|------------------------|
| `.env` | clés secrètes (chiffrement, sessions) | NTFS : compte courant + SYSTEM + Administrateurs uniquement | `chmod 600` |
| `db\` | base de données chiffrée | idem, hérité par les fichiers | `chmod 700` (+ `600` sur `*.db`) |
| `storage\` | fiches chiffrées AES-256 | idem, hérité par les fichiers | `chmod 700` |
| `logs\` | journaux techniques | idem | `chmod 700` |
| `backups\` | sauvegardes chiffrées de la base | idem (s'il existe) | `chmod 700` |

Concrètement sous **Windows**, le site applique exactement la commande du
cœur de l'ancien menu « Verrouiller » : `icacls "<élément>" /inheritance:r
/grant:r "DOMAINE\UTILISATEUR:F" "*S-1-5-18:F" "*S-1-5-32-544:F"` (SIDs
littéraux, indépendants de la langue de Windows) — seuls **votre compte
Windows**, le compte **Système** et les **Administrateurs** gardent l'accès.
Sous **Linux/macOS** : `chmod 700` sur les dossiers, `600` sur `.env` et les
fichiers `*.db`.

### Garanties

- **Zéro action manuelle** : appelé par `scripts\auto-rh.js` (mode
  silencieux) et par tous les lanceurs, AVANT l'ouverture des serveurs ;
- **Idempotent** : peut s'appliquer à chaque démarrage sans jamais rien
  casser ni dupliquer ;
- **Jamais bloquant** : une erreur sur un élément (fichier absent, disque
  sans permissions NTFS…) est ignorée et notée — le site démarre toujours ;
- **Sans effet sur le site** : les serveurs tournent avec VOTRE compte,
  qui conserve l'accès complet ; recherches, imports, portail OTP,
  sauvegardes fonctionnent à l'identique (validé par tests après
  verrouillage réel) ;
- **Réversible** : `icacls "<élément>" /inheritance:e` (Windows) ou
  `chmod 755` / `chmod 644` (Linux/macOS) restaure les permissions
  standards à tout moment — la prochaine application automatique les
  reverrouillera ;
- **Journal dédié** : `logs\securisation-auto.log` (une ligne par élément
  protégé, horodatée) ;
- **État consultable** : `node scripts\securiser-auto.js --etat`.

### Ce qui reste volontairement manuel

Le **chiffrement EFS** (`cipher /e /i`, Windows 10/11 Pro uniquement) n'est
PAS automatisé, à dessein : il dépend de l'édition de Windows et exige
l'export d'un certificat (`cipher /r:...`) immédiatement après activation,
sous peine de rendre les fichiers illisibles en cas de problème de compte.
Il reste documenté pas à pas en section 23, avec la vérification
`cipher /c`.

### Cas particulier / support

Pour diagnostiquer un problème avec la protection temporairement désactivée
(un seul démarrage) :
`set AUTO_RH_SAUT_SECURISATION=1` avant de lancer (Windows) ou
`AUTO_RH_SAUT_SECURISATION=1 node scripts/auto-rh.js start`
(Linux/macOS). La protection revient dès le démarrage suivant sans cette
variable. De même, si le site est lancé en `root` sous Linux/macOS, la
sécurisation s'auto-désactive pour ne pas verrouiller les fichiers contre
leur propriétaire légitime.

---

## 30. Un seul lanceur : démarrage + raccourci automatique (17/09/2026)

`DEMARRER-SILENCIEUX-WINDOWS.vbs` regroupe désormais les deux rôles qui
exigeaient auparavant deux fichiers distincts. L'ancien
`INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs` a été retiré de l'archive
(il reste présent dans le dépôt de développement, principe non-suppressif) :

- **Lancer le site** : le double-clic habituel — préparation et serveurs en
  arrière-plan sans fenêtre, popup de confirmation, ouverture du navigateur ;
- **Démarrage automatique à l'allumage du PC** : à CHAQUE lancement, le
  fichier vérifie le raccourci « Auto-RH - Demarrage silencieux » dans le
  dossier Démarrage de Windows (`shell:startup`) et le crée
  **automatiquement** s'il manque — aucune action manuelle, aucune popup
  supplémentaire. L'état est rappelé dans la popup de confirmation :
  « Demarrage automatique a l'allumage du PC : ACTIVE (raccourci cree
  automatiquement) » ou « DEJA ACTIF (raccourci present) ».

Le raccourci pointe vers ce même fichier : à l'ouverture de session,
Auto-RH redémarre en arrière-plan puis re-vérifie le raccourci (opération
sans effet s'il existe déjà — comportement idempotent garanti).

Pour **désactiver** le démarrage automatique : supprimez le raccourci
« Auto-RH - Demarrage silencieux » dans le dossier Démarrage
(`Win + R` → `shell:startup`). Pour le **réactiver** : relancez simplement
`DEMARRER-SILENCIEUX-WINDOWS.vbs` — le raccourci est recréé automatiquement.
