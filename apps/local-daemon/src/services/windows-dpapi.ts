import { execFileSync } from "node:child_process";

function escapePowerShellSingleQuoted(input: string) {
  return input.replace(/'/g, "''");
}

function runPowerShell(script: string): string | null {
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf8" }
    );
    return out.trim();
  } catch {
    return null;
  }
}

export function protectDpapi(plain: string): string | null {
  if (process.platform !== "win32") return null;
  const safe = escapePowerShellSingleQuoted(plain);
  return runPowerShell(
    `$secure = ConvertTo-SecureString '${safe}' -AsPlainText -Force; ConvertFrom-SecureString $secure`
  );
}

export function unprotectDpapi(cipherText: string): string | null {
  if (process.platform !== "win32") return null;
  const safe = escapePowerShellSingleQuoted(cipherText);
  return runPowerShell(
    `$secure = ConvertTo-SecureString '${safe}'; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)`
  );
}
