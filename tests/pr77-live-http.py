"""Test-only gateway probes; no employee credentials or external models.

Run from repo root after deploying the generated runtime probe to mixora-b5-test.
The ignored key file contains only that project's public anon API key.
"""
import base64
import json
import pathlib
import urllib.error
import urllib.request

REF = "qnohynnwasoyjakrrrhb"
BASE = f"https://{REF}.supabase.co"
KEY = json.loads(pathlib.Path(".local-tests/stage-public-key.json").read_text())["key"]
RESULTS = []

def call(path, method="GET", body=None, token=KEY, use_key=True):
    headers = {"Content-Type": "application/json"}
    if use_key:
        headers["apikey"] = KEY
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(BASE + path, method=method, headers=headers,
                                 data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())

def check(name, ok, status):
    RESULTS.append({"name": name, "passed": bool(ok), "http_status": status})
    assert ok, name
    print("PASS", name, status)

status, runtime = call("/functions/v1/pr77-runtime-check")
check("Deno authentication helper regressions", status == 200 and runtime.get("passed") == 12, status)
status, _ = call("/functions/v1/pr77-runtime-check", token=None, use_key=False)
check("Edge gateway rejects missing authorization", status == 401, status)
status, _ = call("/rest/v1/rpc/apply_stock", "POST", {"p_request_id": "00000000-0000-0000-0000-000000000000", "p_items": []})
check("PostgREST denies anonymous stock RPC", status in (401, 403), status)
status, _ = call("/rest/v1/flavor_packs?select=flavor_id,pack_g")
check("PostgREST denies anonymous private pack settings", status in (401, 403), status)
status, _ = call("/rest/v1/flavor_strengths?select=flavor_id,strength")
check("PostgREST serves guest strength endpoint", status == 200, status)
enc = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")
forged = enc({"alg": "none"}) + "." + enc({"sub": "700001", "role": "authenticated", "exp": 4102444800}) + ".x"
status, _ = call("/rest/v1/stock?select=flavor_id", token=forged)
check("PostgREST rejects forged employee JWT", status == 401, status)
pathlib.Path(".local-tests/live-http-results.json").write_text(json.dumps({"project": REF, "checks": RESULTS, "runtime": runtime}, indent=2))
print("Saved live HTTP evidence (public key excluded).")
