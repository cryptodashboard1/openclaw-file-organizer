import path from "node:path";
import type { ScanCandidate } from "./types.js";

const SCREENSHOT_NAME_RE = /(screenshot|screen[-_ ]?shot|snip|capture)/i;
const GENERIC_NAME_RE =
  /^(img[_-]?\d+|document(?: ?\(\d+\))?|untitled(?: ?\(\d+\))?|new[-_ ]?document|scan(?: ?\(\d+\))?)$/i;

export class ClassificationService {
  classifyBatch(candidates: ScanCandidate[]): ScanCandidate[] {
    return candidates.map((candidate) => {
      const ext = candidate.extension.toLowerCase();
      const base = path.basename(candidate.filename, ext).toLowerCase();

      let classification = "unknown";
      let confidence = 0.52;
      let label = this.slug(base || "file");
      let rationale = "No high-confidence pattern detected.";
      let manualReview = false;

      if ([".exe", ".msi"].includes(ext)) {
        classification = "installer";
        confidence = 0.96;
        label = `installer-${this.slug(base.replace(/[_\s]+installer/i, "")) || "package"}`;
        rationale = "Installer extension detected.";
      } else if ([".zip", ".rar", ".7z"].includes(ext)) {
        classification = "archive_zip";
        confidence = 0.91;
        label = `archive-${this.slug(base)}`;
        rationale = "Archive extension detected.";
      } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext) && SCREENSHOT_NAME_RE.test(base)) {
        classification = "screenshot_ui";
        confidence = 0.9;
        label = `screenshot-${this.slug(base.replace(SCREENSHOT_NAME_RE, "")) || "capture"}`;
        rationale = "Image extension and screenshot naming pattern detected.";
      } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        classification = "image_asset";
        confidence = 0.7;
        label = this.slug(base);
        rationale = "Image extension detected.";
      } else if ([".pdf", ".docx", ".doc", ".txt", ".csv"].includes(ext)) {
        classification = "document_general";
        confidence = 0.76;
        label = this.slug(base);
        rationale = "Document extension detected.";
      }

      if (GENERIC_NAME_RE.test(base)) {
        label = this.slug(base.replace(/\(\d+\)/g, "")) || "document";
        confidence = Math.min(0.99, confidence + 0.08);
      }

      if (confidence < 0.6) {
        manualReview = true;
      }

      return {
        ...candidate,
        classification,
        confidence,
        generatedLabel: label,
        rationale,
        manualReview
      };
    });
  }

  private slug(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }
}
