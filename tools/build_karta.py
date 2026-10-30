# Staging-only offline guest-card builder. It never connects to any Supabase project.
# This branch is not ready for deployment until the test catalog is fully reproduced.
from pathlib import Path
import json
import re
import sys

STAGING_REF = "qnohynnwasoyjakrrrhb"
STAGING_VENUE = "10000000-0000-0000-0000-000000000001"
if "--reuse-data" not in sys.argv:
    raise SystemExit("Staging prohibits online catalog rebuilding. Use --reuse-data; do not deploy until verified.")

root = Path(__file__).resolve().parent.parent
template = (root / "karta/template.html").read_text()
previous = (root / "karta/index.html").read_text()
match = re.search(r"const DATA=(\[.*?\]);const ALL=", previous, re.S)
if not match:
    raise SystemExit("Embedded catalog snapshot is unavailable")
snapshot = match.group(1)
json.loads(snapshot)
for source in (template, previous):
    if STAGING_REF not in source or STAGING_VENUE not in source:
        raise SystemExit("Staging config is missing from guest card")
if template.count("__DATA__") != 1:
    raise SystemExit("Unexpected guest-card catalog placeholder count")
(root / "karta/index.html").write_text(template.replace("__DATA__", snapshot))
print("Staging guest card rebuilt offline; catalog still requires live test-data validation")
