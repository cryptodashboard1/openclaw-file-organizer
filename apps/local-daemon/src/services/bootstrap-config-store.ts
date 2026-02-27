import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nowIso } from "@ao/common";
import { protectDpapi, unprotectDpapi } from "./windows-dpapi.js";

type PersistedBootstrap = {
  version: 1;
  controlApiUrl: string;
  encryptedServiceToken: string;
  generatedAt: string;
};

export type LoadedBootstrapConfig = {
  controlApiUrl: string;
  serviceToken: string;
  generatedAt: string;
};

export class BootstrapConfigStore {
  constructor(private readonly filePath: string) {}

  getPath() {
    return this.filePath;
  }

  async load(): Promise<LoadedBootstrapConfig | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersistedBootstrap> & {
        serviceToken?: string;
      };
      if (!parsed.controlApiUrl) return null;

      if (parsed.encryptedServiceToken) {
        const token = unprotectDpapi(parsed.encryptedServiceToken);
        if (!token) return null;
        return {
          controlApiUrl: parsed.controlApiUrl,
          serviceToken: token,
          generatedAt: parsed.generatedAt ?? nowIso()
        };
      }

      if (parsed.serviceToken) {
        return {
          controlApiUrl: parsed.controlApiUrl,
          serviceToken: parsed.serviceToken,
          generatedAt: parsed.generatedAt ?? nowIso()
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  async save(input: {
    controlApiUrl: string;
    serviceToken: string;
  }): Promise<boolean> {
    const encrypted = protectDpapi(input.serviceToken);
    if (!encrypted) return false;

    const payload: PersistedBootstrap = {
      version: 1,
      controlApiUrl: input.controlApiUrl,
      encryptedServiceToken: encrypted,
      generatedAt: nowIso()
    };

    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<boolean> {
    try {
      await rm(this.filePath, { force: true });
      return true;
    } catch {
      return false;
    }
  }
}
