import { HoverProvider } from "../../src/lspCapabilities/hoverProvider";
import { HoverParams } from "vscode-languageserver/node";
import { URI } from "vscode-uri";
import * as path from "path";

describe("HoverProvider - Translation Tag Hover", () => {
  const fixturesPath = path.resolve(__dirname, "../../fixtures/market-repo");
  const mainFilePath = path.join(
    fixturesPath,
    "reconciliation_texts/translation_test/main.liquid",
  );
  const textPartPath = path.join(
    fixturesPath,
    "reconciliation_texts/translation_test/text_parts/translations_def.liquid",
  );

  describe("Translation Tag - Definition in Same File", () => {
    it("should show translation info when hovering over translation usage", async () => {
      // Line 2: {% t= "key_from_main" default:"Main Translation" es:"Traducción Principal" %}
      // Line 6: {% t "key_from_main" %} - usage
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 6, character: 7 }, // Cursor on "key_from_main"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).not.toBeNull();
      expect(result).toContain("Translation: key_from_main");
      expect(result).toContain("default");
      expect(result).toContain("Main Translation");
      expect(result).toContain("es");
      expect(result).toContain("Traducción Principal");
    });
  });

  describe("Translation Tag - Definition in Text Part", () => {
    it("should show translation info from text part when hovering in main", async () => {
      // Text part - defined
      // Main part - called - Line 7: {% t "key_from_text_part" %}
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 7, character: 7 }, // Cursor on "key_from_text_part"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).not.toBeNull();
      expect(result).toContain("Translation: key_from_text_part");
      expect(result).toContain("default");
      expect(result).toContain("Text Part Translation");
      expect(result).toContain("nl");
      expect(result).toContain("Tekst Deel Vertaling");
    });
  });

  describe("Translation Tag - Definition in Shared Part", () => {
    it("should show translation info from shared part when hovering in main", async () => {
      // Shared part - defined
      // Main part - called - Line 8: {% t "key_from_shared" %}
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 8, character: 7 }, // Cursor on "key_from_shared"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).not.toBeNull();
      expect(result).toContain("Translation: key_from_shared");
      expect(result).toContain("default");
      expect(result).toContain("Shared Translation");
      expect(result).toContain("nl");
      expect(result).toContain("Gedeelde Vertaling");
    });

    it("should show translation info from shared part when hovering in text part", async () => {
      // Shared part - defined
      // Text part - called - Line 6: {% t "key_from_shared" %}
      const params: HoverParams = {
        textDocument: { uri: URI.file(textPartPath).toString() },
        position: { line: 6, character: 7 }, // Cursor on "key_from_shared"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).not.toBeNull();
      expect(result).toContain("Translation: key_from_shared");
      expect(result).toContain("Shared Translation");
    });
  });

  describe("Translation Tag - Multiple Locales", () => {
    it("should display all locale translations in the hover", async () => {
      // Hover over a key with multiple locale translations
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 6, character: 7 }, // "key_from_main" has default and es
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).not.toBeNull();
      const defaultIndex = result!.indexOf("default");
      const esIndex = result!.indexOf("es");
      // Should show default first, then es
      expect(defaultIndex).toBeLessThan(esIndex);
    });
  });

  describe("Translation Tag - Undefined Keys", () => {
    it("should return null for undefined translation keys", async () => {
      // Line 9: {% t "undefined_key" %} - no definition exists
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 9, character: 7 }, // Cursor on "undefined_key"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).toBeNull();
    });

    it("should return null for keys defined after usage (scope rule)", async () => {
      // Line 10: {% t "key_defined_after" %} - definition is after usage
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 10, character: 7 }, // Cursor on "key_defined_after"
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).toBeNull();
    });
  });

  describe("Translation Tag - Edge Cases", () => {
    it("should return null when cursor is not on a translation tag", async () => {
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 0, character: 5 }, // Position on comment
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      expect(result).toBeNull();
    });

    it("should return null when cursor is on include tag", async () => {
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 4, character: 15 }, // Position on include tag
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      // Should return null because hover is not implemented for include tags
      expect(result).toBeNull();
    });
  });

  describe("Translation Tag - Hover on Definition", () => {
    it("should return null when hovering over the definition itself (not an expression)", async () => {
      // Line 2: {% t= "key_from_main" default:"Main Translation" es:"Traducción Principal" %}
      const params: HoverParams = {
        textDocument: { uri: URI.file(mainFilePath).toString() },
        position: { line: 2, character: 10 }, // Cursor on key in definition
      };

      const provider = new HoverProvider(params, fixturesPath);
      const result = await provider.handleHoverRequest();

      // Hovering on a definition (translation_statement) is not supported
      // Only hovering on usage (translation_expression) is supported
      expect(result).toBeNull();
    });
  });
});
