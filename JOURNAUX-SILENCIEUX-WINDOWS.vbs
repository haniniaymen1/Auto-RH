' ============================================================
'  Fiches de Paie - VOIR LES JOURNAUX (mode silencieux)
'
'  Double-cliquez : ouvre le dossier logs\ qui contient :
'    - auto-rh-preparation.log    (preparation + demarrage)
'    - auto-rh-administration.log (console du site, port 4000)
'    - auto-rh-portail.log        (console du portail, port 4001)
'
'  Utile pour diagnostiquer un probleme quand les serveurs
'  tournent en arriere-plan (aucune fenetre CMD visible).
' ============================================================
Option Explicit
Dim sh, fso, dossier, logs
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
logs = fso.BuildPath(dossier, "logs")

If Not fso.FolderExists(logs) Then
    MsgBox "Aucun journal pour le moment : les serveurs n'ont jamais ete " & _
           "lances en mode silencieux." & vbCrLf & vbCrLf & _
           "Lancez d'abord DEMARRER-SILENCIEUX-WINDOWS.vbs", _
           vbInformation, "Auto-RH"
    WScript.Quit 0
End If

On Error Resume Next
sh.Run "explorer.exe """ & logs & """"
On Error GoTo 0
WScript.Quit 0
