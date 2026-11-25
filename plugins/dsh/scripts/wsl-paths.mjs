// Path handling for the Windows → WSL hop.
//
// Claude Code on Windows runs inside Git Bash, which rewrites POSIX-looking
// arguments (`/mnt/c/game` → `/mnt/c/Program Files/Git/mnt/c/game`) and turns
// `C:\game` into a form `wslpath` sometimes rejects. Neither side can be
// trusted alone, so the bridge normalises paths itself first and only asks
// wslpath when the answer is still ambiguous.

// Git Bash prefixes MSYS-internal paths. Undo that when the remainder is a
// real WSL path, so `--cwd /mnt/c/game` survives even without
// MSYS_NO_PATHCONV=1.
export function unmangleMsysPath(p) {
  const s = String(p);
  const m = s.match(/^.*?\/Program Files(?: \(x86\))?\/Git(?=\/|$)/);
  if (!m) return s;
  const rest = s.slice(m[0].length);
  return rest && rest.startsWith("/") ? rest : s;
}

// Convert a Windows path to its WSL equivalent. Returns the input unchanged
// when it is already a POSIX path.
export function windowsToWslPath(p, distro) {
  if (p == null) return p;
  let s = unmangleMsysPath(String(p).trim());
  if (!s) return s;

  // Already a Linux path.
  if (s.startsWith("/")) return s;

  // \\wsl.localhost\<distro>\home\me\proj and \\wsl$\<distro>\...
  const unc = s.match(/^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)[\\/](.*)$/i);
  if (unc) {
    const rel = unc[2].replace(/\\/g, "/").replace(/\/+$/, "");
    return `/${rel}`;
  }

  // C:\game, C:/game, C: → /mnt/c/game
  const drive = s.match(/^([A-Za-z]):(.*)$/);
  if (drive) {
    const rest = drive[2].replace(/\\/g, "/").replace(/\/+$/, "");
    return rest ? `/mnt/${drive[1].toLowerCase()}${rest.startsWith("/") ? rest : `/${rest}`}` : `/mnt/${drive[1].toLowerCase()}`;
  }

  // UNC share that is not WSL: //server/share → /mnt/unc/server/share is not
  // stable, so hand back the normalised form and let the caller fail loudly.
  if (/^[\\/]{2}/.test(s)) return s.replace(/\\/g, "/");

  return s.replace(/\\/g, "/");
}
