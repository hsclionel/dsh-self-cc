// Run with: node tests/paths.mjs
import { unmangleMsysPath, windowsToWslPath } from "../plugins/dsh/scripts/wsl-paths.mjs";

const cases = [
  // Windows drive paths, backslash and forward slash.
  ["C:\\game", "/mnt/c/game"],
  ["C:/game", "/mnt/c/game"],
  ["D:\\work\\proj", "/mnt/d/work/proj"],
  ["C:", "/mnt/c"],
  ["c:\\Users\\me\\proj", "/mnt/c/Users/me/proj"],
  // Already POSIX: must pass through untouched.
  ["/mnt/c/game", "/mnt/c/game"],
  ["/home/admin/dsh-test", "/home/admin/dsh-test"],
  // WSL UNC paths as pasted from Explorer.
  ["\\\\wsl.localhost\\Debian\\home\\admin\\dsh-test", "/home/admin/dsh-test"],
  ["\\\\wsl$\\Debian\\home\\admin", "/home/admin"],
  // Git Bash rewrote /mnt/c/game into this; the prefix must be stripped.
  ["/mnt/c/Program Files/Git/mnt/c/game", "/mnt/c/game"],
  ["/mnt/c/Program Files (x86)/Git/home/me", "/home/me"],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = windowsToWslPath(unmangleMsysPath(input), "Debian");
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${JSON.stringify(input)} -> ${got}${ok ? "" : ` (want ${want})`}`);
}
console.log(failed ? `${failed} failed` : "all paths ok");
process.exit(failed ? 1 : 0);
