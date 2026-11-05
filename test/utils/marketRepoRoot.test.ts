import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { findMarketRepoRoot } from "../../src/utils/marketRepoRoot";

const fixturesPath = path.resolve(__dirname, "../../fixtures/market-repo");

describe("findMarketRepoRoot", () => {
  it("finds market repo root from a main template file", () => {
    const filePath = path.join(
      fixturesPath,
      "reconciliation_texts/reconciliation_text_1/main.liquid",
    );

    expect(findMarketRepoRoot(filePath)).toBe(fixturesPath);
  });

  it("finds market repo root from a text part", () => {
    const filePath = path.join(
      fixturesPath,
      "export_files/export_1/text_parts/part_1.liquid",
    );

    expect(findMarketRepoRoot(filePath)).toBe(fixturesPath);
  });

  it("finds market repo root from a shared part", () => {
    const filePath = path.join(
      fixturesPath,
      "shared_parts/shared_part_1/shared_part_1.liquid",
    );

    expect(findMarketRepoRoot(filePath)).toBe(fixturesPath);
  });

  it("returns null for files outside a market repo", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "silverfin-ls-"));
    try {
      expect(findMarketRepoRoot(path.join(tmpDir, "file.liquid"))).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
