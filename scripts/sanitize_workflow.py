#!/usr/bin/env python3
"""
Bereinigt einen n8n-Workflow-Export, bevor er öffentlich auf GitHub landet.

Aufruf:
    python3 scripts/sanitize_workflow.py mein-export.json workflow/kicktipp-agent.json

Was passiert:
  - entfernt gepinnte Testdaten (pinData), Instanz-ID, Versions- und Workflow-IDs
  - entfernt Credential-IDs (der Credential-Typ bleibt, damit der Import funktioniert)
  - ersetzt Telegram-Chat-IDs durch einen Platzhalter
  - sucht danach nach typischen Schlüsselmustern und bricht ab, falls etwas übrig ist
"""
import json
import re
import sys

PLATZHALTER_CHAT = "DEINE_CHAT_ID"

# Muster für Schlüssel, die nie in einem öffentlichen Repo stehen dürfen
MUSTER = {
    "Telegram-Bot-Token": r"\b\d{8,10}:[A-Za-z0-9_-]{30,}\b",
    "Anthropic-API-Key": r"sk-ant-[A-Za-z0-9_-]{10,}",
    "OpenAI-API-Key": r"\bsk-(proj-)?[A-Za-z0-9_-]{20,}",
    "Google-API-Key": r"\bAIza[0-9A-Za-z_-]{30,}",
    "Odds-API-Key (32 Hex-Zeichen)": r"\b[0-9a-f]{32}\b",
    "apiKey als URL-Parameter": r"apiKey=[^&\s\"']+",
    "E-Mail-Adresse": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
}


def bereinige(wf):
    for feld in ("pinData", "id", "versionId", "triggerCount", "shared", "staticData"):
        wf.pop(feld, None)
    wf.setdefault("meta", {}).pop("instanceId", None)
    if not wf["meta"]:
        wf.pop("meta")
    wf["pinData"] = {}

    for node in wf.get("nodes", []):
        node.pop("webhookId", None)
        for cred in (node.get("credentials") or {}).values():
            cred.pop("id", None)
        params = node.get("parameters", {})
        if "chatId" in params:
            params["chatId"] = PLATZHALTER_CHAT
    return wf


def pruefe(text):
    treffer = []
    for name, muster in MUSTER.items():
        for m in re.finditer(muster, text):
            treffer.append(f"{name}: …{m.group(0)[-6:]}")
    return treffer


def main():
    if len(sys.argv) != 3:
        sys.exit("Aufruf: python3 sanitize_workflow.py <export.json> <ziel.json>")
    with open(sys.argv[1], encoding="utf-8") as f:
        wf = json.load(f)
    text = json.dumps(bereinige(wf), ensure_ascii=False, indent=2)
    treffer = pruefe(text)
    if treffer:
        print("ABBRUCH – möglicherweise sensible Daten gefunden:")
        for t in treffer:
            print("  -", t)
        sys.exit(1)
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        f.write(text + "\n")
    print(f"Sauber. Geschrieben nach {sys.argv[2]}")


if __name__ == "__main__":
    main()
