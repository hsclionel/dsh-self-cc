#!/usr/bin/env node
// dsh-bridge.mjs — drive a local DeepSeek Harness (dsh) from Claude Code.
//
// Commands:
//   run <task>       run one task, print the final answer
//   setup            create the `cc` profile (headless + novel stack)
//   status           show version, profile, bundles, auth source
//   sessions         list sessions recorded by this bridge
//
// The bridge talks to `dsh --profile <p> --json -- "task"` over stdin and
// parses the newline-delimited event stream, so no extra dependencies.
//
// On Windows the bridge does not need a native `dsh`: it forwards the run into
// WSL (where dsh lives) through wsl.exe. Set DSH_WSL_DISTRO to pin the distro.

import { spawn, execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { unmangleMsysPath, windowsToWslPath } from "./wsl-paths.mjs";

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, ".dsh");
const STATE_DIR = join(DSH_HOME, "cc-self");
const SESSIONS_FILE = join(STATE_DIR, "sessions.json");
const DEFAULT_PROFILE = "cc";
const NOVEL_STACK = ["dsh-novel-forge", "dsh-humanizer-zh"];

// Windows host, or an explicit request to exercise the WSL path from inside a
// Linux box (used by the project's own tests).
const WSL_MODE = process.platform === "win32" || process.env.DSH_WSL === "1";

function die(msg, code = 1) {
  process.stderr.write(`dsh-bridge: ${msg}\n`);
  process.exit(code);
}

const BOOLEAN_FLAGS = new Set(["write", "json", "stdin", "danger"]);

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-") { out.flags.stdin = true; continue; }
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) { out.flags[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { out.flags[key] = true; continue; }
    out.flags[key] = next;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- WSL plumbing

function wslExe() {
  return process.env.DSH_WSL_EXE ||
    (process.platform === "win32" ? "wsl.exe" : "/mnt/c/Windows/System32/wsl.exe");
}

function wslDistro() {
  if (process.env.DSH_WSL_DISTRO) return process.env.DSH_WSL_DISTRO;
  try {
    // wsl.exe -l -q prints UTF-16LE, even when called from Linux.
    const buf = execFileSync(wslExe(), ["-l", "-q"], {
      encoding: "buffer", stdio: ["ignore", "pipe", "ignore"],
    });
    const text = buf.toString("utf16le").replace(/\0/g, "");
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

function wslPrefix() {
  const d = wslDistro();
  return d ? ["-d", d] : [];
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function posixCwd(p) {
  if (!p || !WSL_MODE) return p;
  const cleaned = unmangleMsysPath(p);
  if (cleaned.startsWith("/")) return cleaned;   // already a Linux path
  if (process.platform === "win32") {
    try {
      const converted = execFileSync(wslExe(), [...wslPrefix(), "wslpath", "-a", cleaned], {
        encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (converted.startsWith("/")) return converted;
    } catch {}
  }
  // Git Bash and wslpath both mangle some forms; do the conversion ourselves.
  return windowsToWslPath(cleaned, wslDistro());
}

// WSLENV forwards the key into the distro without putting it on the command
// line (where `ps` would show it).
function wslKeyEnv(value) {
  const prev = process.env.WSLENV ? `${process.env.WSLENV}:` : "";
  return { DEEPSEEK_API_KEY: value, WSLENV: `${prev}DEEPSEEK_API_KEY/u` };
}

function readKeyInWsl() {
  const script = [
    "for f in /proc/[0-9]*/environ; do",
    '  k=$(tr "\\000" "\\n" < "$f" 2>/dev/null | grep -m1 "^DEEPSEEK_API_KEY=" || true)',
    '  if [ -n "$k" ]; then printf "%s" "${k#DEEPSEEK_API_KEY=}"; exit 0; fi',
    "done",
    "exit 1",
  ].join("\n");
  try {
    const v = execFileSync(wslExe(), [...wslPrefix(), "-e", "bash", "-lc", script], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return v ? { value: v, source: "wsl dsh web process" } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- dsh lookup

function resolveDsh() {
  const fromEnv = process.env.DSH_BINARY;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  try {
    const found = execSync("command -v dsh", { encoding: "utf8", shell: "/bin/sh" }).trim();
    if (found) return found;
  } catch {}
  for (const p of [join(HOME, ".local/bin/dsh"), "/usr/local/bin/dsh", "/usr/bin/dsh"]) {
    if (existsSync(p)) return p;
  }
  die("cannot find the `dsh` binary; set DSH_BINARY to its absolute path");
}

function readKeyFromProc() {
  const want = "DEEPSEEK_API_KEY";
  try {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      let cmd = "";
      try { cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8"); } catch { continue; }
      if (!cmd.includes("dsh")) continue;
      const parts = cmd.split("\0").filter(Boolean);
      if (!parts.some((p) => p === "web" || p.endsWith("/dsh") || p.endsWith("\\dsh"))) continue;
      if (!parts.some((p) => p.endsWith("dsh") || p.includes("dsh/bin") || p.includes("@deepseek-ai/dsh"))) continue;
      let env = "";
      try { env = readFileSync(`/proc/${entry}/environ`, "utf8"); } catch { continue; }
      for (const kv of env.split("\0")) {
        if (kv.startsWith(`${want}=`)) {
          const value = kv.slice(want.length + 1);
          if (value) return { value, source: `dsh web process ${entry}` };
        }
      }
    }
  } catch {}
  return null;
}

function discoverKey() {
  if (process.env.DEEPSEEK_API_KEY) {
    return { value: process.env.DEEPSEEK_API_KEY, source: "environment" };
  }
  if (process.env.DSH_CC_NO_KEY_DISCOVERY) return null;
  return WSL_MODE ? readKeyInWsl() : readKeyFromProc();
}

function nowIso() {
  return new Date().toISOString();
}

function loadSessions() {
  try { return JSON.parse(readFileSync(SESSIONS_FILE, "utf8")); } catch { return {}; }
}

function saveSession(id, extra) {
  const all = loadSessions();
  all[id] = { ...(all[id] || {}), ...extra, updatedAt: nowIso() };
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(SESSIONS_FILE, JSON.stringify(all, null, 2));
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function buildArgs({ profile, mode, session, addDirs }) {
  const args = ["--profile", profile];
  if (session) args.push("--session-id", session);
  args.push("--json", "--permission-mode", mode, "--approval-policy", "never");
  for (const d of addDirs) args.push("--add-dir", d);
  args.push("-");
  return args;
}

function parseEvents(text) {
  const result = { sessionId: null, text: "", error: null, events: [] };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    result.events.push(ev);
    if (ev.type === "session" && ev.sessionId) result.sessionId = ev.sessionId;
    if (ev.type === "final") {
      if (typeof ev.text === "string") result.text = ev.text;
      if (ev.reason && ev.reason.kind === "error") result.error = ev.reason.error;
    }
  }
  return result;
}

async function cmdRun(args) {
  const flags = args.flags;
  const profile = flags.profile || DEFAULT_PROFILE;
  const task = flags.stdin ? await readStdin() : args._.join(" ").trim();
  if (!task) die("run: empty task (pass text or `-` with stdin)");

  const mode = flags.danger ? "danger-full-access" : flags.write ? "workspace-write" : "read-only";
  const key = discoverKey();
  if (!key) {
    die(
      "no DEEPSEEK_API_KEY. Export it, or start `dsh web` so the bridge can read the " +
      "running process environment (disable with DSH_CC_NO_KEY_DISCOVERY=1)."
    );
  }

  const argv = buildArgs({
    profile,
    mode,
    session: typeof flags.session === "string" ? flags.session : null,
    addDirs: [],
  });
  const timeoutMs = flags.timeout ? Number(flags.timeout) * 1000 : 900_000;

  let cmd, cmdArgs, env, cwd;
  if (WSL_MODE) {
    const dir = posixCwd(flags.cwd || process.cwd());
    const inner = [
      `cd ${shellQuote(dir)} 2>/dev/null || { echo "dsh-bridge: cannot enter ${dir} inside WSL" >&2; exit 9; }`,
      'export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/usr/local/bin:$PATH"',
      `exec dsh ${argv.map(shellQuote).join(" ")}`,
    ].join(" && ");
    cmd = wslExe();
    cmdArgs = [...wslPrefix(), "-e", "bash", "-lc", inner];
    env = { ...process.env, ...wslKeyEnv(key.value) };
    cwd = undefined;
  } else {
    cmd = resolveDsh();
    cmdArgs = argv;
    env = { ...process.env, DEEPSEEK_API_KEY: key.value };
    cwd = flags.cwd || process.cwd();
  }

  const child = spawn(cmd, cmdArgs, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });

  let out = "";
  let err = "";
  child.stdout.setEncoding("utf8").on("data", (d) => { out += d; });
  child.stderr.setEncoding("utf8").on("data", (d) => { err += d; });

  let timedOut = false;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    try { child.kill("SIGTERM"); } catch {}
    setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000).unref();
  }, timeoutMs) : null;

  child.stdin.end(task);
  const code = await new Promise((res) => child.on("close", res));
  if (timer) clearTimeout(timer);
  if (timedOut) die(`run: timed out after ${timeoutMs / 1000}s`, 124);

  const parsed = parseEvents(out);
  const verbose = flags.json;

  if (verbose) process.stdout.write(out);
  if (parsed.sessionId) {
    saveSession(parsed.sessionId, { profile, task: task.slice(0, 200) });
    process.stderr.write(`dsh session: ${parsed.sessionId} (profile: ${profile})\n`);
  }
  if (parsed.error) {
    if (!verbose) process.stderr.write(`${err}`.trim() + "\n");
    die(parsed.error.message || JSON.stringify(parsed.error));
  }

  if (code !== 0 && !parsed.text) die(`run: dsh exited with code ${code}${err ? `\n${err.trim()}` : ""}`);
  if (!verbose && parsed.text) process.stdout.write(parsed.text.replace(/\n?$/, "\n"));
}

function runSync(bin, args) {
  return execFileSync(bin, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runScriptInWsl(script) {
  return execFileSync(wslExe(), [...wslPrefix(), "-e", "bash", "-lc", script], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env },
  });
}

const WSL_PATH = 'export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/usr/local/bin:$PATH";';

function cmdStatus() {
  const key = discoverKey();
  if (WSL_MODE) {
    let bin = "missing", version = "unknown", pkg = "";
    try {
      const out = runScriptInWsl(
        `${WSL_PATH} echo "BIN=$(command -v dsh || echo missing)"; ` +
        `echo "VER=$(dsh --version 2>/dev/null || echo unknown)"; ` +
        `cat "$HOME/.dsh/profiles/${DEFAULT_PROFILE}/package.json" 2>/dev/null || true`
      );
      const [first, second, ...rest] = out.split(/\r?\n/);
      bin = (first || "").replace(/^BIN=/, "");
      version = (second || "").replace(/^VER=/, "");
      pkg = rest.join("\n").trim();
    } catch (e) {
      version = `error: ${e.message}`;
    }
    let bundles = [];
    try { bundles = JSON.parse(pkg)?.dsh?.profile?.bundles || []; } catch {}
    console.log(`target     : WSL (${wslDistro() || "default distro"})`);
    console.log(`dsh binary : ${bin}`);
    console.log(`dsh version: ${version}`);
    console.log(`profile    : ~/.dsh/profiles/${DEFAULT_PROFILE} in WSL${pkg ? "" : " (missing — run setup)"}`);
    console.log(`bundles    : ${bundles.length ? bundles.join(", ") : "(none)"}`);
    console.log(`auth       : ${key ? key.source : "MISSING"}`);
    return;
  }
  const dsh = resolveDsh();
  let version = "unknown";
  try { version = execFileSync(dsh, ["--version"], { encoding: "utf8" }).trim(); } catch {}
  const profileDir = join(DSH_HOME, "profiles", DEFAULT_PROFILE);
  let bundles = [];
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, "package.json"), "utf8"));
    bundles = pkg?.dsh?.profile?.bundles || [];
  } catch {}
  console.log(`dsh binary : ${dsh}`);
  console.log(`dsh version: ${version}`);
  console.log(`profile    : ${profileDir}${existsSync(profileDir) ? "" : " (missing — run setup)"}`);
  console.log(`bundles    : ${bundles.length ? bundles.join(", ") : "(none)"}`);
  console.log(`auth       : ${key ? key.source : "MISSING"}`);
}

function cmdSetup() {
  const specs = [...NOVEL_STACK];
  if (typeof args.flags["prose-gate"] === "string") specs.push(`link:${args.flags["prose-gate"]}`);
  const specsSafe = specs.filter((s) => !s.startsWith("link:") || existsSync(s.slice(5)));

  if (WSL_MODE) {
    const add = specsSafe.map(shellQuote).join(" ");
    process.stderr.write(`creating/refreshing ${DEFAULT_PROFILE} profile in WSL...\n`);
    try {
      runScriptInWsl(
        `${WSL_PATH} if [ ! -f "$HOME/.dsh/profiles/${DEFAULT_PROFILE}/package.json" ]; then ` +
        `dsh --profile ${DEFAULT_PROFILE} --from-default-profile headless --dump-config >/dev/null; fi; ` +
        `dsh plugin --profile ${DEFAULT_PROFILE} add ${add}`
      );
    } catch (e) {
      die(`setup failed in WSL: ${e.stderr || e.message}`);
    }
    cmdStatus();
    return;
  }

  const dsh = resolveDsh();
  const profileDir = join(DSH_HOME, "profiles", DEFAULT_PROFILE);
  if (!existsSync(profileDir)) {
    process.stderr.write(`creating ${DEFAULT_PROFILE} profile from the headless template...\n`);
    runSync(dsh, ["--profile", DEFAULT_PROFILE, "--from-default-profile", "headless", "--dump-config"]);
  }
  process.stderr.write(`installing into ${DEFAULT_PROFILE}: ${specsSafe.join(" ")}\n`);
  runSync(dsh, ["plugin", "--profile", DEFAULT_PROFILE, "add", ...specsSafe]);
  cmdStatus();
  const key = discoverKey();
  if (!key) {
    console.error("\nwarning: no DEEPSEEK_API_KEY found. Export it before running tasks.");
  }
}

function cmdSessions() {
  const all = loadSessions();
  const ids = Object.keys(all);
  if (!ids.length) return console.log("no sessions recorded");
  for (const id of ids) {
    const s = all[id];
    console.log(`${id}\t${s.profile || "?"}\t${s.updatedAt || ""}\t${(s.task || "").slice(0, 60)}`);
  }
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
switch (cmd) {
  case "run": await cmdRun(args); break;
  case "status": cmdStatus(); break;
  case "setup": cmdSetup(); break;
  case "sessions": cmdSessions(); break;
  default:
    console.log("usage: dsh-bridge.mjs <run|setup|status|sessions> [options]");
    process.exit(cmd ? 1 : 0);
}
