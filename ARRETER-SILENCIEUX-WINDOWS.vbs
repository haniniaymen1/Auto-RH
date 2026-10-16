' ============================================================
'  Fiches de Paie - ARRET du mode silencieux
'
'  Double-cliquez sur ce fichier :
'    - aucune fenetre noire n'apparait ;
'    - les deux serveurs lances par DEMARRER-SILENCIEUX-WINDOWS.vbs
'      (administration port 4000 + portail port 4001) sont arretes
'      proprement ;
'    - une petite fenetre confirme l'arret.
'
'  Remarque : si les serveurs avaient ete lances avec les .bat
'  VISIBLES (fenetres CMD), ils ne sont pas touches : utilisez
'  Ctrl+C dans ces fenetres.
' ============================================================
Option Explicit
Dim sh, fso, dossier, etat, contenu, message, lignes, i, p, t0
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
etat = fso.BuildPath(dossier, "logs\arret-etat.txt")

' Efface l'etat precedent puis arrete SANS FENETRE (style 0)
On Error Resume Next
If fso.FileExists(etat) Then fso.DeleteFile etat, True
sh.Run "cmd /c node scripts\auto-rh.js stop", 0, False
On Error GoTo 0

' Attend le resultat (max 60 s)
contenu = ""
t0 = Timer
Do While (Timer - t0) < 60
    WScript.Sleep 1000
    If fso.FileExists(etat) Then
        contenu = LireFichier(etat)
        If contenu <> "" Then Exit Do
    End If
Loop

If contenu = "" Then
    MsgBox "L'arret n'a pas abouti dans le delai (60 s)." & vbCrLf & vbCrLf & _
           "Verifiez que Node.js est installe, ou consultez les journaux " & _
           "avec JOURNAUX-SILENCIEUX-WINDOWS.vbs", vbExclamation, "Auto-RH"
    WScript.Quit 1
End If

message = ""
lignes = Split(contenu, vbLf)
For i = 0 To UBound(lignes)
    p = InStr(lignes(i), "MESSAGE=")
    If p > 0 Then message = Mid(lignes(i), p + 8)
Next

If InStr(contenu, "ETAT=OK") > 0 Then
    MsgBox message & vbCrLf & vbCrLf & _
           "Pour relancer : DEMARRER-SILENCIEUX-WINDOWS.vbs", _
           vbInformation, "Auto-RH - Arrete"
Else
    MsgBox message & vbCrLf & vbCrLf & _
           "Consultez les journaux avec JOURNAUX-SILENCIEUX-WINDOWS.vbs", _
           vbExclamation, "Auto-RH - Arret"
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
