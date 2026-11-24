---
name: dsh-self
description: How to use the local DeepSeek Harness (dsh) from Claude Code — which profile to drive, what the prose gate enforces, and when to delegate instead of doing the work here. Use whenever the user says "ask dsh", "delegate to dsh", "run it on DeepSeek", "write with the novel stack", or asks what this DSH can do.
---

# Using this DeepSeek Harness from Claude Code

The bridge script drives the `dsh` binary that is already installed on this machine. It never downloads or pins a harness version; whatever `dsh --version` reports is what runs.

## Entry points

| Call | When |
|---|---|
| `run "<task>"` | one-shot, read-only |
| `run --write "<task>"` | the task must modify files (workspace-write) |
| `run --session <id>` | continue a previous run (headless supports native `--session-id`) |
| `run --profile <p>` | pick a profile explicitly |
| `status` | version, profile, bundles, auth source |
| `setup` | create the `cc` profile (headless + novel stack) |

Default profile is `cc`. It is a copy of the shipped `headless` template plus:
`dsh-novel-forge`, `dsh-humanizer-zh`, and — when setup is given `--prose-gate <path>` — the host prose gate.

## What this DSH has that Claude Code does not

- **novel-forge tools** (`novel_*`): outline, draft, revise, scan. `novel_noai_scan` is a local, zero-token AI-flavor scanner.
- **Prose gate**: a host plugin hooked on `tools/pre-execute` / `tools/post-execute`. Any chapter with an AI-flavor score >= 60/100 is denied before it is saved, with a per-category report. Do not try to route around it; run the rewrite it asks for.
- **Skills**: `novel`, `humanizer-zh`, `huashu-design`, `huashu-nuwa` (the last two live in the web profile only).

## Rules of thumb

- Delegate **large, self-contained** work: multi-file investigations, independent implementations, long reviews. Keep small edits and conversation-dependent work here.
- DSH has no access to this conversation, its files, or its tool results. Put everything the task needs into the prompt.
- The `cc` profile has no web UI, no openwrite, and no GUI plugins. Those stay in the `web` profile; ask the user to run them in `dsh web` instead.
- Auth comes from `DEEPSEEK_API_KEY` in the environment, or from the running `dsh web` process when the variable is absent.
- Prefer `--write` only when the task genuinely edits files; read-only runs cannot damage the workspace.
