#!/usr/bin/env python3
"""Lanceur daemon (double-fork) de l'administration — port 4000 — via
`next start` (sert directement le build .next, SANS copie standalone).

Utilisé lorsque l'espace disque est insuffisant pour la copie standalone du
build (`next build` échoue à l'étape « Copying standalone » avec ENOSPC alors
que la COMPILATION est complète). Le build .next est alors valide et servi
tel quel — comportement identique côté client. Journal : logs/admin-next.log
"""
import os
import time

LOG = "/home/z/my-project/logs/admin-next.log"
RACINE = "/home/z/my-project"
PORT = "4000"


def daemoniser():
    # 1er fork
    pid = os.fork()
    if pid > 0:
        os._exit(0)  # le parent s'en va tout de suite
    os.setsid()
    # 2e fork
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    os.chdir(RACINE)
    os.umask(0o022)
    # redirige std* vers le journal
    fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 0)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    if fd > 2:
        os.close(fd)


if __name__ == "__main__":
    daemoniser()
    time.sleep(0.3)
    os.environ["NODE_ENV"] = "production"
    os.environ["PORT"] = PORT
    os.environ["HOSTNAME"] = "0.0.0.0"
    os.execv("/usr/bin/env", ["/usr/bin/env", "npx", "next", "start", "-p", PORT, "-H", "0.0.0.0"])
