#!/usr/bin/env python3
"""Lanceur daemon (double-fork) du PORTAIL EMPLOYÉ — port 4001.

Même technique que lancer-admin-daemon.py : le parent se termine
immédiatement, l'enfant (re-parenté vers init, nouvelle session) survit à la
fin du shell appelant. Journal : logs/portail.log
"""
import os
import time

LOG = "/home/z/my-project/logs/portail.log"
RACINE = "/home/z/my-project"
PORT = "4001"


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
    os.environ["PORTAL_PORT"] = PORT
    os.execv("/usr/bin/node", ["/usr/bin/node", os.path.join(RACINE, "scripts", "portail-server.js")])
