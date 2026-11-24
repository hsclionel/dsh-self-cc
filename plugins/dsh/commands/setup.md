---
description: Prepare the local dsh "cc" profile that this plugin drives (headless + novel stack)
allowed-tools: ["Bash"]
---

Run the setup, then report the result:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" setup
```

Rules:
- One `dsh` binary is reused from this machine; the plugin never installs its own harness.
- Optional: add `--prose-gate /absolute/path/to/dsh-prose-gate` to also gate novel chapters written through this profile.
- If the profile already exists, setup only adds the plugin specs and reuses the profile.
- If the output says `auth: MISSING`, tell the user to export `DEEPSEEK_API_KEY` or start `dsh web` (the bridge reads the key from the running web process).
- Relay the printed `bundles` list, then stop. Do not run further dsh commands in this turn.
