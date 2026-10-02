import requests
import json
import sys
import time

BASE_URL = "http://127.0.0.1:8080"
PIN = sys.argv[1] if len(sys.argv) > 1 else "628302"

print("==================================================================")
print("     PULSEBRIDGE ZERO-TRUST DEEP VERIFICATION TEST SUITE          ")
print("==================================================================")

tests_passed = 0
tests_total = 0

def assert_test(name, condition, details=""):
    global tests_passed, tests_total
    tests_total += 1
    if condition:
        tests_passed += 1
        print(f"  [PASS] {name} {details}")
    else:
        print(f"  [FAIL] {name} - FAILED! {details}")
        sys.exit(1)

# 1. TEST PWA ASSETS & WEB SERVER
print("\n[*] Phase 1: PWA Manifest & Web Server Serving")
r = requests.get(f"{BASE_URL}/")
r.encoding = "utf-8"
assert_test("HTML Root Status 200", r.status_code == 200)
assert_test("HTML Title Verified", "PulseBridge" in r.text)
assert_test("PWA Manifest Linked", 'href="/manifest.json"' in r.text)

r = requests.get(f"{BASE_URL}/manifest.json")
assert_test("manifest.json Status 200", r.status_code == 200)
manifest = r.json()
assert_test("manifest.json Name Correct", manifest.get("short_name") == "PulseBridge")

r = requests.get(f"{BASE_URL}/sw.js")
assert_test("sw.js Service Worker Status 200", r.status_code == 200)
assert_test("sw.js Content Verified", "SHOW_NOTIFICATION" in r.text)

# 2. TEST ZERO-TRUST ACTION ENDPOINT GATING (UNAUTHENTICATED ACCESS MUST BE REJECTED)
print("\n[*] Phase 2: Zero-Trust Security Gating (Unauthenticated Calls Blocked)")
r_unauth_clip = requests.get(f"{BASE_URL}/api/action/clipboard")
assert_test("Unauthenticated GET /api/action/clipboard Blocked 401", r_unauth_clip.status_code == 401)

r_unauth_clip_post = requests.post(f"{BASE_URL}/api/action/clipboard", json={"text": "evil"})
assert_test("Unauthenticated POST /api/action/clipboard Blocked 401", r_unauth_clip_post.status_code == 401)

r_unauth_click = requests.post(f"{BASE_URL}/api/action/click", json={"x_ratio": 0.5, "y_ratio": 0.5})
assert_test("Unauthenticated POST /api/action/click Blocked 401", r_unauth_click.status_code == 401)

r_unauth_hotkey = requests.post(f"{BASE_URL}/api/action/hotkey", json={"key": "ctrl_z"})
assert_test("Unauthenticated POST /api/action/hotkey Blocked 401", r_unauth_hotkey.status_code == 401)

r_unauth_scroll = requests.post(f"{BASE_URL}/api/action/scroll", json={"delta": 120})
assert_test("Unauthenticated POST /api/action/scroll Blocked 401", r_unauth_scroll.status_code == 401)

r_unauth_prompt = requests.post(f"{BASE_URL}/api/action/remote_prompt", json={"message": "calc.exe"})
assert_test("Unauthenticated POST /api/action/remote_prompt Blocked 401", r_unauth_prompt.status_code == 401)

r_unauth_ingest = requests.post(f"{BASE_URL}/api/ingest/event", json={"event_type": "step"})
assert_test("Unauthenticated POST /api/ingest/event Blocked 401", r_unauth_ingest.status_code == 401)

# 3. TEST AUTHENTICATION & DYNAMIC TOKEN ISSUANCE
print("\n[*] Phase 3: Authentication & Token Issuance")
r = requests.post(f"{BASE_URL}/api/auth/login", json={"pin": PIN})
assert_test("Login Valid PIN Status 200", r.status_code == 200)
data = r.json()
assert_test("Login Success True", data.get("success") == True)
TOKEN = data.get("token")
assert_test("Login Token Issued", bool(TOKEN), f"(Token: {TOKEN[:8]}...)")

r = requests.post(f"{BASE_URL}/api/auth/login", json={"pin": "000000"})
assert_test("Login Invalid PIN Status 401", r.status_code == 401)
assert_test("Login Invalid PIN Success False", r.json().get("success") == False)

# 4. TEST RESTRICTED CORS POLICY (EXTERNAL ORIGINS MUST NOT BE ALLOWED)
print("\n[*] Phase 4: Restricted CORS Policy Verification")
cors_headers = {
    "Origin": "https://malicious-attacker-website.com",
    "Access-Control-Request-Method": "POST",
}
r_cors = requests.options(f"{BASE_URL}/api/action/remote_prompt", headers=cors_headers)
allowed_origin = r_cors.headers.get("access-control-allow-origin", "")
assert_test("Malicious Origin Rejected by CORS", allowed_origin != "https://malicious-attacker-website.com" and allowed_origin != "*")

# 5. TEST AUTHENTICATED WORKSTATION CLIPBOARD SYNC (READ & WRITE)
print("\n[*] Phase 5: Authenticated Workstation Clipboard Sync (Win32 CF_UNICODETEXT)")
test_clip_text = f"PulseBridge-ZeroTrust-Clipboard-{int(time.time())}"
r = requests.post(
    f"{BASE_URL}/api/action/clipboard",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"text": test_clip_text}
)
assert_test("POST /api/action/clipboard Status 200", r.status_code == 200)
assert_test("POST /api/action/clipboard Success True", r.json().get("success") == True)

r = requests.get(
    f"{BASE_URL}/api/action/clipboard",
    headers={"Authorization": f"Bearer {TOKEN}"}
)
assert_test("GET /api/action/clipboard Status 200", r.status_code == 200)
retrieved_clip = r.json().get("text")
assert_test("Workstation Clipboard Read Back Exact Match", retrieved_clip == test_clip_text, f"(got '{retrieved_clip}')")

# 6. TEST AUTHENTICATED REMOTE MOUSE WHEEL SCROLLING (Win32 MOUSEEVENTF_WHEEL)
print("\n[*] Phase 6: Authenticated Remote Mouse Wheel Scrolling")
r = requests.post(
    f"{BASE_URL}/api/action/scroll",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"delta": 120}
)
assert_test("POST /api/action/scroll Up (+120) Status 200", r.status_code == 200)
assert_test("Scroll Up Success True", r.json().get("success") == True)

r = requests.post(
    f"{BASE_URL}/api/action/scroll",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"delta": -120}
)
assert_test("POST /api/action/scroll Down (-120) Status 200", r.status_code == 200)
assert_test("Scroll Down Success True", r.json().get("success") == True)

# 7. TEST AUTHENTICATED REMOTE HOTKEYS (EXTENDED KEYS)
print("\n[*] Phase 7: Authenticated Remote Extended Hotkeys Injection")
for key in ["ctrl_z", "ctrl_y", "ctrl_a", "tab", "esc", "up", "down"]:
    r = requests.post(
        f"{BASE_URL}/api/action/hotkey",
        headers={"Authorization": f"Bearer {TOKEN}"},
        json={"key": key}
    )
    assert_test(f"Hotkey '{key}' Status 200", r.status_code == 200)
    assert_test(f"Hotkey '{key}' Success True", r.json().get("success") == True)

# 8. TEST OPTO-IN SHELL EXECUTION HARDENING & ALLOWLIST
print("\n[*] Phase 8: Opt-In Shell Execution Policy & Allowlist Check")
r_shell = requests.post(
    f"{BASE_URL}/api/action/remote_prompt",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={
        "message": "git status",
        "action_mode": "execute_command",
        "command": "git status"
    }
)
assert_test("Remote Command Request Handled Status 200", r_shell.status_code == 200)
shell_res = r_shell.json()
# If server started without --enable-shell-commands, verify it was blocked for Zero-Trust hardening
if not shell_res.get("success"):
    assert_test("Zero-Trust Shell Hardening Blocked Default Execution", "Security Policy" in shell_res.get("message", ""))
else:
    assert_test("Allowlisted Command Succeeded When Opted-In", "On branch" in shell_res.get("stdout", ""))

# Test that non-allowlisted arbitrary command is blocked
r_evil = requests.post(
    f"{BASE_URL}/api/action/remote_prompt",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={
        "message": "whoami",
        "action_mode": "execute_command",
        "command": "whoami"
    }
)
assert_test("Arbitrary Non-Allowlisted Command Blocked", r_evil.json().get("success") == False)

# 9. TEST SCREEN CAPTURE & QUALITY PROFILES
print("\n[*] Phase 9: Live Screen Capture & Stream Quality Profiles")
r_eco = requests.get(f"{BASE_URL}/api/preview/frame?token={TOKEN}&quality=40")
assert_test("Preview Frame Eco (40%) Status 200", r_eco.status_code == 200)
assert_test("Preview Frame Eco Content-Type image/jpeg", r_eco.headers.get("content-type") == "image/jpeg")
assert_test("Preview Frame Eco Bytes Non-Empty", len(r_eco.content) > 1000)

r_retina = requests.get(f"{BASE_URL}/api/preview/frame?token={TOKEN}&quality=90")
assert_test("Preview Frame Retina (90%) Status 200", r_retina.status_code == 200)
assert_test("Preview Frame Retina Content-Type image/jpeg", r_retina.headers.get("content-type") == "image/jpeg")
assert_test("Preview Frame Retina Higher Payload Than Eco", len(r_retina.content) > len(r_eco.content), f"({len(r_retina.content)} > {len(r_eco.content)} bytes)")

# 10. TEST BIDIRECTIONAL CHAT PROMPT DISPATCH & INGEST STREAM
print("\n[*] Phase 10: Bidirectional Prompt Dispatch & Ingest Event Stream")
r_prompt = requests.post(
    f"{BASE_URL}/api/action/prompt",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"message": "Remote prompt test ping"}
)
assert_test("POST /api/action/prompt Status 200", r_prompt.status_code == 200)

prompt_text = f"Automated Verification Event {int(time.time())}"
r_ingest = requests.post(
    f"{BASE_URL}/api/ingest/event",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={
        "ide": "antigravity",
        "event_type": "step",
        "content": prompt_text,
        "status": "DONE"
    }
)
assert_test("POST /api/ingest/event Status 200", r_ingest.status_code == 200)

r = requests.get(f"{BASE_URL}/api/chat?token={TOKEN}")
assert_test("GET /api/chat Status 200", r.status_code == 200)
data = r.json()
steps = data if isinstance(data, list) else data.get("steps", [])
found = any(s.get("content") == prompt_text for s in steps)
assert_test("Chat Stream Recorded Prompt Step", found)

# 11. TEST SVG QR CODE GENERATION
print("\n[*] Phase 11: SVG QR Generation")
r_qr = requests.get(f"{BASE_URL}/api/auth/qr")
assert_test("GET /api/auth/qr Status 200", r_qr.status_code == 200)
assert_test("QR Code Content-Type image/svg+xml", "image/svg+xml" in r_qr.headers.get("content-type", ""))
assert_test("QR Code SVG XML Valid", "<svg" in r_qr.text and "</svg>" in r_qr.text)

# 12. TEST REMOTE TOUCH-TO-CLICK SIMULATION
print("\n[*] Phase 12: Remote Touch-to-Click Simulation")
r_click = requests.post(
    f"{BASE_URL}/api/action/click",
    headers={"Authorization": f"Bearer {TOKEN}"},
    json={"x_ratio": 0.5, "y_ratio": 0.5, "is_right": False}
)
assert_test("POST /api/action/click Status 200", r_click.status_code == 200)
assert_test("Click Success True", r_click.json().get("success") == True)

# 13. TEST IDE WINDOW ENUMERATION
print("\n[*] Phase 13: Discovered IDE Windows Enumeration")
r_win = requests.get(
    f"{BASE_URL}/api/ide/windows",
    headers={"Authorization": f"Bearer {TOKEN}"}
)
assert_test("GET /api/ide/windows Status 200", r_win.status_code == 200)
win_list = r_win.json()
assert_test("IDE Windows Is List", isinstance(win_list, list))

print("\n==================================================================")
print(f"     ALL {tests_total}/{tests_total} ZERO-TRUST CHECKS PASSED WITH 100% SUCCESS!   ")
print("==================================================================")
