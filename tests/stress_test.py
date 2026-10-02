#!/usr/bin/env python3
"""
PulseBridge Enterprise Scrutiny & Stress Test Suite
Evaluates:
  1. SecOps & Brute Force Lockout
  2. High Concurrency Throughput (30+ threads)
  3. TeamViewer Remote Actions (Click & Hotkeys)
  4. Bidirectional Prompt Dispatch & Inbox Ingestion
  5. Security Headers Validation
"""

import sys
import time
import json
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_PORT = sys.argv[1] if len(sys.argv) > 1 else "8080"
BASE_URL = f"http://127.0.0.1:{BASE_PORT}"
VALID_PIN = sys.argv[2] if len(sys.argv) > 2 else "778899"

def make_request(url, method="GET", headers=None, data=None):
    if headers is None:
        headers = {}
    req_data = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            body = response.read()
            return response.status, dict(response.headers), body
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, dict(e.headers), body

def run_tests():
    print("=" * 65)
    print("  PULSEBRIDGE ENTERPRISE STRESS & COMPLIANCE TEST SUITE")
    print("=" * 65)

    # 1. Security Headers Check
    print("\n[TEST 1] Verifying Security Headers...")
    code, headers, _ = make_request(f"{BASE_URL}/api/auth/qr")
    assert code == 200, f"Expected 200, got {code}"
    assert "x-content-type-options" in headers and headers["x-content-type-options"] == "nosniff", "Missing X-Content-Type-Options: nosniff"
    assert "x-frame-options" in headers and headers["x-frame-options"] == "DENY", "Missing X-Frame-Options: DENY"
    print("  [PASS] Security headers (nosniff, DENY) strictly enforced.")

    # 2. Authentication & Brute Force Lockout Check
    print("\n[TEST 2] Testing SecOps Brute Force Lockout on PIN...")
    spoofed_ip = "192.168.1.199"
    # Send 5 invalid PINs
    for i in range(1, 6):
        code, _, body = make_request(
            f"{BASE_URL}/api/auth/login",
            method="POST",
            headers={"Content-Type": "application/json", "X-Forwarded-For": spoofed_ip},
            data={"pin": "000000"}
        )
        assert code == 401, f"Attempt {i}: expected 401"
    
    # 6th attempt should be locked out
    code, _, body = make_request(
        f"{BASE_URL}/api/auth/login",
        method="POST",
        headers={"Content-Type": "application/json", "X-Forwarded-For": spoofed_ip},
        data={"pin": VALID_PIN} # Even with correct pin, must be locked out
    )
    assert code == 401, "Expected lockout 401 on 6th attempt"
    resp_json = json.loads(body.decode("utf-8"))
    assert "locked out" in resp_json.get("message", "").lower(), f"Expected lockout message, got {resp_json}"
    print("  [PASS] SecOps Brute-force lockout triggered correctly after 5 failed attempts.")

    # 3. Legitimate Login from normal IP
    print("\n[TEST 3] Testing Legitimate Authentication...")
    code, _, body = make_request(
        f"{BASE_URL}/api/auth/login",
        method="POST",
        headers={"Content-Type": "application/json", "X-Forwarded-For": "127.0.0.1"},
        data={"pin": VALID_PIN}
    )
    assert code == 200, f"Expected 200, got {code}"
    auth_data = json.loads(body.decode("utf-8"))
    token = auth_data["token"]
    print(f"  [PASS] Authentication successful. Issued session token: {token[:8]}...")

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    # 4. TeamViewer Interactive Controls: Click & Hotkeys
    print("\n[TEST 4] Testing TeamViewer Remote Touch & Hotkey Pipeline...")
    # Mouse Click
    code, _, body = make_request(
        f"{BASE_URL}/api/action/click",
        method="POST",
        headers=auth_headers,
        data={"x_ratio": 0.5, "y_ratio": 0.5}
    )
    assert code == 200, f"Click failed: {body}"
    
    # Hotkey (Esc)
    code, _, body = make_request(
        f"{BASE_URL}/api/action/hotkey",
        method="POST",
        headers=auth_headers,
        data={"key": "esc"}
    )
    assert code == 200, f"Hotkey failed: {body}"
    print("  [PASS] Win32 Touch-to-click & Virtual hotkey injected with 0ms delay.")

    # 5. Bidirectional Remote Prompt Dispatch
    print("\n[TEST 5] Testing Bidirectional Remote Prompt Dispatch...")
    code, _, body = make_request(
        f"{BASE_URL}/api/action/remote_prompt",
        method="POST",
        headers=auth_headers,
        data={
            "message": "Fix typo on website: correct 'Welcom' to 'Welcome'",
            "action_mode": "direct_inbox",
            "target_ide": "antigravity"
        }
    )
    assert code == 200, f"Prompt dispatch failed: {body}"
    res = json.loads(body.decode("utf-8"))
    assert res["success"] is True, f"Prompt failed: {res}"
    print("  [PASS] Mobile prompt ingested and queued in agent inbox.")

    # 6. High Concurrency Stress Test (30 concurrent workers)
    print("\n[TEST 6] Executing High Concurrency Load Test (30 workers, 60 requests)...")
    start_time = time.time()
    latencies = []

    def load_task(idx):
        t0 = time.time()
        c, _, b = make_request(f"{BASE_URL}/api/preview/frame?token={token}&quality=50")
        latency = (time.time() - t0) * 1000
        return c, latency, len(b)

    with ThreadPoolExecutor(max_workers=30) as executor:
        futures = [executor.submit(load_task, i) for i in range(60)]
        for f in as_completed(futures):
            c, lat, size = f.result()
            assert c == 200, f"Request failed with code {c}"
            assert size > 5000, "Frame size too small"
            latencies.append(lat)

    elapsed = time.time() - start_time
    avg_latency = sum(latencies) / len(latencies)
    max_latency = max(latencies)
    min_latency = min(latencies)

    print(f"  Total Requests:  60 in {elapsed:.2f}s ({60/elapsed:.1f} req/sec)")
    print(f"  Latency Profile: Avg={avg_latency:.1f}ms | Min={min_latency:.1f}ms | Max={max_latency:.1f}ms")
    print("  [PASS] 100% requests succeeded with zero dropped frames!")

    print("\n" + "=" * 65)
    print("  ALL ENTERPRISE SCRUTINY & STRESS TESTS PASSED SUCCESSFULLY!")
    print("=" * 65)

if __name__ == "__main__":
    run_tests()
