import fs from "node:fs";
import path from "node:path";
import type { ProposalResult } from "@ao/contracts";
import type { LocalSettings, PathPolicyDecision, WatchedPathRecord } from "./types.js";

function normalizeForCompare(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function toExistingRealPath(input: string): string {
  const resolved = path.resolve(input);
  if (fs.existsSync(resolved)) {
    return fs.realpathSync.native(resolved);
  }
  let cursor = resolved;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const realParent = fs.existsSync(cursor)
    ? fs.realpathSync.native(cursor)
    : cursor;
  const suffix = path.relative(cursor, resolved);
  return suffix ? path.join(realParent, suffix) : realParent;
}

function isWithin(root: string, target: string): boolean {
  const rootNorm = normalizeForCompare(root);
  const targetNorm = normalizeForCompare(target);
  if (rootNorm === targetNorm) return true;
  return targetNorm.startsWith(`${rootNorm}${path.sep}`);
}

export class PathPolicyService {
  constructor(
    private readonly getSettings: () => LocalSettings,
    private readonly getWatchedPaths: () => WatchedPathRecord[]
  ) {}

  normalizePath(input: string): string {
    return toExistingRealPath(input);
  }

  isPathAllowedForScan(candidatePath: string): PathPolicyDecision {
    const watched = this.getWatchedPaths().filter((p) => p.isEnabled);
    const normalized = this.normalizePath(candidatePath);
    const matchingEnabled = watched.filter(
      (p) => !p.isProtected && isWithin(this.normalizePath(p.path), normalized)
    );
    if (matchingEnabled.length === 0) {
      return { allowed: false, reason: "outside_watched_paths" };
    }

    const matchingProtected = watched.filter(
      (p) => p.isProtected && isWithin(this.normalizePath(p.path), normalized)
    );
    if (matchingProtected.length > 0) {
      return { allowed: false, reason: "inside_protected_path" };
    }
    return { allowed: true };
  }

  validateOperationPaths(input: {
    actionType: ProposalResult["actionType"];
    sourcePath: string;
    targetPath?: string;
  }): PathPolicyDecision {
    const source = this.normalizePath(input.sourcePath);
    const sourceDecision = this.isPathAllowedForScan(source);
    if (!sourceDecision.allowed) return sourceDecision;

    if (!input.targetPath) return { allowed: true };

    const target = this.normalizePath(input.targetPath);
    const settings = this.getSettings();
    const watched = this.getWatchedPaths();
    const allowedRoots = [
      settings.organizedRootPath,
      settings.archiveRootPath,
      settings.duplicateReviewPath
    ].filter(Boolean);

    const sameDirRename =
      input.actionType === "rename" &&
      path.dirname(source).toLowerCase() === path.dirname(target).toLowerCase();

    const inAllowedRoot = allowedRoots.some((root) =>
      isWithin(this.normalizePath(root), target)
    );

    if (!sameDirRename && !inAllowedRoot) {
      return { allowed: false, reason: "target_outside_allowed_roots" };
    }

    const protectedRoots = watched
      .filter((p) => p.isProtected)
      .map((p) => this.normalizePath(p.path));
    if (protectedRoots.some((root) => isWithin(root, target))) {
      return { allowed: false, reason: "target_inside_protected_path" };
    }

    return { allowed: true };
  }
}

