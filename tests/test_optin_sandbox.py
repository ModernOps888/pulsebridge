import requests
import json
import sys

BASE_URL = "http://127.0.0.1:8080"
PIN = sys.argv[1] if len(sys.argv) > 1 else "778899"

print("=========================================================================")
print("  TESTING OPT-IN SHELL SANDBOXING & EXPLOIT BLOCKING (--enable-shell-commands)")
print("=========================================================================")

r = requests.post(f"{BASE_URL}/api/auth/login", json={"pin": PIN})
data = r.json()
assert r.status_code == 200 and data.get("success") == True, "Login failed!"
token = data.get("token")
headers = {"Authorization": f"Bearer {token}"}

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

# 1. Test allowlisted command succeeds
r_good = requests.post(
    f"{BASE_URL}/api/action/remote_prompt",
    headers=headers,
    json={"message": "git status", "action_mode": "execute_command", "command": "git status"}
)
res_good = r_good.json()
record(
    "Allowlisted 'git status' Executed Successfully",
    res_good.get("success") == True and "On branch" in res_good.get("stdout", ""),
    f"Output snippet: {res_good.get('stdout', '').splitlines()[:1]}"
)

# 2. Test disallowed binaries blocked
disallowed = ["whoami", "calc.exe", "cmd.exe", "net user", "curl http://evil.com"]
for cmd in disallowed:
    r = requests.post(
        f"{BASE_URL}/api/action/remote_prompt",
        headers=headers,
        json={"message": cmd, "action_mode": "execute_command", "command": cmd}
    )
    res = r.json()
    record(
        f"Disallowed Binary Blocked: '{cmd}'",
        res.get("success") == False and "approved DevOps allowlist" in res.get("message", ""),
        f"Server rejection: {res.get('message')}"
    )

# 3. Test shell chaining, pipes, and injection blocked even on allowlisted prefixes
injections = [
    ("git status; whoami", "semicolon chaining"),
    ("git status && whoami", "AND chaining"),
    ("git status || whoami", "OR chaining"),
    ("git status | Select-String branch", "pipe operator"),
    ("git status `whoami`", "backtick subshell"),
    ("git status $env:USERPROFILE", "environment variable injection"),
    ("git status > pwned.txt", "output redirect"),
    ("git status < nul", "input redirect"),
]

for cmd, technique in injections:
    r = requests.post(
        f"{BASE_URL}/api/action/remote_prompt",
        headers=headers,
        json={"message": cmd, "action_mode": "execute_command", "command": cmd}
    )
    res = r.json()
    record(
        f"Shell Injection Blocked ({technique}): '{cmd}'",
        res.get("success") == False and "approved DevOps allowlist" in res.get("message", ""),
        f"Server rejection: {res.get('message')}"
    )

print("\n=========================================================================")
print(f"  OPT-IN SANDBOX TEST RESULTS: {passed} PASSED, {failed} FAILED")
print("=========================================================================")
if failed > 0:
    sys.exit(1)
