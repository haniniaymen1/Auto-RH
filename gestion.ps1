# ============================================================================
#   Auto RH (PaieSage) - GESTION UNIFIEE des services - WINDOWS (PowerShell)
#   (NOUVEAU v0.2.209)
#
#   Point d'entree UNIQUE : demarrer, arreter, surveiller, configurer.
#   Tous les PORTS sont lus dans le fichier .env (aucun port code en dur).
#   Le gros du travail est delégue aux mêmes scripts Node que sous Linux
#   (service-paiesage.js, verifier-ports.js, creer-superadmin.js) : le
#   comportement est IDENTIQUE sur les deux plateformes.
#
#   Utilisation (depuis PowerShell) :
#     powershell -NoProfile -ExecutionPolicy Bypass -File gestion.ps1 <commande>
#   ou via le lanceur GESTION.bat (double-clic convivial).
#
#   Commandes : demarrer | demarrer-silencieux | arreter | redemarrer | etat
#               journaux | ports | superadmin | installer | aide
# ============================================================================

param(
    [Parameter(Position = 0)]
    [string]$Commande = "aide",
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Arguments = @()
)

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# --------------------------------------------------------------------------
# 1) Chargement COMPLET du .env : chaque cle KEY=valeur est placee dans
#    l'environnement du processus. Le .env est LA source de verite.
# --------------------------------------------------------------------------
function Read-EnvFile {
    $envPath = Join-Path $Root ".env"
    if (-not (Test-Path $envPath)) { return }
    foreach ($ligne in Get-Content $envPath) {
        if ([string]::IsNullOrWhiteSpace($ligne)) { continue }
        if ($ligne.TrimStart().StartsWith("#") -or $ligne.TrimStart().StartsWith(";")) { continue }
        $idx = $ligne.IndexOf("=")
        if ($idx -lt 1) { continue }
        $cle = $ligne.Substring(0, $idx).Trim()
        $val = $ligne.Substring($idx + 1).Trim()
        if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Trim('"') }
        if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Trim("'") }
        if ($cle -match '^[A-Za-z_][A-Za-z0-9_]*$') { Set-Item -Path ("Env:" + $cle) -Value $val }
    }
}
Read-EnvFile

# --------------------------------------------------------------------------
# 2) Ports : PRIORITE IDENTIQUE au moteur scripts/service-paiesage.js
#    PAIESAGE_PORT_ADMIN > PORT (.env) > 4000 / PAIESAGE_PORT_PORTAIL > PORTAL_PORT > 4001
# --------------------------------------------------------------------------
$PortAdmin = if ($env:PAIESAGE_PORT_ADMIN) { $env:PAIESAGE_PORT_ADMIN } elseif ($env:PORT) { $env:PORT } else { "4000" }
$PortPortail = if ($env:PAIESAGE_PORT_PORTAIL) { $env:PAIESAGE_PORT_PORTAIL } elseif ($env:PORTAL_PORT) { $env:PORTAL_PORT } else { "4001" }
$env:PORT = $PortAdmin
$env:PORTAL_PORT = $PortPortail
if (-not $env:HOSTNAME) { $env:HOSTNAME = "0.0.0.0" }
$Node = "node"

function Write-Info { param($m) Write-Host "[INFO] $m" }
function Write-Ok { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
function Write-Erreur { param($m) Write-Host "[ERREUR] $m" -ForegroundColor Red }

function Test-Node {
    try { $null = & node --version; return $true }
    catch { Write-Erreur "Node.js est introuvable. Installez Node.js 20+ (https://nodejs.org) puis relancez."; return $false }
}

# Verification des ports AVANT lancement (0=libre, 1=conflit externe, 2=nous).
function Test-Ports-Avant {
    if (-not (Test-Node)) { exit 1 }
    & node (Join-Path $Root "scripts\verifier-ports.js") verifier
    return $LASTEXITCODE
}

# Super administrateur : creation AUTOMATIQUE au premier demarrage (idempotent).
function Invoke-SuperadminAuto {
    if ($env:SUPERADMIN_AUTO -eq "0") {
        Write-Info "SUPERADMIN_AUTO=0 : creation automatique du superadministrateur desactivee."
        return
    }
    if (-not (Test-Path (Join-Path $Root "db\custom.db"))) {
        Write-Info "Base absente : le superadministrateur sera cree au prochain demarrage."
        return
    }
    & node (Join-Path $Root "scripts\creer-superadmin.js") --assurer
    if ($LASTEXITCODE -ne 0) { Write-Erreur "Etape superadministrateur non terminee (le demarrage continue)." }
}

# PID enregistre d'un service (logs/paiesage-processus.json) ou 0.
function Get-PidEnregistre {
    param([string]$Cle)
    $f = Join-Path $Root "logs\paiesage-processus.json"
    try {
        $j = Get-Content $f -Raw | ConvertFrom-Json
        return [int]($j.$Cle)
    } catch { return 0 }
}

# Arret d'UN service : uniquement le PID ENREGISTRE par ce projet.
function Stop-Un {
    param([string]$Cle, [string]$Port, [string]$Nom)
    $pidCible = Get-PidEnregistre -Cle $Cle
    if ($pidCible -gt 0 -and (Get-Process -Id $pidCible -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $pidCible -Force -ErrorAction Stop; Write-Ok "$Nom arrete (PID $pidCible, port $Port)." }
        catch { Write-Erreur "Arret impossible du PID $pidCible : $_" }
    } else {
        Write-Info "$Nom : aucun PID enregistre vivant (port $Port)."
    }
}

switch ($Commande.ToLower()) {

    # ---- Demarrage NORMAL : une fenetre console visible par service ----
    "demarrer" {
        $Cible = if ($Arguments.Count -ge 1) { $Arguments[0].ToLower() } else { "tout" }
        if (-not (Test-Node)) { exit 1 }
        $rc = Test-Ports-Avant
        if ($rc -eq 1) { Write-Erreur "Conflit de port : lancement annule. Corrigez le port dans le .env puis relancez."; exit 1 }
        if ($rc -eq 2) { Write-Erreur "Deja en cours. Utilisez : GESTION.bat etat | redemarrer | arreter"; exit 3 }
        Invoke-SuperadminAuto
        Write-Host ""
        Write-Host "Demarrage NORMAL ($Cible) — fenetres console ouvertes (fermez la fenetre = arrete le serveur)."
        Write-Host "  Administration : http://localhost:$PortAdmin   |   Portail : http://localhost:$PortPortail"
        if ($Cible -in @("admin", "tout")) {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title Auto RH Administration (port $PortAdmin)&& node scripts\start-prod.js" -WorkingDirectory $Root
        }
        if ($Cible -in @("portail", "tout")) {
            Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title Auto RH Portail (port $PortPortail)&& node scripts\portail-server.js" -WorkingDirectory $Root
        }
        if ($Cible -notin @("admin", "portail", "tout")) { Write-Erreur "Cible inconnue : $Cible (tout|admin|portail)"; exit 1 }
    }

    # ---- Demarrage SILENCIEUX : arriere-plan, aucune fenetre ----
    "demarrer-silencieux" {
        $Cible = if ($Arguments.Count -ge 1) { $Arguments[0].ToLower() } else { "tout" }
        if (-not (Test-Node)) { exit 1 }
        $rc = Test-Ports-Avant
        if ($rc -eq 1) { Write-Erreur "Conflit de port : lancement annule. Corrigez le port dans le .env puis relancez."; exit 1 }
        Invoke-SuperadminAuto
        switch ($Cible) {
            "tout" {
                Write-Info "Demarrage silencieux des DEUX interfaces (ports $PortAdmin et $PortPortail)..."
                & node (Join-Path $Root "scripts\service-paiesage.js") start
            }
            "admin" {
                New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
                $p = Start-Process -FilePath "node" -ArgumentList (Join-Path $Root "scripts\start-prod.js") -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root "logs\paiesage-administration.log") -RedirectStandardError (Join-Path $Root "logs\paiesage-administration.err.log")
                & node (Join-Path $Root "scripts\service-paiesage.js") record $p.Id 0 | Out-Null
                Write-Ok "Administration lancee en arriere-plan (PID $($p.Id), port $PortAdmin)."
            }
            "portail" {
                New-Item -ItemType Directory -Force -Path (Join-Path $Root "logs") | Out-Null
                $p = Start-Process -FilePath "node" -ArgumentList (Join-Path $Root "scripts\portail-server.js") -WorkingDirectory $Root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Root "logs\paiesage-portail.log") -RedirectStandardError (Join-Path $Root "logs\paiesage-portail.err.log")
                & node (Join-Path $Root "scripts\service-paiesage.js") record 0 $p.Id | Out-Null
                Write-Ok "Portail lance en arriere-plan (PID $($p.Id), port $PortPortail)."
            }
            default { Write-Erreur "Cible inconnue : $Cible (tout|admin|portail)"; exit 1 }
        }
    }

    # ---- Arret precis ----
    "arreter" {
        $Cible = if ($Arguments.Count -ge 1) { $Arguments[0].ToLower() } else { "tout" }
        if (-not (Test-Node)) { exit 1 }
        switch ($Cible) {
            "tout"    { & node (Join-Path $Root "scripts\service-paiesage.js") stop }
            "admin"   { Stop-Un -Cle "admin" -Port $PortAdmin -Nom "Administration" }
            "portail" { Stop-Un -Cle "portail" -Port $PortPortail -Nom "Portail" }
            default   { Write-Erreur "Cible inconnue : $Cible (tout|admin|portail)"; exit 1 }
        }
    }

    # ---- Redemarrage ----
    "redemarrer" {
        $Cible = if ($Arguments.Count -ge 1) { $Arguments[0].ToLower() } else { "tout" }
        & $MyInvocation.MyCommand.Path arreter $Cible
        Start-Sleep -Seconds 1
        & $MyInvocation.MyCommand.Path demarrer-silencieux $Cible
    }

    # ---- Etat ----
    "etat" {
        if (-not (Test-Node)) { exit 1 }
        Write-Host "Ports du .env : administration=$PortAdmin, portail=$PortPortail"
        & node (Join-Path $Root "scripts\service-paiesage.js") status
    }

    # ---- Journaux ----
    "journaux" {
        $Cible = if ($Arguments.Count -ge 1) { $Arguments[0].ToLower() } else { "admin" }
        $n = if ($Arguments.Count -ge 2) { [int]$Arguments[1] } else { 50 }
        $map = @{
            "admin" = "logs\paiesage-administration.log"; "portail" = "logs\paiesage-portail.log"
            "silencieux" = "logs\paiesage-silencieux.log"; "demarrage" = "logs\demarrage-etat.txt"; "arret" = "logs\arret-etat.txt"
        }
        if (-not $map.ContainsKey($Cible)) { Write-Erreur "Journal inconnu : $Cible (admin|portail|silencieux|demarrage|arret)"; exit 1 }
        $f = Join-Path $Root $map[$Cible]
        if (Test-Path $f) { Write-Host "--- $f (dernieres $n lignes) ---"; Get-Content $f -Tail $n }
        else { Write-Info "Journal absent : $f" }
    }

    # ---- Ports ----
    "ports" {
        if (-not (Test-Node)) { exit 1 }
        $mode = if ($Arguments.Count -ge 1) { $Arguments[0] } else { "verifier" }
        & node (Join-Path $Root "scripts\verifier-ports.js") $mode
        exit $LASTEXITCODE
    }

    # ---- Super administrateur ----
    "superadmin" {
        if (-not (Test-Node)) { exit 1 }
        $script = Join-Path $Root "scripts\creer-superadmin.js"
        if ($Arguments.Count -eq 0) { & node $script --assurer }
        else { & node $script @Arguments }
    }

    # ---- Installation ----
    "installer" {
        if (-not (Test-Node)) { exit 1 }
        Write-Info "npm install (3 a 5 minutes, une seule fois)..."
        & npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { Write-Erreur "Echec de npm install."; exit 1 }
        if (-not (Test-Path (Join-Path $Root "node_modules\.prisma\client\index.js"))) {
            & node (Join-Path $Root "node_modules\prisma\build\index.js") generate
        }
        if (-not (Test-Path (Join-Path $Root "db\custom.db"))) {
            & node (Join-Path $Root "node_modules\prisma\build\index.js") db push
        }
        & node (Join-Path $Root "scripts\securiser-auto.js") 2>$null
        Write-Ok "Installation terminee. Demarrage : GESTION.bat demarrer-silencieux"
    }

    "aide" {
        Write-Host ""
        Write-Host "Auto RH - GESTION des services (Windows) - v0.2.209"
        Write-Host ""
        Write-Host "  GESTION.bat demarrer [tout|admin|portail]         Fenetres console visibles"
        Write-Host "  GESTION.bat demarrer-silencieux [tout|...]        Arriere-plan, aucune fenetre"
        Write-Host "  GESTION.bat arreter [tout|admin|portail]          Arret precis"
        Write-Host "  GESTION.bat redemarrer [tout|...]                 Arret + redemarrage"
        Write-Host "  GESTION.bat etat                                  Etat (ports, PIDs, HTTP)"
        Write-Host "  GESTION.bat journaux [admin|portail|...] [n]      Journaux"
        Write-Host "  GESTION.bat ports [verifier|etat|liste]           Ports du .env + disponibilite"
        Write-Host "  GESTION.bat superadmin [options creer/statut]     Super administrateur"
        Write-Host "  GESTION.bat installer                             Dependances + base"
        Write-Host ""
        Write-Host "  Ports : modifiez PORT (administration) et PORTAL_PORT (portail) dans .env,"
        Write-Host "  puis GESTION.bat redemarrer — tout le reste suit automatiquement."
        Write-Host ""
    }

    default {
        Write-Erreur "Commande inconnue : $Commande"
        Write-Host "Tapez : GESTION.bat aide"
        exit 1
    }
}
