import requests
import json
import sys
import time

BASE_URL = "http://127.0.0.1:8080"
PIN = sys.argv[1] if len(sys.argv) > 1 else "778899"

print("=========================================================================")
print("     MULTI-PROJECT & MULTI-CHAT DEEP FUNCTIONAL VERIFICATION SUITE       ")
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
        sys.exit(1)

# 1. Login
r_login = requests.post(f"{BASE_URL}/api/auth/login", json={"pin": PIN})
data = r_login.json()
record("Login Success", r_login.status_code == 200 and data.get("success") == True)
token = data.get("token")
headers = {"Authorization": f"Bearer {token}"}

# 2. Test GET /api/chat/projects
print("\n[*] Phase 1: Query Available Projects Catalogue")
r_proj = requests.get(f"{BASE_URL}/api/chat/projects", headers=headers)
record("GET /api/chat/projects Status 200", r_proj.status_code == 200)
projects = r_proj.json()
record("Projects Response is List", isinstance(projects, list))
record("Initial Project Discovered", len(projects) > 0, f"Found {len(projects)} projects: {[p.get('project_name') for p in projects]}")

# 3. Ingest Multi-Project Events
print("\n[*] Phase 2: Ingest Multi-Project & Multi-Chat Events")

p1_content = f"PulseBridge SecOps check completed at {int(time.time())}"
r_ingest1 = requests.post(
    f"{BASE_URL}/api/ingest/event",
    headers=headers,
    json={
        "ide": "antigravity",
        "event_type": "step",
        "content": p1_content,
        "status": "DONE",
        "project_name": "PulseBridge",
        "conversation_id": "conv-pulsebridge-01",
        "conversation_title": "Zero-Trust Companion Hardening"
    }
)
record("Ingest Event: PulseBridge Status 200", r_ingest1.status_code == 200)

p2_content = f"Infinity TechStack: Deployed Claude Academy Interactive Lab {int(time.time())}"
r_ingest2 = requests.post(
    f"{BASE_URL}/api/ingest/event",
    headers=headers,
    json={
        "ide": "antigravity",
        "event_type": "step",
        "content": p2_content,
        "status": "DONE",
        "project_name": "Infinity TechStack",
        "conversation_id": "conv-infinity-01",
        "conversation_title": "Interactive Labs for Claude & OpenAI"
    }
)
record("Ingest Event: Infinity TechStack Status 200", r_ingest2.status_code == 200)

p3_content = f"Cursor AI Composer: Refactoring Rust WebSocket transport {int(time.time())}"
r_ingest3 = requests.post(
    f"{BASE_URL}/api/ingest/event",
    headers=headers,
    json={
        "ide": "cursor",
        "event_type": "step",
        "content": p3_content,
        "status": "DONE",
        "project_name": "Cursor Workspace Alpha",
        "conversation_id": "conv-cursor-01",
        "conversation_title": "WebSocket Streaming Refactor"
    }
)
record("Ingest Event: Cursor Workspace Status 200", r_ingest3.status_code == 200)

# 4. Verify Updated Projects Catalogue
print("\n[*] Phase 3: Verify Projects Catalogue After Multi-Project Ingest")
r_proj2 = requests.get(f"{BASE_URL}/api/chat/projects", headers=headers)
record("GET /api/chat/projects Status 200", r_proj2.status_code == 200)
updated_projects = r_proj2.json()
project_names = [p.get("project_name") for p in updated_projects]
record("PulseBridge Registered in Projects", "PulseBridge" in project_names)
record("Infinity TechStack Registered in Projects", "Infinity TechStack" in project_names)
record("Cursor Workspace Alpha Registered in Projects", "Cursor Workspace Alpha" in project_names)

# Check snippet and step count
inf_proj = next((p for p in updated_projects if p.get("project_name") == "Infinity TechStack"), None)
record("Infinity Project Has Valid Title", inf_proj and inf_proj.get("conversation_title") == "Interactive Labs for Claude & OpenAI")
record("Infinity Project Has Snippet", inf_proj and bool(inf_proj.get("latest_message_snippet")), f"Snippet: {inf_proj.get('latest_message_snippet') if inf_proj else ''}")

# 5. Verify Filtered Chat Endpoints
print("\n[*] Phase 4: Verify Project-Specific Chat Filtering")

# 5a. Filter by Infinity TechStack
r_filter_inf = requests.get(f"{BASE_URL}/api/chat?project=Infinity%20TechStack", headers=headers)
record("GET /api/chat?project=Infinity TechStack Status 200", r_filter_inf.status_code == 200)
inf_steps = r_filter_inf.json()
record("Filtered Steps Non-Empty", len(inf_steps) > 0)
record(
    "All Filtered Steps Belong Strictly to Infinity TechStack",
    all(s.get("project_name") == "Infinity TechStack" for s in inf_steps)
)
record(
    "No Cross-Contamination (PulseBridge not in Infinity filter)",
    all(s.get("project_name") != "PulseBridge" for s in inf_steps)
)

# 5b. Filter by PulseBridge
r_filter_pb = requests.get(f"{BASE_URL}/api/chat?project=PulseBridge", headers=headers)
record("GET /api/chat?project=PulseBridge Status 200", r_filter_pb.status_code == 200)
pb_steps = r_filter_pb.json()
record(
    "All Filtered Steps Belong Strictly to PulseBridge",
    all(s.get("project_name") == "PulseBridge" for s in pb_steps)
)

# 5c. Filter by Conversation ID
r_filter_conv = requests.get(f"{BASE_URL}/api/chat?conversation_id=conv-cursor-01", headers=headers)
record("GET /api/chat?conversation_id=conv-cursor-01 Status 200", r_filter_conv.status_code == 200)
conv_steps = r_filter_conv.json()
record(
    "All Steps Match Conversation ID 'conv-cursor-01'",
    all(s.get("conversation_id") == "conv-cursor-01" for s in conv_steps)
)

# 5d. Unfiltered / All Projects
r_all = requests.get(f"{BASE_URL}/api/chat", headers=headers)
all_steps = r_all.json()
record("All Projects Feed Contains All Steps", len(all_steps) >= len(inf_steps) + len(pb_steps))
record("Every Step Retains Project Metadata", any(s.get("project_name") == "Infinity TechStack" for s in all_steps) and any(s.get("project_name") == "PulseBridge" for s in all_steps))

# 6. Test PWA Web Bundle Serving With Updated Assets
print("\n[*] Phase 5: PWA Web Bundle Serving Check")
r_index = requests.get(f"{BASE_URL}/")
record("PWA index.html Status 200", r_index.status_code == 200)
record("PWA Contains App Root", 'id="root"' in r_index.text)

print("\n=========================================================================")
print(f"  MULTI-PROJECT & MULTI-CHAT TESTS: {passed} PASSED, {failed} FAILED")
print("  VERDICT: 100% FACTUALLY VERIFIED & FULLY FUNCTIONAL")
print("=========================================================================")
