#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Task 212 — correctif v0.2.105 des 4 occurrences restantes (portail).
Chaînes COMPLÈTES (préfixe <div...> inclus) pour éviter toute ambiguïté."""

BASE = "/home/z/my-project/"
P = "scripts/portail-server.js"

with open(BASE + P, "r", encoding="utf-8") as f:
    t = f.read()

def applique(ancien, nouveau, attendu=1):
    global t
    n = t.count(ancien)
    assert n == attendu, f"attendu {attendu}, trouvé {n} : {ancien[:90]!r}"
    t = t.replace(ancien, nouveau)

ENTETE_D = """'<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(d.reference) + " — Auto-RH</div>" +"""
ENTETE_DEM = """'<div style="font-size:12px;opacity:.85;margin-top:4px;">Référence ' + echappeEmailDemande(demande.reference) + " — Auto-RH</div>" +"""
NOTICE = """'<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:14px;color:#1e40af;font-size:13px;"><b>Notification automatique</b> — merci de <b>ne pas répondre</b> à cet e-mail : les réponses envoyées à cette adresse ne sont pas lues. Le suivi de votre demande se fait dans votre portail employé.</div>' +"""

# 1) Pied texte de l'e-mail de CRÉATION (4 espaces — unique).
applique(
    '    "Cet e-mail a été envoyé automatiquement par Auto-RH. Si vous n\'êtes pas",\n'
    '    "le destinataire prévu, ignorez et supprimez ce message.",',
    '    "Cet e-mail a été envoyé automatiquement par AutoRH. Si vous n\'êtes pas",\n'
    '    "le destinataire prévu, ignorez et supprimez ce message.",')

# 2) En-tête HTML e-mail de CRÉATION (d.reference — unique).
applique(ENTETE_D, ENTETE_D.replace("Auto-RH", "AutoRH"))

# 3) DOCUMENT DISPONIBLE — en-tête + encadré notice (contexte unique :
#    paragraphe « traitée par le service RH » qui suit immédiatement).
applique(
    ENTETE_DEM + "\n"
    "      \"</div>\" +\n"
    "      '<div style=\"padding:20px 22px;color:#334155;font-size:14px;\">' +\n"
    "      '<p style=\"margin:0 0 14px;\">Votre demande administrative a été traitée par le service RH.</p>' +",
    ENTETE_DEM.replace("Auto-RH", "AutoRH") + "\n"
    "      \"</div>\" +\n"
    "      '<div style=\"padding:20px 22px;color:#334155;font-size:14px;\">' +\n"
    "      '<p style=\"margin:0 0 14px;\">Votre demande administrative a été traitée par le service RH.</p>' +\n"
    "      " + NOTICE)

# 4) N+1 — en-tête HTML (l'occurrence doc-dispo vient d'être renommée → unique).
applique(ENTETE_DEM, ENTETE_DEM.replace("Auto-RH", "AutoRH"))

with open(BASE + P, "w", encoding="utf-8") as f:
    f.write(t)
print("Correctif appliqué : 4/4 remplacements.")
