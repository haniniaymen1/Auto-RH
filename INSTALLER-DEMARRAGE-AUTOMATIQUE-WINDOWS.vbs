' ============================================================
'  Fiches de Paie - Demarrage automatique a l'ouverture de session
'  (OPTIONNEL - mode silencieux, sans fenetre CMD)
'
'  Double-cliquez UNE FOIS : un raccourci est cree dans le dossier
'  "Demarrage" (Startup) de Windows. A chaque ouverture de session, les
'  deux serveurs Auto-RH demarreront AUTOMATIQUEMENT en
'  arriere-plan (aucune fenetre noire, comme DEMARRER-SILENCIEUX).
'
'  Pour DESACTIVER : recliquez sur ce fichier (il propose alors de
'  supprimer le raccourci).
' ============================================================
Option Explicit
Dim sh, fso, dossier, cible, lnk, rep
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
cible = fso.BuildPath(dossier, "DEMARRER-SILENCIEUX-WINDOWS.vbs")
lnk = sh.SpecialFolders("Startup") & "\Auto-RH - Demarrage silencieux.lnk"

If Not fso.FileExists(cible) Then
    MsgBox "Fichier introuvable :" & vbCrLf & cible & vbCrLf & vbCrLf & _
           "Reinstallez le dossier Auto-RH complet.", vbCritical, "Auto-RH"
    WScript.Quit 1
End If

If fso.FileExists(lnk) Then
    rep = MsgBox("Le demarrage automatique est deja ACTIF." & vbCrLf & vbCrLf & _
                 "Voulez-vous le DESACTIVER (supprimer le raccourci) ?", _
                 vbYesNo + vbQuestion, "Auto-RH")
    If rep = vbYes Then
        fso.DeleteFile lnk, True
        MsgBox "Demarrage automatique DESACTIVE.", vbInformation, "Auto-RH"
    End If
Else
    Set sh = CreateObject("WScript.Shell")
    Dim oLink
    Set oLink = sh.CreateShortcut(lnk)
    oLink.TargetPath = cible
    oLink.WorkingDirectory = dossier
    oLink.Description = "Auto-RH : demarre les serveurs en arriere-plan (sans fenetre CMD)"
    oLink.Save
    MsgBox "Demarrage automatique ACTIF !" & vbCrLf & vbCrLf & _
           "A chaque ouverture de session Windows, Auto-RH demarrera " & _
           "en arriere-plan (administration port 3000 + portail port 3001, " & _
           "aucune fenetre CMD)." & vbCrLf & vbCrLf & _
           "Remarque : la PREMIERE fois seulement, la construction du site " & _
           "peut prendre 3 a 5 minutes avant que les pages ne repondent.", _
           vbInformation, "Auto-RH"
End If
WScript.Quit 0
