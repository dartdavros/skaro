"""Write a Django-shell input stream; never opens an SSH connection itself."""

import argparse
import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--apply", action="store_true", help="Publish instead of a read-only preflight")
arguments = parser.parse_args()
encoded = base64.b64encode((ROOT / "out" / "payload.json").read_bytes()).decode("ascii")
print("import base64, json")
print(f"PAYLOAD = json.loads(base64.b64decode({encoded!r}))")
print(f"APPLY = {arguments.apply!r}")
print((ROOT / "publish.py").read_text(encoding="utf-8"))
