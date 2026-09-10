import * as fs from "fs";
import * as path from "path";

/**
 * Finds the Silverfin market repo root for a template file by walking up
 * until a directory containing template type folders is found.
 */
export function findMarketRepoRoot(filePath: string): string | null {
  let current = path.dirname(filePath);

  while (current !== path.dirname(current)) {
    const hasReconciliationTexts = fs.existsSync(
      path.join(current, "reconciliation_texts"),
    );
    const hasExportFiles = fs.existsSync(path.join(current, "export_files"));
    const hasAccountTemplates = fs.existsSync(
      path.join(current, "account_templates"),
    );

    if (hasReconciliationTexts || hasExportFiles || hasAccountTemplates) {
      return current;
    }

    current = path.dirname(current);
  }

  return null;
}
