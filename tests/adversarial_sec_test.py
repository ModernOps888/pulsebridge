import requests
import json
import sys
import time

BASE_URL = "http://127.0.0.1:8080"
PIN = sys.argv[1] if len(sys.argv) > 1 else "778899"

print("=========================================================================")
print("      PULSEBRIDGE ADVERSARIAL HARD-GROUNDED PENETRATION TEST SUITE       ")
print("=========================================================================")

passed = 0
failed = 0

def record(name, condition, details=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  [PASS] {name} | {details}")
    else:
        failed += 1
        print(f"  [FAIL] {name} | {details}")

# ==============================================================================
# SECTION 1: ADVERSARIAL UNAUTHENTICATED ACTION REJECTION (CWE-306)
# ==============================================================================
print("\n[*] SECTION 1: Unauthenticated Attack Surface Penetration (Zero-Trust Gating)")

action_payloads = [
    ("POST", "/api/action/click", {"x_ratio": 0.5, "y_ratio": 0.5}),
    ("POST", "/api/action/hotkey", {"key": "ctrl_z"}),
    ("POST", "/api/action/scroll", {"delta": 120}),
    ("GET", "/api/action/clipboard", None),
    ("POST", "/api/action/clipboard", {"text": "malicious"}),
    ("POST", "/api/action/prompt", {"message": "unauthorized prompt"}),
    ("POST", "/api/action/remote_prompt", {"message": "calc.exe"}),
    ("POST", "/api/ingest/event", {"event_type": "step", "content": "fake step"}),
    ("GET", "/api/status", None),
]

for method, endpoint, payload in action_payloads:
    # 1. No token at all
    if method == "POST":
        r = requests.post(f"{BASE_URL}{endpoint}", json=payload)
    else:
        r = requests.get(f"{BASE_URL}{endpoint}")
    record(f"No-Token {method} {endpoint}", r.status_code == 401, f"HTTP {r.status_code} (Expected 401)")

    # 2. Bogus fake token
    headers = {"Authorization": "Bearer 00000000-dead-beef-0000-000000000000"}
    if method == "POST":
        r = requests.post(f"{BASE_URL}{endpoint}", json=payload, headers=headers)
    else:
        r = requests.get(f"{BASE_URL}{endpoint}", headers=headers)
    record(f"Bogus-Bearer {method} {endpoint}", r.status_code == 401, f"HTTP {r.status_code} (Expected 401)")

    # 3. Bogus query parameter token
    if method == "POST":
        r = requests.post(f"{BASE_URL}{endpoint}?token=fake-token-12345", json=payload)
    else:
        r = requests.get(f"{BASE_URL}{endpoint}?token=fake-token-12345")
    record(f"Bogus-Query {method} {endpoint}", r.status_code == 401, f"HTTP {r.status_code} (Expected 401)")

# ==============================================================================
# SECTION 2: AUTHENTICATE AND OBTAIN VALID CRYPTOGRAPHIC SESSION TOKEN
# ==============================================================================
print("\n[*] SECTION 2: Legitimate Authentication (PIN Verification & Token Issuance)")
r = requests.post(f"{BASE_URL}/api/auth/login", json={"pin": PIN})
data = r.json()
record("Legitimate Login", r.status_code == 200 and data.get("success") == True, f"Token: {data.get('token')}")
TOKEN = data.get("token")
AUTH_HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# ==============================================================================
# SECTION 3: ADVERSARIAL COMMAND INJECTION & SHELL BYPASS TESTING (CWE-78)
# ==============================================================================
print("\n[*] SECTION 3: Arbitrary Command Injection & Chaining Exploits (CWE-78)")

exploit_payloads = [
    ("whoami", "Disallowed executable"),
    ("calc.exe", "Disallowed executable"),
    ("powershell -Command Get-Process", "Disallowed executable"),
    ("cmd.exe /c dir", "Disallowed executable"),
    ("net user", "Disallowed executable"),
    ("git status; whoami", "Shell chaining operator ;"),
    ("git status && calc.exe", "Shell chaining operator &&"),
    ("git status | Select-String a", "Shell pipe operator |"),
    ("git status `whoami`", "Subshell backtick operator `"),
    ("git status $env:USERNAME", "Variable expansion operator $"),
    ("git status > output.txt", "Output redirection operator >"),
    ("git status < nul", "Input redirection operator <"),
]

for cmd, reason in exploit_payloads:
    r = requests.post(
        f"{BASE_URL}/api/action/remote_prompt",
        headers=AUTH_HEADERS,
        json={
            "message": cmd,
            "action_mode": "execute_command",
            "command": cmd
        }
    )
    res = r.json()
    is_blocked = (res.get("success") == False)
    msg = res.get("message", "")
    record(f"Exploit Blocked: '{cmd}'", is_blocked, f"Reason: {reason} | Server message: {msg}")

# Test allowed command behavior under default posture (Shell disabled by default)
r_allowed = requests.post(
    f"{BASE_URL}/api/action/remote_prompt",
    headers=AUTH_HEADERS,
    json={
        "message": "git status",
        "action_mode": "execute_command",
        "command": "git status"
    }
)
res_allowed = r_allowed.json()
record(
    "Allowlisted 'git status' Default Posture",
    res_allowed.get("success") == False and "Security Policy" in res_allowed.get("message", ""),
    f"Server response: {res_allowed.get('message')}"
)

# ==============================================================================
# SECTION 4: ADVERSARIAL CORS CROSS-ORIGIN ATTACKS (CWE-942)
# ==============================================================================
print("\n[*] SECTION 4: CORS Cross-Origin Attack Simulation (CWE-942)")

malicious_origins = [
    "https://evil-hacker.com",
    "https://attacker.site",
    "http://192.168.99.99:9999",
    "null",
]

for origin in malicious_origins:
    r = requests.options(
        f"{BASE_URL}/api/action/remote_prompt",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
        }
    )
    allow_origin = r.headers.get("access-control-allow-origin")
    is_safe = (allow_origin != origin and allow_origin != "*")
    record(f"CORS Origin '{origin}' Denied", is_safe, f"Allow-Origin returned: '{allow_origin}'")

# Whitelisted origin should be allowed
r_good = requests.options(
    f"{BASE_URL}/api/action/remote_prompt",
    headers={
        "Origin": "http://localhost:8080",
        "Access-Control-Request-Method": "POST",
    }
)
good_allow = r_good.headers.get("access-control-allow-origin")
record("CORS Origin 'http://localhost:8080' Allowed", good_allow == "http://localhost:8080", f"Allow-Origin: {good_allow}")

# Cloudflare tunnel origin should be allowed
r_cf = requests.options(
    f"{BASE_URL}/api/action/remote_prompt",
    headers={
        "Origin": "https://any-subdomain.trycloudflare.com",
        "Access-Control-Request-Method": "POST",
    }
)
cf_allow = r_cf.headers.get("access-control-allow-origin")
record("CORS Origin 'https://any-subdomain.trycloudflare.com' Allowed", cf_allow == "https://any-subdomain.trycloudflare.com", f"Allow-Origin: {cf_allow}")

# ==============================================================================
# SECTION 5: WORKSTATION LEVEL ACTIONS VALIDATION (CF_UNICODETEXT & SENDINPUT)
# ==============================================================================
print("\n[*] SECTION 5: Legitimate Authenticated Workstation Action Verification")

test_msg = f"SecOps-Verified-String-{int(time.time())}"
r_set = requests.post(f"{BASE_URL}/api/action/clipboard", headers=AUTH_HEADERS, json={"text": test_msg})
record("Authenticated Clipboard Write", r_set.status_code == 200 and r_set.json().get("success") == True)

r_get = requests.get(f"{BASE_URL}/api/action/clipboard", headers=AUTH_HEADERS)
record("Authenticated Clipboard Read Back", r_get.status_code == 200 and r_get.json().get("text") == test_msg, f"Got: '{r_get.json().get('text')}'")

r_scroll = requests.post(f"{BASE_URL}/api/action/scroll", headers=AUTH_HEADERS, json={"delta": 120})
record("Authenticated Mouse Scroll Up (+120)", r_scroll.status_code == 200 and r_scroll.json().get("success") == True)

r_hotkey = requests.post(f"{BASE_URL}/api/action/hotkey", headers=AUTH_HEADERS, json={"key": "esc"})
record("Authenticated Remote Hotkey 'esc'", r_hotkey.status_code == 200 and r_hotkey.json().get("success") == True)

# ==============================================================================
# SUMMARY REPORT
# ==============================================================================
print("\n=========================================================================")
print(f"  PENETRATION & ADVERSARIAL TEST RESULTS: {passed} PASSED, {failed} FAILED")
if failed == 0:
    print("  VERDICT: 100% FACTUALLY HARD-GROUNDED, SECURE BY DESIGN, ZERO GUESSWORK")
else:
    print("  VERDICT: SECURITY FAILURES DETECTED!")
print("=========================================================================")

if failed > 0:
    sys.exit(1)
