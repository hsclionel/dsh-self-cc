---
description: Read-only review of the current working tree by DeepSeek Harness
argument-hint: [focus]
allowed-tools: ["Bash"]
---

```bash
{ echo "Review the current working tree of this repository. Do not modify any file.";
  echo "Focus: ${ARGUMENTS:-correctness, regressions, missing tests}";
  echo; echo "## git status"; git status --short;
  echo; echo "## git diff HEAD"; git diff HEAD; } \
| MSYS_NO_PATHCONV=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" run -
```

Rules:
- Stay read-only: never add `--write` here.
- The bridge prints the review on stdout; relay it, and group findings by severity.
