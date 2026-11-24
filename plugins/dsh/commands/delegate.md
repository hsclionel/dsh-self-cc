---
description: Delegate a substantial task to DeepSeek Harness in the background
argument-hint: <task>
allowed-tools: ["Bash", "Task"]
---

Use the `dsh-worker` subagent via the Task tool, passing this brief:

> Task: $ARGUMENTS
> Run it on the local DeepSeek Harness with `node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" run` (add `--write` only if the task must modify files). Return the final answer, the dsh session id, and the exit status.

Rules:
- Do not block this conversation on the delegation; report the start immediately.
- If the subagent returns an auth error, point the user at `/dsh:setup` or exporting `DEEPSEEK_API_KEY`.
