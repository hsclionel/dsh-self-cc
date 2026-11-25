---
description: Ask the local DeepSeek Harness one self-contained task and return its answer
argument-hint: <task>
allowed-tools: ["Bash"]
---

```bash
MSYS_NO_PATHCONV=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" run "$ARGUMENTS"
```

Rules:
- Read-only by default. Add `--write` only when the task is supposed to modify files.
- The task must be self-contained: DSH sees none of this conversation. Include goal, constraints, acceptance criteria, and absolute file paths.
- To continue a previous run, append `--session <id>` (the id is printed on stderr after every run).
- Add `--timeout <seconds>` for long tasks; `--cwd <dir>` to run elsewhere; `--json` to stream raw events.
- Lead your reply with DSH's answer, then mention the session id when present.
