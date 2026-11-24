# dsh-self-cc

A Claude Code plugin that drives the **DeepSeek Harness (`dsh`) already installed on this machine**.

Unlike [`cpj-dev/dsh-plugin-cc`](https://github.com/cpj-dev/dsh-plugin-cc), which pins its own harness version and builds a private profile from scratch, this plugin reuses your `dsh` binary, your profiles, and your credentials. It adapts to whatever harness version you are running, and it ships a "how to use me" skill so Claude knows which profile to drive and what the host-side guards enforce.

## Install

```bash
/plugin marketplace add /absolute/path/to/dsh-self-cc   # or: <owner>/dsh-self-cc once pushed
/plugin install dsh@dsh-self
/dsh:setup
```

`/dsh:setup` creates the `cc` profile from the shipped `headless` template and installs the novel stack into it. Your `web` profile is never touched.

## Commands

| Command | What it does |
|---|---|
| `/dsh:ask <task>` | one-shot task, read-only; `--write`, `--session <id>`, `--timeout`, `--cwd`, `--json` |
| `/dsh:review [focus]` | read-only review of `git status` + `git diff HEAD` |
| `/dsh:novel <request>` | routes fiction work to the novel stack (`--write` implied) |
| `/dsh:delegate <task>` | background delegation through the `dsh-worker` subagent |
| `/dsh:status` | dsh version, profile, bundles, auth source |
| `/dsh:setup` | create/refresh the `cc` profile |

## How it works

`plugins/dsh/scripts/dsh-bridge.mjs` spawns:

```
dsh --profile <p> --json --permission-mode <read-only|workspace-write> \
    --approval-policy never [--session-id <id>] -
```

and feeds the task on stdin. It parses the newline-delimited event stream, prints the final answer, and records the session id so `--session` can continue the conversation. Nothing is installed globally and no network service is added.

Auth resolution order:

1. `DEEPSEEK_API_KEY` in the environment;
2. the environment of a running `dsh web` process on this machine (read from `/proc`, same user only);
3. otherwise the run fails with a clear message.

Set `DSH_CC_NO_KEY_DISCOVERY=1` to disable step 2. Set `DSH_BINARY` to point at a specific `dsh` binary.

## Requirements

- Node >= 20 (the bridge uses ESM and top-level await)
- A local `dsh` binary (>= 0.2.x tested)
- A DeepSeek API key

## Limitations

- One task per process; there is no broker and no resume across processes beyond `--session-id`.
- No mid-run approvals: the permission mode is fixed when the run starts.
- The `cc` profile only carries the headless app and the novel stack; web-only plugins (openwrite, whale widget, huashu skills) stay in the `web` profile.
- POSIX only (the key-discovery path reads `/proc`).

## License

MIT © 2026 hsclionel
