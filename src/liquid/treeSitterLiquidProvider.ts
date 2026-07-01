import * as Parser from "tree-sitter";
import * as LiquidTreeSitter from "tree-sitter-liquid";

// Re-export commonly used tree-sitter types
export type { SyntaxNode, Tree, Point, QueryMatch } from "tree-sitter";
export type TreeSitterParser = Parser;

export interface DigitSub {
  index: number;
  digit: string;
}

/**
 * The tree-sitter-liquid grammar (v0.7.0) requires identifiers to START with a
 * letter, so member keys like `period.reconciliations.2018_tax_module` (and even
 * `_275_x`) parse as a `number` + ERROR and break the access chain. We work around
 * it by replacing the LEADING digit of such a member key with a letter BEFORE
 * parsing — a SAME-LENGTH swap, so every source position is preserved (and a letter,
 * not `_`, because the grammar also rejects `_`-then-digit). The original digit is
 * restored when a node's textual value is read (see `restoreNodeText`). Once the key
 * starts with a letter, mid-identifier digit runs (`..._275_...`) parse fine.
 * No grammar change required.
 */
export function sanitizeDigitLeadingIdentifiers(text: string): {
  text: string;
  subs: DigitSub[];
} {
  const subs: DigitSub[] = [];
  // `.` then a digit that begins a member key containing a letter/underscore
  // (a real identifier, not a numeric literal or index).
  const re = /\.(\d)(?=[0-9_]*[a-zA-Z_])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    subs.push({ index: match.index + 1, digit: match[1] });
  }
  if (subs.length === 0) {
    return { text, subs };
  }
  // Replace each leading digit with a letter (not `_`) so the whole key parses as a
  // single letter-led identifier; the original digit is restored on read by offset.
  const chars = text.split("");
  for (const sub of subs) {
    chars[sub.index] = "q";
  }
  return { text: chars.join(""), subs };
}

/**
 * Provides tree-sitter parsing for Liquid templates.
 *
 * Note: This class CANNOT be a singleton. Tree-sitter Parser instances are not thread-safe
 * and cannot be used concurrently. Each class that needs parsing should create its own instance.
 */
export class TreeSitterLiquidProvider {
  private parser: Parser;
  private language: Parser.Language;
  private isInitialized = false;
  private subsByTree = new WeakMap<Parser.Tree, DigitSub[]>();

  constructor() {
    try {
      this.parser = new Parser();
      this.language = LiquidTreeSitter as Parser.Language;
      this.parser.setLanguage(this.language);
      this.isInitialized = true;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Parse liquid template text into a syntax tree.
   *
   * @param text The liquid template text to parse
   * @returns The parsed syntax tree, or null if parsing fails
   */
  public parseTree(text: string): Parser.Tree | null {
    if (!this.isInitialized) {
      return null;
    }
    const { text: sanitized, subs } = sanitizeDigitLeadingIdentifiers(text);
    const tree = this.parser.parse(sanitized);
    if (subs.length > 0) {
      this.subsByTree.set(tree, subs);
    }
    return tree;
  }

  /**
   * The source text of a node with any digit-leading identifiers restored.
   * Use this instead of `node.text` when the textual value matters (handle names,
   * custom keys, ...), so the digit-leading workaround is transparent.
   */
  public restoreNodeText(node: Parser.SyntaxNode): string {
    const subs = this.subsByTree.get(node.tree);
    if (!subs || subs.length === 0) {
      return node.text;
    }
    let text = node.text;
    for (const sub of subs) {
      const rel = sub.index - node.startIndex;
      if (rel >= 0 && rel < text.length) {
        text = text.slice(0, rel) + sub.digit + text.slice(rel + 1);
      }
    }
    return text;
  }

  public queryTree(
    queryString: string,
    tree: Parser.Tree,
  ): Parser.QueryMatch[] {
    if (!this.isInitialized || !tree) {
      return [];
    }
    const query = new Parser.Query(this.language, queryString);

    return query.matches(tree.rootNode);
  }
}
