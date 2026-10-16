#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Task 92 — MINI SERVEUR SMTP LOCAL (bac à sable, AUCUN envoi réel vers
Internet) : la suite test92_send_mail.py configure l'application avec
hôte 127.0.0.1 + ce port, puis l'e-mail « Send Mail » EMIS PAR NODEMAILER
est capturé ICI et écrit sur disque (JSON) pour vérifier SON CONTENU EXACT :
CIN, mot de passe initial, serveur (IP/DNS), port du site web, adresse du
portail.

Protocole implémenté : EHLO/HELO, AUTH PLAIN/LOGIN, MAIL FROM, RCPT TO,
DATA (jusqu'à « . »), RSET, NOOP, QUIT. Chaque message accepté devient un
fichier <out>/message-<n>.json : {"from", "to", "data"}.

Usage : python3 scripts/test92_serveur_smtp.py --port 1925 --out <dossier>
"""
import argparse
import base64
import json
import os
import socket
import threading


class ServeurSMTP:
    def __init__(self, port: int, out: str):
        self.port = port
        self.out = out
        self.compteur = 0
        self.verrou = threading.Lock()
        os.makedirs(out, exist_ok=True)

    def sauver(self, mail_from: str, rcpts: list, data: bytes):
        with self.verrou:
            self.compteur += 1
            chemin = os.path.join(self.out, f"message-{self.compteur}.json")
            with open(chemin, "w", encoding="utf-8") as f:
                json.dump(
                    {"from": mail_from, "to": rcpts, "data": data.decode("utf-8", "replace")},
                    f, ensure_ascii=False,
                )
            print(f"[SMTP] message #{self.compteur} capture ({len(data)} octets)", flush=True)

    def traiter(self, conn: socket.socket):
        try:
            tampon = b""

            def envoyer(ligne: bytes):
                conn.sendall(ligne + b"\r\n")

            envoyer(b"220 test92.smtp Auto-RH-test ESMTP")
            mail_from = ""
            rcpts: list = []
            en_data = False
            corps = b""
            while True:
                ligne = conn.recv(65536)
                if not ligne:
                    break
                tampon += ligne
                while b"\r\n" in tampon:
                    brut, tampon = tampon.split(b"\r\n", 1)
                    if en_data:
                        if brut == b".":
                            self.sauver(mail_from, rcpts, corps)
                            envoyer(b"250 OK: message accepte")
                            en_data = False
                            corps = b""
                            mail_from = ""
                            rcpts = []
                        else:
                            # transparence SMTP : « .. » initial -> « . »
                            if brut.startswith(b".."):
                                brut = brut[1:]
                            corps += brut + b"\r\n"
                        continue
                    haut = brut.upper()
                    if haut.startswith(b"EHLO") or haut.startswith(b"HELO"):
                        envoyer(b"250-test92.smtp")
                        envoyer(b"250-8BITMIME")
                        envoyer(b"250-SIZE 20971520")
                        envoyer(b"250-AUTH PLAIN LOGIN")
                        envoyer(b"250 OK")
                    elif haut.startswith(b"AUTH PLAIN"):
                        # « AUTH PLAIN <b64> » ou forme initiale vide
                        parties = brut.split(b" ")
                        if len(parties) >= 3:
                            envoyer(b"235 2.7.0 Accepted")
                        else:
                            envoyer(b"334 ")
                            if b"\r\n" not in tampon:
                                suite = conn.recv(65536)
                                tampon += suite
                            envoyer(b"235 2.7.0 Accepted")
                    elif haut.startswith(b"AUTH LOGIN"):
                        envoyer(b"334 VXNlcm5hbWU6")
                        if b"\r\n" not in tampon:
                            tampon += conn.recv(65536)
                        brut2, tampon = tampon.split(b"\r\n", 1)
                        try:
                            base64.b64decode(brut2)
                        except Exception:
                            pass
                        envoyer(b"334 UGFzc3dvcmQ6")
                        if b"\r\n" not in tampon:
                            tampon += conn.recv(65536)
                        brut3, tampon = tampon.split(b"\r\n", 1)
                        try:
                            base64.b64decode(brut3)
                        except Exception:
                            pass
                        envoyer(b"235 2.7.0 Accepted")
                    elif haut.startswith(b"MAIL FROM:"):
                        mail_from = brut.split(b":", 1)[1].strip().strip(b"<>").decode("utf-8", "replace")
                        envoyer(b"250 2.1.0 OK")
                    elif haut.startswith(b"RCPT TO:"):
                        dest = brut.split(b":", 1)[1].strip().strip(b"<>").decode("utf-8", "replace")
                        rcpts.append(dest)
                        envoyer(b"250 2.1.5 OK")
                    elif haut.startswith(b"DATA"):
                        envoyer(b"354 End data with <CR><LF>.<CR><LF>")
                        en_data = True
                        corps = b""
                    elif haut.startswith(b"RSET"):
                        mail_from = ""
                        rcpts = []
                        envoyer(b"250 2.0.0 OK")
                    elif haut.startswith(b"NOOP"):
                        envoyer(b"250 2.0.0 OK")
                    elif haut.startswith(b"QUIT"):
                        envoyer(b"221 2.0.0 Bye")
                        return
                    else:
                        envoyer(b"500 5.5.2 Commande non reconnue")
        except Exception as e:  # noqa: BLE001
            print(f"[SMTP] connexion interrompue : {e}", flush=True)
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def demarrer(self):
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.port))
        srv.listen(8)
        print(f"[SMTP] mini serveur SMTP en ecoute sur 127.0.0.1:{self.port} (sortie: {self.out})", flush=True)
        while True:
            conn, _ = srv.accept()
            t = threading.Thread(target=self.traiter, args=(conn,), daemon=True)
            t.start()


if __name__ == "__main__":
    parseur = argparse.ArgumentParser()
    parseur.add_argument("--port", type=int, required=True)
    parseur.add_argument("--out", required=True)
    args = parseur.parse_args()
    ServeurSMTP(args.port, args.out).demarrer()
