import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { CleanupJob } from "@ao/contracts";
import { createId } from "@ao/common";
import { lookup as lookupMime } from "mime-types";
import { LocalStore } from "./local-store.js";
import { PathPolicyService } from "./path-policy-service.js";
import type { ScanCandidate, WatchedPathRecord } from "./types.js";

export class ScanService {
  constructor(
    private readonly store: LocalStore,
    private readonly pathPolicy: PathPolicyService,
    private readonly listWatchedPaths: () => WatchedPathRecord[],
    private readonly includeHiddenDefault: boolean
  ) {}

  async scanJobScope(job: CleanupJob): Promise<{
    candidates: ScanCandidate[];
    skippedForSafety: number;
    matchedWatchedPaths: number;
  }> {
    const watched = this.filterWatched(job);
    const maxFiles = job.scope.maxFiles ?? 500;
    const includeHidden = this.includeHiddenDefault;

    const candidates: ScanCandidate[] = [];
    let skippedForSafety = 0;

    for (const watchedPath of watched) {
      if (candidates.length >= maxFiles) break;
      const scanned = await this.scanPath(watchedPath, includeHidden, maxFiles - candidates.length);
      for (const item of scanned) {
        const decision = this.pathPolicy.isPathAllowedForScan(item.absolutePath);
        if (!decision.allowed) {
          skippedForSafety += 1;
          continue;
        }
        const stableFileId = this.store.upsertFileRecord(item);
        candidates.push({
          ...item,
          fileId: stableFileId
        });
        if (candidates.length >= maxFiles) break;
      }
    }

    return { candidates, skippedForSafety, matchedWatchedPaths: watched.length };
  }

  private filterWatched(job: CleanupJob): WatchedPathRecord[] {
    const watched = this.listWatchedPaths().filter((row) => row.isEnabled);
    const byKinds = job.scope.pathKinds?.length
      ? watched.filter((row) => job.scope.pathKinds?.includes(row.pathType))
      : watched;
    const byIds = job.scope.pathIds?.length
      ? byKinds.filter((row) => job.scope.pathIds?.includes(row.id))
      : byKinds;
    return byIds;
  }

  private async scanPath(
    watchedPath: WatchedPathRecord,
    includeHidden: boolean,
    limit: number
  ): Promise<ScanCandidate[]> {
    const resolvedRoot = this.pathPolicy.normalizePath(watchedPath.path);
    const files: ScanCandidate[] = [];
    const stack = [resolvedRoot];
    const recursive = watchedPath.includeSubfolders;

    while (stack.length > 0 && files.length < limit) {
      const currentDir = stack.pop()!;
      let entries: Dirent[];
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!includeHidden && entry.name.startsWith(".")) {
          continue;
        }

        const absolute = path.join(currentDir, entry.name);
        if (entry.isSymbolicLink()) {
          continue;
        }
        if (entry.isDirectory()) {
          if (recursive) {
            stack.push(absolute);
          }
          continue;
        }
        if (!entry.isFile()) continue;

        let stat;
        try {
          stat = await fs.stat(absolute);
        } catch {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        const mimeType = (lookupMime(ext) || null) as string | null;
        files.push({
          fileId: createId("file"),
          absolutePath: absolute,
          parentPath: currentDir,
          filename: entry.name,
          extension: ext,
          mimeType,
          sizeBytes: stat.size,
          createdAtFs: stat.birthtime?.toISOString?.() ?? null,
          modifiedAtFs: stat.mtime?.toISOString?.() ?? null
        });

        if (files.length >= limit) break;
      }
    }

    return files.sort((a, b) =>
      (b.modifiedAtFs ?? "").localeCompare(a.modifiedAtFs ?? "")
    );
  }
}
