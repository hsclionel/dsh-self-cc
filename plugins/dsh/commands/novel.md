---
description: Hand a fiction/novel task to the local dsh novel stack (novel-forge + humanizer + prose gate)
argument-hint: <request>
allowed-tools: ["Bash"]
---

```bash
MSYS_NO_PATHCONV=1 node "${CLAUDE_PLUGIN_ROOT}/scripts/dsh-bridge.mjs" run --profile cc --write "You are working on a Chinese web novel. Use the novel workflow tools (novel_* from dsh-novel-forge) and the humanizer-zh rules for prose. A host-side prose gate blocks any chapter whose AI-flavor score is >= 60/100: rewrite the offending sentences instead of paraphrasing, then resubmit. Task: $ARGUMENTS"
```

Rules:
- `--write` is required: novel tools write chapters under the workspace.
- Do not paste the whole chapter into this conversation afterwards; return the chapter path and any gate report.
- If the gate denies a chapter, surface its score and the top offending categories, then let DSH revise.
