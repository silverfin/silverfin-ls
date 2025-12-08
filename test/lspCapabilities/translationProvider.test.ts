import { TranslationProvider } from "../../src/lspCapabilities/translationProvider";
import * as Parser from "tree-sitter";
import * as LiquidTreeSitter from "tree-sitter-liquid";

describe("TranslationProvider - Translation Info Extraction", () => {
  let provider: TranslationProvider;
  let parser: Parser;
  let language: Parser.Language;

  beforeEach(() => {
    provider = new TranslationProvider();
    parser = new Parser();
    language = LiquidTreeSitter as Parser.Language;
    parser.setLanguage(language);
  });

  // Helper function to get the translation_statement node from liquid code
  const getTranslationNode = (liquidCode: string): Parser.SyntaxNode | null => {
    const tree = parser.parse(liquidCode);
    // Find the translation_statement node in the tree
    for (let i = 0; i < tree.rootNode.childCount; i++) {
      const child = tree.rootNode.child(i);
      if (child && child.type === 'translation_statement') {
        return child;
      }
    }
    return null;
  };

  describe("extractInfo - Basic Translation", () => {
    it("should extract translation key and default locale", () => {
      const liquidCode = "{% t= 'test_key' default:'Test Translation' %}";
      const translationNode = getTranslationNode(liquidCode);

      expect(translationNode).not.toBeNull();
      expect(translationNode!.type).toBe("translation_statement");

      const result = provider.extractInfo(translationNode!);

      expect(result).toContain("Translation: test_key");
      expect(result).toContain("default");
      expect(result).toContain("Test Translation");
    });

    it("should extract translation with multiple locales", () => {
      const liquidCode =
        "{% t= 'multi_key' default:'English' nl:'Nederlands' fr:'Français' es:'Español' %}";
      const translationNode = getTranslationNode(liquidCode);

      expect(translationNode).not.toBeNull();
      const result = provider.extractInfo(translationNode!);

      expect(result).toContain("Translation: multi_key");
      expect(result).toContain("default");
      expect(result).toContain("English");
      expect(result).toContain("nl");
      expect(result).toContain("Nederlands");
      expect(result).toContain("fr");
      expect(result).toContain("Français");
      expect(result).toContain("es");
      expect(result).toContain("Español");
    });
  });

  describe("#extractInfo", () => {
    describe("Locale Ordering", () => {
      it("should place 'default' locale first", () => {
        const liquidCode =
          "{% t= 'order_key' nl:'Nederlands' default:'English' fr:'Français' %}";
        const translationNode = getTranslationNode(liquidCode);

        expect(translationNode).not.toBeNull();
        const result = provider.extractInfo(translationNode!);

        // default should appear before other locales
        const defaultIndex = result.indexOf("default");
        const nlIndex = result.indexOf("nl:");
        const frIndex = result.indexOf("fr:");

        expect(defaultIndex).toBeLessThan(nlIndex);
        expect(defaultIndex).toBeLessThan(frIndex);
      });

      it("should sort non-default locales alphabetically", () => {
        const liquidCode =
          "{% t= 'sort_key' default:'English' nl:'Nederlands' es:'Español' de:'Deutsch' fr:'Français' %}";
        const translationNode = getTranslationNode(liquidCode);

        expect(translationNode).not.toBeNull();
        const result = provider.extractInfo(translationNode!);

        // Extract positions of locale keys (skip default)
        const deIndex = result.indexOf("**de:**");
        const esIndex = result.indexOf("**es:**");
        const frIndex = result.indexOf("**fr:**");
        const nlIndex = result.indexOf("**nl:**");

        // Verify alphabetical order: de < es < fr < nl
        expect(deIndex).toBeLessThan(esIndex);
        expect(esIndex).toBeLessThan(frIndex);
        expect(frIndex).toBeLessThan(nlIndex);
      });
    });

    describe("formatting", () => {
      it("should format output with markdown syntax", () => {
        const liquidCode =
          "{% t= 'format_key' default:'Default Text' nl:'Nederlandse Tekst' %}";
        const translationNode = getTranslationNode(liquidCode);

        expect(translationNode).not.toBeNull();
        const result = provider.extractInfo(translationNode!);

        // Check for markdown heading
        expect(result).toContain("### Translation:");
        // Check for bold locale keys
        expect(result).toContain("**default:**");
        expect(result).toContain("**nl:**");
        // Check for quotes around values
        // eslint-disable-next-line quotes
        expect(result).toContain('"Default Text"');
        // eslint-disable-next-line quotes
        expect(result).toContain('"Nederlandse Tekst"');
      });
    });

    describe("Edge Cases", () => {
      it("should return empty string for non-translation_statement nodes", () => {
        const liquidCode = "{% t 'usage_key' %}";
        const tree = parser.parse(liquidCode);
        const expressionNode = tree.rootNode.child(1);

        // This is a translation_expression, not a translation_statement
        if (expressionNode) {
          const result = provider.extractInfo(expressionNode);
          expect(result).toBe("");
        }
      });

      it("should handle translation with only key (no locales)", () => {
        const liquidCode = "{% t= 'only_key' %}";
        const translationNode = getTranslationNode(liquidCode);

        expect(translationNode).not.toBeNull();
        const result = provider.extractInfo(translationNode!);

        expect(result).toContain("Translation: only_key");
        // Should not contain any locale declarations
        expect(result).not.toContain("default:");
        expect(result).not.toContain("nl:");
      });
    });
  });
});
