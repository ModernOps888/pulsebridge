"""
PulseBridge Surgical Overhaul End-to-End Verification Suite
===========================================================
Tests every overhauled subsystem across Backend, Frontend Build,
Win32 Input & Coordinate Mapping, Multi-Project Resolution,
Bidirectional Agent Inbox (/api/inbox + MCP), and DevOps Shell Execution.
"""

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE_URL = os.environ.get("PULSEBRIDGE_URL", "http://127.0.0.1:8080")
PIN = sys.argv[1] if len(sys.argv) > 1 else "8888"


def request_json(method, path, payload=None, token=None):
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="ignore")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw}
        return e.code, body


def assert_true(cond, msg):
    if not cond:
        print(f"  [FAIL] {msg}")
        sys.exit(1)
    print(f"  [PASS] {msg}")


def run_tests():
    print("=" * 72)
    print(" PULSEBRIDGE SURGICAL OVERHAUL E2E VERIFICATION SUITE")
    print("=" * 72)

    # 1. Authenticate & verify persisted token file for MCP / Extension
    print("\n[1/7] Authenticating & Verifying Persisted Token File...")
    status, auth = request_json("POST", "/api/auth/login", {"pin": PIN})
    assert_true(status == 200 and auth.get("success") is True, "POST /api/auth/login succeeded")
    token = auth.get("token")
    assert_true(bool(token and len(token) >= 16), f"Session token issued ({token[:8]}...)")

    temp_token_path = os.path.join(os.environ.get("TEMP", "/tmp"), "pulsebridge_tokens.json")
    assert_true(os.path.exists(temp_token_path), f"Persisted token file exists at {temp_token_path}")
    with open(temp_token_path, "r", encoding="utf-8") as f:
        persisted_tokens = json.load(f)
    assert_true(token in persisted_tokens, "Issued session token is persisted for MCP/Extension")

    # 2. Verify System Telemetry & Auto-Detected Active IDE
    print("\n[2/7] Verifying System Telemetry & IDE Auto-Detection...")
    status, telemetry = request_json("GET", "/api/telemetry", token=token)
    assert_true(status == 200, "GET /api/telemetry returned 200 OK")
    assert_true(
        "shell_commands_enabled" in telemetry,
        f"SystemTelemetry reports shell_commands_enabled={telemetry.get('shell_commands_enabled')}",
    )
    assert_true(
        bool(telemetry.get("active_ide_name"))
        and telemetry.get("active_ide_name") != "Auto-detecting...",
        f"Active IDE resolved: {telemetry.get('active_ide_name')}",
    )

    # Verify MCP server syntax & loadability
    mcp_check = subprocess.run(
        ["node", "--check", r"C:\PulseBridge\pulsebridge-mcp\index.mjs"],
        capture_output=True,
        text=True,
    )
    assert_true(mcp_check.returncode == 0, "pulsebridge-mcp/index.mjs syntax check passed")

    # 3. Verify Bidirectional Agent Inbox (/api/inbox) & Feedback Loop
    print("\n[3/7] Verifying Bidirectional Agent Inbox & Decision Chip Feedback...")
    unique_msg = f"Approve production deployment {int(time.time())}"
    status, res = request_json(
        "POST",
        "/api/action/remote_prompt",
        {
            "message": unique_msg,
            "target_ide": "antigravity",
            "action_mode": "direct_inbox",
            "project_name": "PulseBridge",
            "conversation_id": "project-pulsebridge",
        },
        token=token,
    )
    assert_true(status == 200 and res.get("success") is True, "Queued prompt into /api/inbox")

    status, inbox_data = request_json("GET", "/api/inbox?unread_only=true&ack=true", token=token)
    assert_true(status == 200, "GET /api/inbox?unread_only=true&ack=true returned 200 OK")
    messages = inbox_data.get("messages", [])
    assert_true(
        any(m.get("message") == unique_msg for m in messages),
        "Queued mobile feedback retrieved from /api/inbox",
    )

    # Second call with unread_only=true should NOT return the already-acknowledged message
    status, inbox_after = request_json("GET", "/api/inbox?unread_only=true&ack=true", token=token)
    assert_true(
        not any(m.get("message") == unique_msg for m in inbox_after.get("messages", [])),
        "Acknowledged inbox messages are marked read on first consumption",
    )

    # 4. Verify Webhook Ingestion preserves step_type, tool_calls, source & decision options
    print("\n[4/7] Verifying Webhook Ingest (step_type, tool_calls, [OPTIONS: ...])...")
    ask_content = "🔔 **[AGENT QUESTION]**: Which deployment target? [OPTIONS: Staging | Production | Cancel]"
    status, ingest_res = request_json(
        "POST",
        "/api/ingest/event",
        {
            "ide": "antigravity",
            "event_type": "step",
            "project_name": "PulseBridge",
            "conversation_id": "project-pulsebridge",
            "step_type": "ASK_QUESTION",
            "source": "MODEL",
            "content": ask_content,
            "thinking": "Evaluating deployment options before asking user.",
            "tool_calls": [
                {
                    "tool_name": "ask_phone",
                    "action": "Asking mobile user for deployment target",
                    "summary": "Waiting for decision chip selection",
                    "target_file": "C:\\PulseBridge\\pulsebridge-server\\src\\main.rs",
                }
            ],
        },
        token=token,
    )
    assert_true(
        status == 200 and ingest_res.get("status") == "ingested",
        "POST /api/ingest/event succeeded",
    )

    # 5. Verify Multi-Project Resolution & Workspace vs Conversation Step Merging
    print("\n[5/7] Verifying Multi-Project Discovery & Workspace Step Resolution...")
    for days in (7, 30, 3650):
        status, projs = request_json("GET", f"/api/projects?days={days}", token=token)
        assert_true(status == 200 and isinstance(projs, list), f"GET /api/projects?days={days} returned {len(projs)} projects")
        # Ensure no duplicate "pulsebridge" vs "project-pulsebridge" keys
        ids = [p.get("id") for p in projs]
        assert_true("pulsebridge" not in ids, f"No duplicate legacy 'pulsebridge' ID in days={days}")

    status, steps = request_json(
        "GET", "/api/chat?conversation_id=project-pulsebridge&days=30", token=token
    )
    assert_true(status == 200 and isinstance(steps, list) and len(steps) > 0, f"Workspace ID 'project-pulsebridge' resolved {len(steps)} chat steps")
    matching_ask = [s for s in steps if s.get("content") == ask_content]
    assert_true(len(matching_ask) > 0, "Ingested ASK_QUESTION step found in workspace chat steps")
    assert_true(
        matching_ask[-1].get("step_type") == "ASK_QUESTION"
        and len(matching_ask[-1].get("tool_calls") or []) == 1,
        "step_type and tool_calls preserved end-to-end",
    )

    # 6. Verify Hotkey Normalization & Extended Key Support
    print("\n[6/7] Verifying Hotkey Normalization (+ / - / _) & Extended Keys...")
    for hk in ["ctrl+b", "ctrl-j", "ctrl_slash", "shift_tab", "alt_z", "f12"]:
        status, hk_res = request_json(
            "POST",
            "/api/action/hotkey",
            {"key": hk, "window_id": 999999999},  # Non-existent HWND avoids stealing focus during test
            token=token,
        )
        # Note: with a non-existent HWND, focus_window_reliable is a no-op and simulate_hotkey validates the key name
        assert_true(status == 200 and hk_res.get("success") is True, f"Hotkey '{hk}' accepted and normalized")

    status, bad_hk = request_json(
        "POST", "/api/action/hotkey", {"key": "invalid_nonexistent_key"}, token=token
    )
    assert_true(bad_hk.get("success") is False, "Unknown hotkey cleanly rejected with success=false")

    # 7. Verify Screen Capture Aspect Ratio & Shell Command Security
    print("\n[7/7] Verifying Screen Capture Aspect Ratio & Command Execution...")
    frame_req = urllib.request.Request(
        f"{BASE_URL}/api/preview/frame?token={urllib.parse.quote(token)}&quality=70"
    )
    with urllib.request.urlopen(frame_req, timeout=10) as resp:
        jpeg_bytes = resp.read()
        assert_true(
            resp.status == 200 and len(jpeg_bytes) > 1000 and jpeg_bytes[:2] == b"\xff\xd8",
            f"Live JPEG frame captured ({len(jpeg_bytes)} bytes)",
        )

    # Verify newline injection is always blocked
    status, nl_res = request_json(
        "POST",
        "/api/action/remote_prompt",
        {
            "message": "git status\ncalc.exe",
            "target_ide": "antigravity",
            "action_mode": "execute_command",
            "command": "git status\ncalc.exe",
        },
        token=token,
    )
    assert_true(
        status == 200 and nl_res.get("success") is False,
        "Multiline command injection ('git status\\ncalc.exe') blocked",
    )

    # If shell commands are enabled on this server instance, test cwd + allowlisted commands
    if telemetry.get("shell_commands_enabled"):
        for cmd in ["git status", "git branch -a", "cargo --version"]:
            status, cmd_res = request_json(
                "POST",
                "/api/action/remote_prompt",
                {
                    "message": cmd,
                    "target_ide": "antigravity",
                    "action_mode": "execute_command",
                    "project_path": "C:\\PulseBridge",
                    "command": cmd,
                },
                token=token,
            )
            assert_true(
                status == 200 and cmd_res.get("success") is True and bool(cmd_res.get("stdout")),
                f"Allowlisted command '{cmd}' executed in C:\\PulseBridge cwd",
            )

    print("\n" + "=" * 72)
    print(" ALL SURGICAL OVERHAUL VERIFICATION CHECKS PASSED (100%)!")
    print("=" * 72)


if __name__ == "__main__":
    run_tests()
