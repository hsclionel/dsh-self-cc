---
description: Show the local dsh version, the driven profile, its bundles, and how auth was resolved
allowed-tools: ["Bash"]
---

```bash
MSYS_NO_PATHCONV=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" status
```

Report the output as a short table: binary, version, profile path, bundles, auth source.
If the profile is missing, say so and suggest `/dsh:setup`.
