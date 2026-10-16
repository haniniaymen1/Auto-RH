#!/usr/bin/env python3
"""Task 36 : AUCUNE donnée de contenu dans les résultats de recherche.

La recherche par CIN analyse le contenu intégral des fiches pour TROUVER le
numéro, mais ne doit plus rien renvoyer de ce contenu :

  A. mode liste : aucun snippet dans la réponse ;
  B. mode recherche (?cin=...) : aucun snippet (extrait du texte brut des
     bulletins) dans les items — les données issues de l'analyse « dans tous
     les champs » n'apparaissent plus, ni dans l'interface ni dans la réponse
     JSON brute ;
  C. comportement de recherche INCHANGÉ (régression) : résultats corrects,
     CIN inexistant -> 0 résultat, sans erreur.

Les comptes RÉELS (it@demo.tn / rh@demo.tn) ne sont JAMAIS modifiés :
le test se connecte uniquement en lecture (GET).
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar

BASE = "http://localhost:4000"
EMAIL, PASSWORD = "it@demo.tn", "demo1234"

resultats = []


def check(libelle, ok, detail=""):
    resultats.append(ok)
    print(("OK " if ok else "KO ") + libelle + ((" — " + str(detail)[:140]) if detail else ""))


cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))


def requete(methode, chemin, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        BASE + chemin, data=data, method=methode,
        headers={"Content-Type": "application/json"},
    )
    try:
        with opener.open(req, timeout=60) as rep:
            return rep.status, json.loads(rep.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


# ---- Connexion ----
st, js = requete("POST", "/api/auth/login",
                 {"email": EMAIL, "password": PASSWORD, "remember": False})
check("connexion IT (" + EMAIL + ")", st == 200, f"{st}")

# ---- A. Mode liste ----
st, js = requete("GET", "/api/payslips")
check("liste fiches 200 (mode list)", st == 200 and js.get("mode") == "list",
      f"{st} total={js.get('total')}")
items = js.get("items", [])
check("liste : AUCUN snippet non vide", all(not it.get("snippet") for it in items),
      f"{len(items)} fiches")

cin = next((it["cin"] for it in items if it.get("cin")), None)
check("au moins une fiche avec CIN détecté", bool(cin), cin)

# ---- B. Mode recherche ----
st, js = requete("GET", "/api/payslips?cin=" + urllib.parse.quote(str(cin)))
check("recherche par CIN 200 (mode search)", st == 200 and js.get("mode") == "search",
      f"{st} total={js.get('total')}")
res = js.get("items", [])
check("recherche : résultats non vides", len(res) > 0, f"{len(res)} résultat(s)")
check("recherche : AUCUN snippet non vide (données de contenu absentes)",
      all(not it.get("snippet") for it in res))
check("recherche : aucune clé de contenu brut dans la réponse",
      all("content" not in it and "normalizedContent" not in it for it in res))

# ---- C. Régressions de comportement ----
st, js = requete("GET", "/api/payslips?cin=" + urllib.parse.quote(str(cin)))
check("recherche : la fiche du CIN est retrouvée",
      st == 200 and js.get("total", 0) >= 1, f"total={js.get('total')}")

st, js = requete("GET", "/api/payslips?cin=00000000")
check("CIN inexistant -> 0 résultat sans erreur",
      st == 200 and js.get("total") == 0, f"{st} total={js.get('total')}")

st, js = requete("GET", "/api/payslips?cin=12")
check("CIN trop court -> 400 avec message",
      st == 400 and "complet" in js.get("error", ""), f"{st}")

total_ok = sum(resultats)
print(f"TASK36: {total_ok}/{len(resultats)} vérifications OK")
sys.exit(0 if all(resultats) else 1)
