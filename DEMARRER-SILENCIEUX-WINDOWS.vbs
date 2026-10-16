' ============================================================
'  Fiches de Paie - Demarrage SILENCIEUX (sans fenetre CMD)
'  + raccourci de demarrage automatique cree AUTOMATIQUEMENT
'
'  (MODIFIE 0.2.53) la preparation ecrit desormais ETAT=EN_COURS
'  + ETAPE=... dans logs\demarrage-etat.txt A CHAQUE ETAPE :
'  - l'attente ne se termine que sur ETAT=OK ou ETAT=ERREUR ;
'  - si le delai expire, le message AFFICHE L'ETAPE EN COURS ;
'  - utile pour diagnostiquer une installation qui semble bloquee.
'
'  Double-cliquez sur ce fichier :
'    - aucune fenetre noire n'apparait ;
'    - le raccourci "Auto-RH - Demarrage silencieux" est cree
'      AUTOMATIQUEMENT dans le dossier Demarrage (Startup) de
'      Windows s'il manque : Auto-RH redemarrera donc tout seul
'      a chaque ouverture de session (creation silencieuse,
'      sans effet si le raccourci existe deja) ;
'    - la preparation (base de donnees, construction si necessaire)
'      et le lancement des 2 serveurs se font EN ARRIERE-PLAN ;
'    - une petite fenetre de confirmation s'affiche a la fin et
'      le site s'ouvre dans votre navigateur.
'
'  Administration : http://localhost:4000 (login requis)
'  Portail        : http://localhost:4001 (CIN + code OTP)
'
'  Pour ARRETER : double-cliquez sur ARRETER-SILENCIEUX-WINDOWS.vbs
'  Pour l'ETAT  : double-cliquez sur ETAT-SILENCIEUX-WINDOWS.vbs
'  Pour DESACTIVER le demarrage automatique : supprimez le raccourci
'  "Auto-RH - Demarrage silencieux" (Win + R -> shell:startup) ;
'  il sera recree au prochain lancement manuel.
'
'  Remarque : l'ancien fichier INSTALLER-DEMARRAGE-AUTOMATIQUE-WINDOWS.vbs
'  n'est plus necessaire (son role est integre ici).
' ============================================================
Option Explicit
Dim sh, fso, dossier, bat, etat, attente, contenu, message, lignes, i, p, etape
Dim dossierDemarrage, raccourciAuto, raccourciEtat, lienAuto
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
bat = fso.BuildPath(dossier, "PREPARER-AUTO-RH-SILENCIEUX.bat")
etat = fso.BuildPath(dossier, "logs\demarrage-etat.txt")

If Not fso.FileExists(bat) Then
    MsgBox "Fichier introuvable :" & vbCrLf & bat & vbCrLf & vbCrLf & _
           "Reinstallez le dossier Auto-RH complet.", vbCritical, "Auto-RH"
    WScript.Quit 1
End If

' ---------- Raccourci de demarrage automatique (cree AUTOMATIQUEMENT) ----------
' Le raccourci pointe vers CE fichier : a l'ouverture de session Windows,
' Auto-RH redemarre en arriere-plan puis re-verifie le raccourci (operation
' sans effet s'il existe deja). Creation silencieuse et idempotente.
raccourciEtat = "non configure (dossier Demarrage indisponible)"
dossierDemarrage = ""
On Error Resume Next
dossierDemarrage = sh.SpecialFolders("Startup")
On Error GoTo 0
If IsNull(dossierDemarrage) Then dossierDemarrage = ""
If dossierDemarrage <> "" Then
    raccourciAuto = dossierDemarrage & "\Auto-RH - Demarrage silencieux.lnk"
    If fso.FileExists(raccourciAuto) Then
        raccourciEtat = "DEJA ACTIF (raccourci present)"
    Else
        On Error Resume Next
        Set lienAuto = sh.CreateShortcut(raccourciAuto)
        lienAuto.TargetPath = fso.BuildPath(dossier, "DEMARRER-SILENCIEUX-WINDOWS.vbs")
        lienAuto.WorkingDirectory = dossier
        lienAuto.Description = "Auto-RH : demarre les serveurs en arriere-plan (sans fenetre CMD)"
        lienAuto.Save
        If Err.Number = 0 Then
            raccourciEtat = "ACTIVE (raccourci cree automatiquement)"
        Else
            Err.Clear
            raccourciEtat = "non configure (creez le raccourci manuellement : shell:startup)"
        End If
        On Error GoTo 0
    End If
End If

' Efface l'etat precedent puis lance la preparation SANS FENETRE (style 0)
On Error Resume Next
If fso.FileExists(etat) Then fso.DeleteFile etat, True
On Error GoTo 0
sh.Run "cmd /c """"" & bat & """""", 0, False

' Attend le fichier d'etat ecrit a la fin du demarrage (max ~20 min :
' premiere installation = npm install + build, comptez 3 a 5 minutes)
attente = 20 * 60
contenu = ""
Dim t0
t0 = Timer
Do While (Timer - t0) < attente
    WScript.Sleep 2000
    If fso.FileExists(etat) Then
        contenu = LireFichier(etat)
        If InStr(contenu, "ETAT=OK") > 0 Or InStr(contenu, "ETAT=ERREUR") > 0 Then Exit Do
    End If
Loop

' (MODIFIE 0.2.53) delai expire : afficher la DERNIERE ETAPE inscrite
' (ETAT=EN_COURS + ETAPE=...) pour rendre toute installation bloquee
' immediatement diagnosable par l'utilisateur.
If InStr(contenu, "ETAT=OK") = 0 And InStr(contenu, "ETAT=ERREUR") = 0 Then
    etape = ""
    If fso.FileExists(etat) Then etape = LireFichier(etat)
    If etape = "" Then
        MsgBox "Le demarrage silencieux est toujours en cours (premiere installation : " & _
               "cela peut durer 3 a 5 minutes)." & vbCrLf & vbCrLf & _
               "Reessayez dans quelques minutes, ou consultez les journaux avec " & _
               "JOURNAUX-SILENCIEUX-WINDOWS.vbs", vbInformation, "Auto-RH"
    Else
        MsgBox "Le demarrage silencieux est toujours en cours (premiere installation : " & _
               "cela peut durer 3 a 5 minutes)." & vbCrLf & vbCrLf & _
               "Derniere etape inscrite par la preparation :" & vbCrLf & _
               etape & vbCrLf & vbCrLf & _
               "Reessayez dans quelques minutes, ou consultez les journaux avec " & _
               "JOURNAUX-SILENCIEUX-WINDOWS.vbs", vbInformation, "Auto-RH"
    End If
    WScript.Quit 0
End If

message = ""
lignes = Split(contenu, vbLf)
For i = 0 To UBound(lignes)
    p = InStr(lignes(i), "MESSAGE=")
    If p > 0 Then message = Mid(lignes(i), p + 8)
Next

If InStr(contenu, "ETAT=OK") > 0 Then
    On Error Resume Next
    sh.Run "http://localhost:4000"
    On Error GoTo 0
    MsgBox "Auto-RH tourne EN ARRIERE-PLAN (aucune fenetre CMD)." & vbCrLf & vbCrLf & _
           "Demarrage automatique a l'allumage du PC : " & raccourciEtat & vbCrLf & vbCrLf & _
           message & vbCrLf & vbCrLf & _
           "Pour arreter : ARRETER-SILENCIEUX-WINDOWS.vbs" & vbCrLf & _
           "Pour l'etat : ETAT-SILENCIEUX-WINDOWS.vbs", _
           vbInformation, "Auto-RH - Demarre"
Else
    MsgBox "Echec du demarrage silencieux." & vbCrLf & vbCrLf & _
           message & vbCrLf & vbCrLf & _
           "Consultez les journaux avec JOURNAUX-SILENCIEUX-WINDOWS.vbs", _
           vbExclamation, "Auto-RH"
End If
WScript.Quit 0

Function LireFichier(chemin)
    On Error Resume Next
    Dim f, t
    Set f = fso.OpenTextFile(chemin, 1, False, -2)
    If Err.Number <> 0 Then
        Err.Clear
        LireFichier = ""
        Exit Function
    End If
    t = f.ReadAll
    f.Close
    LireFichier = t
End Function
