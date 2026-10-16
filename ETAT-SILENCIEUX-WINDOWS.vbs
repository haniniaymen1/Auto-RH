' ============================================================
'  Fiches de Paie - ETAT des serveurs (mode arriere-plan)
'
'  Double-cliquez sur ce fichier : une petite fenetre affiche
'  l'etat de l'administration (port 4000) et du portail (4001),
'  SANS ouvrir la moindre fenetre CMD.
' ============================================================
Option Explicit
Dim sh, fso, dossier, etat, contenu, t0
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
etat = fso.BuildPath(dossier, "logs\etat-actuel.txt")

On Error Resume Next
If fso.FileExists(etat) Then fso.DeleteFile etat, True
sh.Run "cmd /c node scripts\auto-rh.js statusfile", 0, False
On Error GoTo 0

contenu = ""
t0 = Timer
Do While (Timer - t0) < 30
    WScript.Sleep 1000
    If fso.FileExists(etat) Then
        contenu = LireFichier(etat)
        If contenu <> "" Then Exit Do
    End If
Loop

If contenu = "" Then
    MsgBox "Impossible d'obtenir l'etat (verifiez que Node.js est installe).", _
           vbExclamation, "Auto-RH"
    WScript.Quit 1
End If

MsgBox contenu, vbInformation, "Auto-RH - Etat des serveurs"
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
