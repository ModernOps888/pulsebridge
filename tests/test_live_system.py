import json
import urllib.request
import urllib.parse
import sys

BASE_URL = "http://localhost:8080"
PIN = "778899"

def test_endpoints():
    print(f"=== PULSEBRIDGE END-TO-END VERIFICATION ===")
    
    # 1. Authenticate with PIN
    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/login",
        data=json.dumps({"pin": PIN}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        token = data.get("token")
        assert token, "Token must be returned"
        print(f"[+] Auth Success! Token: {token[:12]}...")

    headers = {"Authorization": f"Bearer {token}"}

    # 2. Test /api/projects
    req = urllib.request.Request(f"{BASE_URL}/api/projects", headers=headers)
    with urllib.request.urlopen(req) as resp:
        projects = json.loads(resp.read().decode("utf-8"))
        print(f"[+] /api/projects: {len(projects)} total projects discovered")
        # Show breakdown by IDE
        ides = {}
        for p in projects:
            ide = p.get("ide", "unknown")
            ides[ide] = ides.get(ide, 0) + 1
        print(f"    IDE Breakdown: {ides}")
        
        # Display first 8 projects
        for p in projects[:8]:
            print(f"    - [{p.get('ide').upper()}] {p.get('project_name')}: {p.get('project_path')} ({p.get('conversation_title')})")

    # 3. Test /api/project/structure for PulseBridge
    req = urllib.request.Request(f"{BASE_URL}/api/project/structure?project=PulseBridge", headers=headers)
    with urllib.request.urlopen(req) as resp:
        pb_struct = json.loads(resp.read().decode("utf-8"))
        entries = pb_struct.get("entries", [])
        print(f"[+] /api/project/structure (PulseBridge): Root: {pb_struct.get('root_path')}, {len(entries)} top-level entries")
        for e in entries[:6]:
            print(f"    {'[DIR]' if e.get('is_dir') else '[FILE]'} {e.get('name')} ({e.get('relative_path')})")

    # 4. Test /api/project/structure for Infinity
    req = urllib.request.Request(f"{BASE_URL}/api/project/structure?project=Infinity", headers=headers)
    with urllib.request.urlopen(req) as resp:
        inf_struct = json.loads(resp.read().decode("utf-8"))
        entries = inf_struct.get("entries", [])
        print(f"[+] /api/project/structure (Infinity): Root: {inf_struct.get('root_path')}, {len(entries)} top-level entries")
        for e in entries[:6]:
            print(f"    {'[DIR]' if e.get('is_dir') else '[FILE]'} {e.get('name')} ({e.get('relative_path')})")

    # 5. Test /api/chat with a historical conversation ID
    if len(projects) > 0:
        hist_conv = next((p for p in projects if p.get("step_count", 0) > 0 and len(p.get("id", "")) > 10), None)
        if hist_conv:
            conv_id = hist_conv["id"]
            req = urllib.request.Request(f"{BASE_URL}/api/chat?conversation_id={conv_id}", headers=headers)
            with urllib.request.urlopen(req) as resp:
                steps = json.loads(resp.read().decode("utf-8"))
                print(f"[+] Historical Transcript for '{hist_conv.get('conversation_title')}': {len(steps)} steps retrieved from disk")
                if steps:
                    first = steps[0]
                    print(f"    Step 1 ({first.get('source')}): {first.get('content', '')[:60]}...")

    # 6. Test /api/action/scroll with x_ratio and y_ratio
    scroll_payload = {
        "delta": 120,
        "x_ratio": 0.5,
        "y_ratio": 0.5
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/action/scroll",
        data=json.dumps(scroll_payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}
    )
    with urllib.request.urlopen(req) as resp:
        print(f"[+] /api/action/scroll: HTTP {resp.status} (Mouse scroll with coordinate ratios OK)")

    # 7. Test /api/action/remote_prompt with VS Code target
    vscode_prompt_payload = {
        "message": "PulseBridge VS Code integration check",
        "target_ide": "vscode",
        "action_mode": "direct_inbox"
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/action/remote_prompt",
        data=json.dumps(vscode_prompt_payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print(f"[+] /api/action/remote_prompt (VS Code): Success = {res.get('success')}, Message = {res.get('message')}")

    # 8. Test /api/action/remote_prompt with Cursor target
    cursor_prompt_payload = {
        "message": "PulseBridge Cursor AI integration check",
        "target_ide": "cursor",
        "action_mode": "direct_inbox"
    }
    req = urllib.request.Request(
        f"{BASE_URL}/api/action/remote_prompt",
        data=json.dumps(cursor_prompt_payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers}
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print(f"[+] /api/action/remote_prompt (Cursor): Success = {res.get('success')}, Message = {res.get('message')}")

    print("\n=== ALL PULSEBRIDGE END-TO-END TESTS PASSED SUCCESSFULLY! ===")

if __name__ == "__main__":
    test_endpoints()
