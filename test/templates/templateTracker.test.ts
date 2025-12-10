import { TemplateTracker } from "../../src/templates/templateTracker";
import { URI } from "vscode-uri";
import * as path from "path";

const fixturesPath = path.resolve(__dirname, "../../fixtures/market-repo");

describe("TemplateTracker", () => {
  let tracker: TemplateTracker;

  beforeEach(() => {
    tracker = TemplateTracker.getInstance();
    // Reset by visiting a known template
    const resetUri = URI.file(
      path.join(
        fixturesPath,
        "reconciliation_texts/reconciliation_text_1/main.liquid",
      ),
    ).toString();
    tracker.updateFromUri(resetUri);
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = TemplateTracker.getInstance();
      const instance2 = TemplateTracker.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("updateFromUri - Main Templates", () => {
    it("should track reconciliation text template", () => {
      const uri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/main.liquid",
        ),
      ).toString();

      tracker.updateFromUri(uri);
      const result = tracker.getLastVisited();

      expect(result).not.toBeNull();
      expect(result!.type).toBe("reconciliationText");
      expect(result!.handle).toBe("reconciliation_text_2");
    });

    it("should track export file template", () => {
      const uri = URI.file(
        path.join(fixturesPath, "export_files/export_1/main.liquid"),
      ).toString();

      tracker.updateFromUri(uri);
      const result = tracker.getLastVisited();

      expect(result).not.toBeNull();
      expect(result!.type).toBe("exportFile");
      expect(result!.handle).toBe("export_1");
    });

    it("should track account template", () => {
      const uri = URI.file(
        path.join(fixturesPath, "account_templates/account_1/main.liquid"),
      ).toString();

      tracker.updateFromUri(uri);
      const result = tracker.getLastVisited();

      expect(result).not.toBeNull();
      expect(result!.type).toBe("accountTemplate");
      expect(result!.handle).toBe("account_1");
    });

    it("should update to most recent template when called multiple times", () => {
      const uri1 = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      const uri2 = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/main.liquid",
        ),
      ).toString();

      tracker.updateFromUri(uri1);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      tracker.updateFromUri(uri2);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_2");
    });
  });

  describe("updateFromUri - Shared Parts", () => {
    it("should not update when visiting shared part", () => {
      const mainUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(mainUri);
      const beforeVisit = tracker.getLastVisited();

      const sharedUri = URI.file(
        path.join(
          fixturesPath,
          "shared_parts/shared_part_1/shared_part_1.liquid",
        ),
      ).toString();
      tracker.updateFromUri(sharedUri);
      const afterVisit = tracker.getLastVisited();

      expect(afterVisit).toEqual(beforeVisit);
      expect(afterVisit!.type).toBe("reconciliationText");
      expect(afterVisit!.handle).toBe("reconciliation_text_1");
    });

    it("should preserve last visited template across multiple shared part visits", () => {
      const mainUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(mainUri);

      const shared1 = URI.file(
        path.join(
          fixturesPath,
          "shared_parts/shared_part_1/shared_part_1.liquid",
        ),
      ).toString();
      const shared2 = URI.file(
        path.join(
          fixturesPath,
          "shared_parts/variable_shared/variable_shared.liquid",
        ),
      ).toString();

      tracker.updateFromUri(shared1);
      tracker.updateFromUri(shared2);

      const result = tracker.getLastVisited();
      expect(result!.type).toBe("reconciliationText");
      expect(result!.handle).toBe("reconciliation_text_2");
    });
  });

  describe("updateFromUri - Text Parts", () => {
    it("should update from text parts when template is different", () => {
      const mainUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(mainUri);
      const beforeVisit = tracker.getLastVisited();

      const textPartUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/text_parts/part_1.liquid",
        ),
      ).toString();
      tracker.updateFromUri(textPartUri);
      const afterVisit = tracker.getLastVisited();

      expect(afterVisit).not.toEqual(beforeVisit);
      expect(afterVisit!.type).toBe("reconciliationText");
      expect(afterVisit!.handle).toBe("reconciliation_text_2");
    });
  });

  describe("updateFromUri - Invalid URIs", () => {
    it("should not crash on invalid URI", () => {
      const mainUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(mainUri);
      const before = tracker.getLastVisited();

      tracker.updateFromUri("invalid://uri/path");
      const after = tracker.getLastVisited();

      expect(after).toEqual(before);
    });

    it("should not crash on non-template file URI", () => {
      const mainUri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(mainUri);
      const before = tracker.getLastVisited();

      tracker.updateFromUri(
        URI.file(path.join(fixturesPath, "package.json")).toString(),
      );
      const after = tracker.getLastVisited();

      expect(after).toEqual(before);
    });
  });

  describe("getLastVisited", () => {
    it("should return defensive copy of last visited template", () => {
      const uri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(uri);

      const result1 = tracker.getLastVisited();
      const result2 = tracker.getLastVisited();

      expect(result1).toEqual(result2);
      expect(result1).not.toBe(result2);
    });
  });

  describe("Template Type Coverage", () => {
    it("should handle all valid main template types", () => {
      const templates = [
        {
          path: "reconciliation_texts/reconciliation_text_1/main.liquid",
          type: "reconciliationText",
          handle: "reconciliation_text_1",
        },
        {
          path: "export_files/export_1/main.liquid",
          type: "exportFile",
          handle: "export_1",
        },
        {
          path: "account_templates/account_1/main.liquid",
          type: "accountTemplate",
          handle: "account_1",
        },
      ];

      templates.forEach((template) => {
        const uri = URI.file(path.join(fixturesPath, template.path)).toString();
        tracker.updateFromUri(uri);

        const result = tracker.getLastVisited();
        expect(result!.type).toBe(template.type);
        expect(result!.handle).toBe(template.handle);
      });
    });
  });

  // In the LSP specification, there is no direct concept of "buffer switching" as in traditional editors.
  // We can only track onDidOpen and onDidChange events, which does not cover visiting already opened documents.
  // We try to simulate buffer switching by updating the lastVisited template in most requests done to the language server.
  describe("Buffer Switching Simulation", () => {
    it("should update context when switching between main templates", () => {
      // Simulate opening template 1
      const template1Uri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(template1Uri);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      // Simulate switching to a shared part (no update)
      const sharedUri = URI.file(
        path.join(
          fixturesPath,
          "shared_parts/shared_part_1/shared_part_1.liquid",
        ),
      ).toString();
      tracker.updateFromUri(sharedUri);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      // Simulate switching back to template 2 (should update)
      const template2Uri = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(template2Uri);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_2");

      // Simulate switching back to shared part (context remains template 2)
      tracker.updateFromUri(sharedUri);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_2");
    });

    it("should update context when rapidly switching between templates", () => {
      const templates = [
        {
          uri: URI.file(
            path.join(
              fixturesPath,
              "reconciliation_texts/reconciliation_text_1/main.liquid",
            ),
          ).toString(),
          handle: "reconciliation_text_1",
        },
        {
          uri: URI.file(
            path.join(fixturesPath, "export_files/export_1/main.liquid"),
          ).toString(),
          handle: "export_1",
        },
        {
          uri: URI.file(
            path.join(fixturesPath, "account_templates/account_1/main.liquid"),
          ).toString(),
          handle: "account_1",
        },
      ];

      // Rapidly switch between different template types
      templates.forEach((template) => {
        tracker.updateFromUri(template.uri);
        expect(tracker.getLastVisited()!.handle).toBe(template.handle);
      });

      // Last one wins
      expect(tracker.getLastVisited()!.handle).toBe("account_1");
    });

    it("should maintain correct context through complex workflow", () => {
      // Open template 1
      const t1 = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(t1);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      // Switch to its text part (no change)
      const tp1 = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_1/text_parts/part_1.liquid",
        ),
      ).toString();
      tracker.updateFromUri(tp1);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      // Switch to shared part (no change)
      const sp = URI.file(
        path.join(
          fixturesPath,
          "shared_parts/shared_part_1/shared_part_1.liquid",
        ),
      ).toString();
      tracker.updateFromUri(sp);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_1");

      // Switch to template 2 (changes)
      const t2 = URI.file(
        path.join(
          fixturesPath,
          "reconciliation_texts/reconciliation_text_2/main.liquid",
        ),
      ).toString();
      tracker.updateFromUri(t2);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_2");

      // Back to shared part (context is now template 2)
      tracker.updateFromUri(sp);
      expect(tracker.getLastVisited()!.handle).toBe("reconciliation_text_2");
    });
  });
});
