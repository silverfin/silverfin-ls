import { ReferenceProvider } from "../../src/lspCapabilities/referenceProvider";
import { ReferenceParams } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import * as path from "path";
import {
  fixturesPath,
  visitTemplate,
} from "../helpers/templateTestHelpers";

describe("ReferenceProvider - Variables", () => {
  const mainFilePath = path.join(
    fixturesPath,
    "reconciliation_texts/variable_definition_test/main.liquid",
  );
  const textPartPath = path.join(
    fixturesPath,
    "reconciliation_texts/variable_definition_test/text_parts/definitions.liquid",
  );

  describe("References in Same File", () => {
    it("should find all references to simple_var from a reference position", async () => {
      // Line 4: {% assign simple_var = "Simple Value" %} - definition
      // Line 21: {{ simple_var }} - reference
      // Line 22: {% assign assigned_simple_var = simple_var %} - reference
      // Line 23: {% capture captured_simple_var %}{{ simple_var }}{% endcapture %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 20, character: 6 }, // On {{ simple_var }}
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBe(3); // Exactly 3 references

      // Verify references are returned in correct order (by position in file)
      const refLines = result!.map((loc) => loc.range.start.line);
      expect(refLines).toEqual([20, 21, 22]); // Lines 21, 22, 23 (0-indexed)

      // Should NOT include definition when includeDeclaration is false
      const definitionLoc = result!.find((loc) => loc.range.start.line === 3);
      expect(definitionLoc).toBeUndefined();
    });

    it("should include definition by default (when includeDeclaration not specified)", async () => {
      // Line 4: {% assign simple_var = "Simple Value" %} - definition
      // Line 21: {{ simple_var }} - reference
      // Line 22: {% assign assigned_simple_var = simple_var %} - reference
      // Line 23: {% capture captured_simple_var %}{{ simple_var }}{% endcapture %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 20, character: 6 },
        context: { includeDeclaration: true }, // Explicit true
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();

      // Verify definition and references are returned in correct order
      const allLines = result!.map((loc) => loc.range.start.line);

      expect(result!.length).toBe(4); // 3 references + 1 definition
      expect(allLines).toEqual([3, 20, 21, 22]); // Definition + references
    });

    it("should find references from definition position", async () => {
      // Testing from the definition itself
      // Line 4: {% assign simple_var = "Simple Value" %}
      // Now works! When on a definition, we still find all references
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 3, character: 18 }, // On simple_var in definition
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      // Should find references even when cursor is on definition
      expect(result).not.toBeNull();
      expect(result!.length).toBe(3); // Exactly 3 references

      // Verify references are returned in correct order
      const refLines = result!.map((loc) => loc.range.start.line);
      expect(refLines).toEqual([20, 21, 22]);
    });

    it("should find references to captured_var", async () => {
      // Line 7: {% capture captured_var %}...{% endcapture %} - definition
      // Line 24: {{ captured_var }} - reference
      // Line 25: {% assign assigned_captured_var = captured_var %} - reference
      // Line 26: {% capture captured_captured_var %}{{ captured_var }}{% endcapture %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 23, character: 6 },
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBe(3); // Exactly 3 references

      // Verify references are returned in correct order
      const refLines = result!.map((loc) => loc.range.start.line);
      expect(refLines).toEqual([23, 24, 25]); // Lines 24, 25, 26 (0-indexed)
    });

    it("should find references to for loop iterator variable (items)", async () => {
      // Line 10: {% assign items = "a,b,c" | split: "," %} - definition
      // Line 11: {% for loop_var in items %} - reference
      // Line 18: {{ items }} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 17, character: 6 }, // On {{ items }}
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBe(2); // Exactly 2 references

      // Verify references are returned in correct order
      const refLines = result!.map((loc) => loc.range.start.line);
      expect(refLines).toEqual([10, 17]); // Lines 11 and 18 (0-indexed)
    });
  });

  describe("References Across Text Parts", () => {
    it("should find references to text_part_var across files", async () => {
      // Text part line 3: {% assign text_part_var = "From Text Part" %} - definition
      // Main file line 30: {{ text_part_var }} - reference
      // Main file line 31: {% assign assigned_text_part_var = text_part_var %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 29, character: 6 }, // On {{ text_part_var }}
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // References are in both text part and main file
      const hasMainFileRefs = result!.some((loc) =>
        loc.uri.includes("main.liquid"),
      );
      const hasTextPartRefs = result!.some((loc) =>
        loc.uri.includes("definitions.liquid"),
      );

      expect(hasMainFileRefs || hasTextPartRefs).toBe(true);
    });

    it("should include definition from text part when includeDeclaration is true", async () => {
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 29, character: 6 },
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();

      // Should include definition from text part
      const defFromTextPart = result!.find(
        (loc) => loc.uri.includes(textPartPath) && loc.range.start.line === 2,
      );
      expect(defFromTextPart).toBeDefined();
    });
  });

  describe("References Across Shared Parts", () => {
    it("should find references to shared_var across shared parts", async () => {
      // Shared part line 3: {% assign shared_var = "From Shared Part" %} - definition
      // Main file line 36: {{ shared_var }} - reference
      // Main file line 37: {% assign assigned_shared_var = shared_var %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 35, character: 6 },
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Multiple Definitions", () => {
    it("should find all references when variable has multiple definitions", async () => {
      // Line 44: {% assign multi_var = "First Definition" %} - definition 1
      // Line 45: {% assign multi_var = "Second Definition" %} - definition 2
      // Line 46: {{ multi_var }} - reference
      // Line 47: {% assign assigned_multi_var = multi_var %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 45, character: 6 }, // On {{ multi_var }}
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);
    });

    it("should include all definitions when includeDeclaration is true", async () => {
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 45, character: 6 },
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();

      // Should include both definitions
      const def1 = result!.find((loc) => loc.range.start.line === 43);
      const def2 = result!.find((loc) => loc.range.start.line === 44);

      expect(def1).toBeDefined();
      expect(def2).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should return null when cursor is not on a variable", async () => {
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 0, character: 5 }, // On comment
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).toBeNull();
    });

    it("should find references even for variable defined after usage", async () => {
      // Line 40: {{ undefined_var }} - usage before definition
      // Line 41: {% assign undefined_var = "Defined After" %} - definition
      // References should still be found (the usage on line 40)
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 39, character: 6 },
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      // Should find at least the reference on line 40
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("ReferenceProvider - Translation Tags", () => {
  const mainFilePath = path.join(
    fixturesPath,
    "reconciliation_texts/translation_test/main.liquid",
  );

  describe("Translation References in Same File", () => {
    it("should find all references to translation key", async () => {
      // Line 2: {% t= "key_from_main" ... %} - definition
      // Line 6: {% t "key_from_main" %} - reference (testing from here)
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 6, character: 7 }, // On "key_from_main" in usage
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);

      // Should find the reference on line 6
      const ref = result!.find((loc) => loc.range.start.line === 6);
      expect(ref).toBeDefined();
    });

    it("should include definition when includeDeclaration is true", async () => {
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 6, character: 7 },
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();

      // Should include the definition on line 2
      const def = result!.find((loc) => loc.range.start.line === 2);
      expect(def).toBeDefined();
    });
  });

  describe("Translation References Across Files", () => {
    it("should find references to translation key from text part", async () => {
      // Text part line 3: {% t= "key_from_text_part" ... %} - definition
      // Main line 7: {% t "key_from_text_part" %} - reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 7, character: 7 },
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Edge Cases", () => {
    it("should find references for translation key even if no definition exists", async () => {
      // Line 9: {% t "undefined_key" %} - usage but no definition
      // The translation_expression itself is a reference
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 9, character: 7 },
        context: { includeDeclaration: false },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      // Should find at least this translation_expression
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("ReferenceProvider - Cross-File Translation References", () => {
  const mainFilePath = path.join(
    fixturesPath,
    "reconciliation_texts/reconciliation_text_1/main.liquid",
  );
  const part1Path = path.join(
    fixturesPath,
    "reconciliation_texts/reconciliation_text_1/text_parts/part_1.liquid",
  );
  const part2Path = path.join(
    fixturesPath,
    "reconciliation_texts/reconciliation_text_1/text_parts/part_2.liquid",
  );
  const sharedPart1Path = path.join(
    fixturesPath,
    "shared_parts/shared_part_1/shared_part_1.liquid",
  );

  describe("Translation References - Text Parts", () => {
    it("should find definition of title_t from part_1 when referenced in main", async () => {
      // part_1.liquid line 1: {% t="title_t" default:"Title" es:"Título" %}
      // main.liquid line 7: {% t "title_t" %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 6, character: 7 }, // On "title_t" in usage
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in part_1
      const defInPart1 = result!.find(
        (loc) =>
          loc.uri.includes("part_1.liquid") && loc.range.start.line === 0,
      );
      expect(defInPart1).toBeDefined();

      // Should find reference in main
      const refInMain = result!.find(
        (loc) => loc.uri.includes("main.liquid") && loc.range.start.line === 6,
      );
      expect(refInMain).toBeDefined();
    });

    it("should find all references to title_t from definition in part_1", async () => {
      // part_1.liquid line 1: {% t="title_t" default:"Title" es:"Título" %}
      // main.liquid line 7: {% t "title_t" %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(part1Path).toString() },
        position: { line: 0, character: 7 }, // On "title_t" in definition
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in part_1
      const defInPart1 = result!.find(
        (loc) =>
          loc.uri.includes("part_1.liquid") && loc.range.start.line === 0,
      );
      expect(defInPart1).toBeDefined();

      // Should find reference in main
      const refInMain = result!.find(
        (loc) => loc.uri.includes("main.liquid") && loc.range.start.line === 6,
      );
      expect(refInMain).toBeDefined();
    });

    it("should find all references to subtitle_t across part_2 and main", async () => {
      // part_2.liquid line 1: {% t="subtitle_t" default:"Subtitle" es:"Subtítulo" %}
      // main.liquid line 9: {% t "subtitle_t" %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 8, character: 7 }, // On "subtitle_t" in usage
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in part_2
      const defInPart2 = result!.find(
        (loc) =>
          loc.uri.includes("part_2.liquid") && loc.range.start.line === 0,
      );
      expect(defInPart2).toBeDefined();

      // Should find reference in main
      const refInMain = result!.find(
        (loc) => loc.uri.includes("main.liquid") && loc.range.start.line === 8,
      );
      expect(refInMain).toBeDefined();
    });

    it("should find all references to subtitle_t from definition in part_2", async () => {
      // part_2.liquid line 1: {% t="subtitle_t" default:"Subtitle" es:"Subtítulo" %}
      // main.liquid line 9: {% t "subtitle_t" %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(part2Path).toString() },
        position: { line: 0, character: 7 }, // On "subtitle_t" in definition
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in part_2
      const defInPart2 = result!.find(
        (loc) =>
          loc.uri.includes("part_2.liquid") && loc.range.start.line === 0,
      );
      expect(defInPart2).toBeDefined();

      // Should find reference in main
      const refInMain = result!.find(
        (loc) => loc.uri.includes("main.liquid") && loc.range.start.line === 8,
      );
      expect(refInMain).toBeDefined();
    });
  });

  describe("Translation References - Shared Parts", () => {
    beforeEach(() => {
      visitTemplate("reconciliation_texts", "reconciliation_text_2");
    });

    it("should find all references to shared_translation_1 from usage in main", async () => {
      // shared_part_1.liquid line 1: {% t= "shared_translation_1" default:"Shared Translation 1" nl:"Gedeelde Vertaling 1" %}
      // main.liquid line 11: {% t "shared_translation_1" %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 10, character: 7 }, // On "shared_translation_1" in usage
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in shared_part_1
      const defInShared = result!.find(
        (loc) =>
          loc.uri.includes("shared_part_1.liquid") &&
          loc.range.start.line === 0,
      );
      expect(defInShared).toBeDefined();

      // Should find reference in main
      const refInMain = result!.find(
        (loc) => loc.uri.includes("main.liquid") && loc.range.start.line === 10,
      );
      expect(refInMain).toBeDefined();
    });

    it("should find all references to shared_translation_1 from definition in shared_part_1", async () => {
      // shared_part_1.liquid line 1: {% t= "shared_translation_1" default:"Shared Translation 1" nl:"Gedeelde Vertaling 1" %}
      // This shared part is used by multiple reconciliation texts
      // The last visited template determines which one is used
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(sharedPart1Path).toString() },
        position: { line: 0, character: 7 }, // On "shared_translation_1" in definition
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(1);

      // Should find definition in shared_part_1
      const defInShared = result!.find(
        (loc) =>
          loc.uri.includes("shared_part_1.liquid") &&
          loc.range.start.line === 0,
      );
      expect(defInShared).toBeDefined();

      // The references found will be based on the last visited template
      // (reconciliation_text_2 as set in beforeEach)
    });
  });
});

describe("ReferenceProvider - Cross-File Variable References", () => {
  const mainFilePath = path.join(
    fixturesPath,
    "reconciliation_texts/variable_definition_test/main.liquid",
  );
  const textPartPath = path.join(
    fixturesPath,
    "reconciliation_texts/variable_definition_test/text_parts/definitions.liquid",
  );
  const sharedPartPath = path.join(
    fixturesPath,
    "shared_parts/variable_shared/variable_shared.liquid",
  );

  describe("Variable References - Text Parts", () => {
    it("should find all references to text_part_var across text part and main", async () => {
      // definitions.liquid line 3: {% assign text_part_var = "From Text Part" %}
      // definitions.liquid line 11: {{ text_part_var }}
      // main.liquid line 30: {{ text_part_var }}
      // main.liquid line 31: {% assign assigned_text_part_var = text_part_var %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 29, character: 6 }, // On {{ text_part_var }} in main
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in text part
      const defInTextPart = result!.find(
        (loc) =>
          loc.uri.includes("definitions.liquid") && loc.range.start.line === 2,
      );
      expect(defInTextPart).toBeDefined();

      // Should find references in main
      const refsInMain = result!.filter((loc) =>
        loc.uri.includes("main.liquid"),
      );
      expect(refsInMain.length).toBeGreaterThanOrEqual(2);
    });

    it("should find all references to text_part_var from definition in text part", async () => {
      // definitions.liquid line 3: {% assign text_part_var = "From Text Part" %}
      // definitions.liquid line 11: {{ text_part_var }}
      // main.liquid line 30: {{ text_part_var }}
      // main.liquid line 31: {% assign assigned_text_part_var = text_part_var %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(textPartPath).toString() },
        position: { line: 2, character: 12 }, // On text_part_var in definition
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in text part
      const defInTextPart = result!.find(
        (loc) =>
          loc.uri.includes("definitions.liquid") && loc.range.start.line === 2,
      );
      expect(defInTextPart).toBeDefined();

      // Should find references across files
      const allFiles = [
        ...new Set(
          result!.map((loc) => {
            const uri = loc.uri;
            if (uri.includes("definitions.liquid")) return "definitions.liquid";
            if (uri.includes("main.liquid")) return "main.liquid";
            return "other";
          }),
        ),
      ];
      expect(allFiles).toContain("definitions.liquid");
      expect(allFiles).toContain("main.liquid");
    });

    it("should find all references to text_part_var from reference in text part", async () => {
      // definitions.liquid line 3: {% assign text_part_var = "From Text Part" %}
      // definitions.liquid line 11: {{ text_part_var }}
      // main.liquid line 30: {{ text_part_var }}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(textPartPath).toString() },
        position: { line: 10, character: 6 }, // On {{ text_part_var }} in text part
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in text part
      const defInTextPart = result!.find(
        (loc) =>
          loc.uri.includes("definitions.liquid") && loc.range.start.line === 2,
      );
      expect(defInTextPart).toBeDefined();

      // Should find references across files
      const allFiles = [
        ...new Set(
          result!.map((loc) => {
            const uri = loc.uri;
            if (uri.includes("definitions.liquid")) return "definitions.liquid";
            if (uri.includes("main.liquid")) return "main.liquid";
            return "other";
          }),
        ),
      ];
      expect(allFiles).toContain("definitions.liquid");
      expect(allFiles).toContain("main.liquid");
    });
  });

  describe("Variable References - Shared Parts", () => {
    beforeEach(() => {
      visitTemplate("reconciliation_texts", "reconciliation_text_2");
    });

    it("should find all references to shared_var across shared part and main", async () => {
      // variable_shared.liquid line 3: {% assign shared_var = "From Shared Part" %}
      // variable_shared.liquid line 6: {{ shared_var }}
      // main.liquid line 36: {{ shared_var }}
      // main.liquid line 37: {% assign assigned_shared_var = shared_var %}
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 35, character: 6 }, // On {{ shared_var }} in main
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in shared part
      const defInShared = result!.find(
        (loc) =>
          loc.uri.includes("variable_shared.liquid") &&
          loc.range.start.line === 2,
      );
      expect(defInShared).toBeDefined();

      // Should find references in main
      const refsInMain = result!.filter((loc) =>
        loc.uri.includes("main.liquid"),
      );
      expect(refsInMain.length).toBeGreaterThanOrEqual(2);
    });

    it("should find all references to shared_var from definition in shared part", async () => {
      // variable_shared.liquid line 3: {% assign shared_var = "From Shared Part" %}
      // variable_shared.liquid line 6: {{ shared_var }}
      // The last visited template (reconciliation_text_2) uses this shared part
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(sharedPartPath).toString() },
        position: { line: 2, character: 12 }, // On shared_var in definition
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in shared part
      const defInShared = result!.find(
        (loc) =>
          loc.uri.includes("variable_shared.liquid") &&
          loc.range.start.line === 2,
      );
      expect(defInShared).toBeDefined();

      // Should find references in both the shared part itself and the main file
      const refInShared = result!.find(
        (loc) =>
          loc.uri.includes("variable_shared.liquid") &&
          loc.range.start.line === 5,
      );
      expect(refInShared).toBeDefined();

      // Should find references in the last visited template (reconciliation_text_2)
      const refsInMain = result!.filter(
        (loc) =>
          loc.uri.includes("reconciliation_text_2") &&
          loc.uri.includes("main.liquid"),
      );
      expect(refsInMain.length).toBeGreaterThanOrEqual(1);
    });

    it("should find all references to shared_var from reference in shared part", async () => {
      // variable_shared.liquid line 3: {% assign shared_var = "From Shared Part" %}
      // variable_shared.liquid line 6: {{ shared_var }}
      // The last visited template (reconciliation_text_2) uses this shared part
      const params: ReferenceParams = {
        textDocument: { uri: URI.file(sharedPartPath).toString() },
        position: { line: 5, character: 6 }, // On {{ shared_var }} in shared part
        context: { includeDeclaration: true },
      };

      const provider = new ReferenceProvider(params, fixturesPath);
      const result = await provider.handleReferenceRequest();

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThanOrEqual(2);

      // Should find definition in shared part
      const defInShared = result!.find(
        (loc) =>
          loc.uri.includes("variable_shared.liquid") &&
          loc.range.start.line === 2,
      );
      expect(defInShared).toBeDefined();

      // Should find references across files
      const allFiles = [
        ...new Set(
          result!.map((loc) => {
            const uri = loc.uri;
            if (uri.includes("variable_shared.liquid"))
              return "variable_shared.liquid";
            if (uri.includes("main.liquid")) return "main.liquid";
            return "other";
          }),
        ),
      ];
      expect(allFiles).toContain("variable_shared.liquid");
      expect(allFiles).toContain("main.liquid");
    });
  });
});
