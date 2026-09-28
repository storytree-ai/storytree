#!/usr/bin/env python3
"""Render a claude stream-json transcript as plain text: tools called (with input summary), results, final text."""
import json, sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line.startswith("{"):
        if line: print("RAW", line[:300])
        continue
    try: d = json.loads(line)
    except Exception: print("RAW", line[:300]); continue
    t = d.get("type")
    if t == "system" and d.get("subtype") == "init":
        print(f"[init] cwd={d.get('cwd')} tools={','.join(x for x in d.get('tools', []) if not x.startswith('mcp__') or 'storytree' in x)}")
        print(f"[init] mcp={d.get('mcp_servers')}")
    elif t == "system":
        s = {k: v for k, v in d.items() if k not in ("session_id", "uuid")}
        print("[system]", json.dumps(s)[:600])
    elif t == "assistant":
        for c in d["message"]["content"]:
            if c["type"] == "text": print("ASSISTANT:", c["text"])
            elif c["type"] == "tool_use": print(f"TOOL {c['name']}:", json.dumps(c["input"])[:400])
    elif t == "user":
        for c in d["message"].get("content", []) if isinstance(d["message"].get("content"), list) else []:
            if c.get("type") == "tool_result":
                txt = c["content"] if isinstance(c["content"], str) else " ".join(x.get("text", "") for x in c["content"])
                print("RESULT:", txt[:1500])
    elif t == "result":
        print(f"[result] {d.get('subtype')} turns={d.get('num_turns')} denials={d.get('permission_denials')}")
