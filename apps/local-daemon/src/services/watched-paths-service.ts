import fs from "node:fs";
import path from "node:path";
import { LocalStore } from "./local-store.js";
import type { WatchedPathRecord } from "./types.js";

export class WatchedPathsService {
  constructor(private readonly store: LocalStore) {}

  list(): WatchedPathRecord[] {
    return this.store.listWatchedPaths();
  }

  add(input: {
    path: string;
    pathType: WatchedPathRecord["pathType"];
    isEnabled?: boolean;
    isProtected?: boolean;
    includeSubfolders?: boolean;
  }): WatchedPathRecord {
    const resolved = path.resolve(input.path);
    return this.store.addWatchedPath({
      path: resolved,
      pathType: input.pathType,
      isEnabled: input.isEnabled ?? true,
      isProtected: input.isProtected ?? false,
      includeSubfolders: input.includeSubfolders ?? false
    });
  }

  update(
    id: string,
    patch: Partial<
      Pick<
        WatchedPathRecord,
        "path" | "pathType" | "isEnabled" | "isProtected" | "includeSubfolders"
      >
    >
  ): WatchedPathRecord | null {
    const nextPatch = { ...patch };
    if (nextPatch.path) {
      nextPatch.path = path.resolve(nextPatch.path);
    }
    return this.store.updateWatchedPath(id, nextPatch);
  }

  delete(id: string): boolean {
    return this.store.deleteWatchedPath(id);
  }

  validatePath(inputPath: string) {
    const resolved = path.resolve(inputPath);
    const exists = fs.existsSync(resolved);
    let isDirectory = false;
    if (exists) {
      try {
        isDirectory = fs.statSync(resolved).isDirectory();
      } catch {
        isDirectory = false;
      }
    }
    return { path: resolved, exists, isDirectory };
  }
}
