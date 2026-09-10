import * as path from "path";
import { findMarketRepoRoot } from "../../src/utils/marketRepoRoot";

const fixturesPath = path.resolve(
  __dirname,
  "../../fixtures/market-repo",
);

describe("findMarketRepoRoot", () => {
  it("finds market repo root from a reconciliation text file", () => {
    const filePath = path.join(
      fixturesPath,
      "reconciliation_texts/reconciliation_text_1/main.liquid",
    );

    expect(findMarketRepoRoot(filePath)).toBe(fixturesPath);
  });

  it("finds market repo root when file is nested inside a parent workspace", () => {
    const parentWorkspace = path.resolve(__dirname, "../../fixtures");
    const filePath = path.join(
      parentWorkspace,
      "market-repo/reconciliation_texts/reconciliation_text_1/main.liquid",
    );

    expect(findMarketRepoRoot(filePath)).toBe(
      path.join(parentWorkspace, "market-repo"),
    );
  });

  it("returns null for non-template files", () => {
    expect(findMarketRepoRoot("/tmp/some-random-file.liquid")).toBeNull();
  });
});
