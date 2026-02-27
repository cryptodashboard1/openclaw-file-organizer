import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { protectDpapi, unprotectDpapi } from "./windows-dpapi.js";

type PersistedDeviceCredentials = {
  deviceId: string;
  deviceToken: string;
};

const ACCOUNT_NAME = "paired-device";

export class DeviceCredentialStore {
  constructor(private readonly target: string) {}

  private getFallbackPath() {
    const base =
      process.env.APPDATA ?? process.env.USERPROFILE ?? process.cwd();
    return path.join(base, "AutoOrganizer", "device-credentials.json");
  }

  private async loadKeytar() {
    if (process.platform !== "win32") {
      return null;
    }
    try {
      const moduleName = "keytar";
      const mod = await import(moduleName);
      return mod.default ?? mod;
    } catch {
      return null;
    }
  }

  private encryptDpapi(plain: string): string | null {
    return protectDpapi(plain);
  }

  private decryptDpapi(cipherText: string): string | null {
    return unprotectDpapi(cipherText);
  }

  private async getFromDpapiFile(): Promise<PersistedDeviceCredentials | null> {
    if (process.platform !== "win32") return null;
    try {
      const raw = await readFile(this.getFallbackPath(), "utf8");
      const parsed = JSON.parse(raw) as {
        deviceId?: string;
        encryptedToken?: string;
      };
      if (!parsed.deviceId || !parsed.encryptedToken) return null;
      const token = this.decryptDpapi(parsed.encryptedToken);
      if (!token) return null;
      return {
        deviceId: parsed.deviceId,
        deviceToken: token
      };
    } catch {
      return null;
    }
  }

  private async setToDpapiFile(input: PersistedDeviceCredentials): Promise<boolean> {
    if (process.platform !== "win32") return false;
    const encrypted = this.encryptDpapi(input.deviceToken);
    if (!encrypted) return false;
    try {
      const file = this.getFallbackPath();
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          {
            deviceId: input.deviceId,
            encryptedToken: encrypted,
            method: "dpapi"
          },
          null,
          2
        ),
        "utf8"
      );
      return true;
    } catch {
      return false;
    }
  }

  private async clearDpapiFile(): Promise<boolean> {
    try {
      await rm(this.getFallbackPath(), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  async get(): Promise<PersistedDeviceCredentials | null> {
    const keytar = await this.loadKeytar();
    if (!keytar) return this.getFromDpapiFile();

    try {
      const raw = await keytar.getPassword(this.target, ACCOUNT_NAME);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedDeviceCredentials;
      if (!parsed.deviceId || !parsed.deviceToken) return null;
      return parsed;
    } catch {
      return this.getFromDpapiFile();
    }
  }

  async set(input: PersistedDeviceCredentials): Promise<boolean> {
    const keytar = await this.loadKeytar();
    if (!keytar) return this.setToDpapiFile(input);
    try {
      await keytar.setPassword(this.target, ACCOUNT_NAME, JSON.stringify(input));
      return true;
    } catch {
      return this.setToDpapiFile(input);
    }
  }

  async clear(): Promise<boolean> {
    const keytar = await this.loadKeytar();
    if (!keytar) return this.clearDpapiFile();
    try {
      const deleted = await keytar.deletePassword(this.target, ACCOUNT_NAME);
      await this.clearDpapiFile();
      return deleted;
    } catch {
      return this.clearDpapiFile();
    }
  }
}

export type { PersistedDeviceCredentials };
