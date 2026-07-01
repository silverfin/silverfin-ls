import { TemplatePartsCollectionManager } from "../templates/templatePartsCollectionManager";
import {
  TreeSitterLiquidProvider,
  SyntaxNode,
} from "./treeSitterLiquidProvider";
import { URI } from "vscode-uri";
import * as fs from "fs";
import * as path from "path";

/**
 * Static DATA SCOPE extractor for a Silverfin template.
 *
 * Leverages silverfin-ls's tree-sitter parser and template-parts resolution to
 * produce the data a template reads — own customs, cross-template results/customs,
 * period drop + prior-period depth, company drop, accounts, and the result→custom
 * echoes — across main + text parts + shared parts (recursively). Alias-aware:
 * `{% assign x = period.reconciliations.foo %} … x.results.bar` resolves to
 * `period.reconciliations.foo.results.bar`.
 *
 * This is the SCOPE (what to fetch), not a guaranteed exhaustive key list — runtime
 * built references can't be resolved statically; a consumer should over-fetch within
 * this scope and self-validate.
 */

export interface DataScope {
  handle: string;
  ownCustoms: string[];
  crossTemplate: Record<string, { results: string[]; customs: string[] }>;
  periodDrop: string[];
  priorPeriodDepth: number;
  companyDrop: { standard: string[]; custom: string[] };
  accounts: string[];
  resultEchoes: Record<string, string>; // result tag -> the custom path it directly echoes
  involvedFiles: string[];
  warnings: string[];
}

interface Collected {
  accessPaths: string[]; // full dotted member-access paths
  assigns: Array<{ target: string; valuePath: string }>;
  results: Array<{ tag: string; valuePath: string }>;
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

// The full dotted path of a member-access node, with digit-leading handles restored.
function accessPath(
  node: SyntaxNode,
  provider: TreeSitterLiquidProvider,
): string {
  return provider.restoreNodeText(node).trim();
}

// One walk collecting top-level access paths, assignment targets/values, and result tag/values.
function collect(
  root: SyntaxNode,
  into: Collected,
  provider: TreeSitterLiquidProvider,
): void {
  const stack: SyntaxNode[] = [root];
  while (stack.length) {
    const node = stack.pop()!;

    if (node.type === "access") {
      // Only record the OUTERMOST access (full path); don't descend into sub-accesses.
      if (!node.parent || node.parent.type !== "access") {
        into.accessPaths.push(accessPath(node, provider));
      }
      continue;
    }

    if (node.type === "assignment_statement") {
      const target = node.namedChildren.find((c) => c.type === "identifier");
      const value = node.namedChildren.find((c) => c.type === "access");
      if (target && value) {
        into.assigns.push({
          target: provider.restoreNodeText(target).trim(),
          valuePath: accessPath(value, provider),
        });
      }
    } else if (node.type === "result_statement") {
      const tagNode = node.namedChildren.find((c) => c.type === "string");
      const value = node.namedChildren.find((c) => c.type === "access");
      if (tagNode && value) {
        into.results.push({
          tag: provider.restoreNodeText(tagNode).replace(/['"]/g, "").trim(),
          valuePath: accessPath(value, provider),
        });
      }
    }

    for (const child of node.namedChildren) stack.push(child);
  }
}

// Resolve a path whose first segment is an assign-alias to a data drop.
function resolveAlias(
  pathText: string,
  aliasMap: Record<string, string>,
): string {
  const dot = pathText.indexOf(".");
  const head = dot === -1 ? pathText : pathText.slice(0, dot);
  if (Object.prototype.hasOwnProperty.call(aliasMap, head)) {
    const rest = dot === -1 ? "" : pathText.slice(dot);
    return aliasMap[head] + rest;
  }
  return pathText;
}

export async function extractDataScope(mainPath: string): Promise<DataScope> {
  const warnings: string[] = [];
  const absMain = path.resolve(mainPath);

  // Derive the workspace root (the dir that contains reconciliation_texts/ etc.).
  const marker = absMain.indexOf(`${path.sep}reconciliation_texts${path.sep}`);
  const workspaceRoot =
    marker !== -1
      ? absMain.slice(0, marker)
      : path.dirname(path.dirname(path.dirname(absMain)));
  const handle = path.basename(path.dirname(absMain));

  // Leverage silverfin-ls's parts resolution (main + text parts + shared parts).
  const manager = TemplatePartsCollectionManager.getInstance(workspaceRoot);
  const context = await manager.getMapAndIndexFromUri(
    URI.file(absMain).toString(),
    0,
  );
  let involvedFiles: string[] = [];
  if (context && context.templateMap) {
    involvedFiles = context.templateMap.involvedFiles;
  } else {
    warnings.push(
      "Could not resolve the template parts map; falling back to main.liquid only.",
    );
    involvedFiles = [absMain];
  }

  // Parse every involved file once and collect.
  const parser = new TreeSitterLiquidProvider();
  const collected: Collected = { accessPaths: [], assigns: [], results: [] };
  let combinedText = "";
  for (const filePath of involvedFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (error) {
      warnings.push(`Could not read ${filePath}: ${String(error)}`);
      continue;
    }
    combinedText += "\n" + content;
    const tree = parser.parseTree(content);
    if (!tree) {
      warnings.push(`Failed to parse ${filePath}`);
      continue;
    }
    collect(tree.rootNode, collected, parser);
  }

  // Alias map: assign targets whose value is a data drop.
  const aliasMap: Record<string, string> = {};
  for (const { target, valuePath } of collected.assigns) {
    if (/^(period|company|custom)\b/.test(valuePath)) {
      aliasMap[target] = valuePath;
    }
  }

  const ownCustoms = new Set<string>();
  const crossTemplate: Record<
    string,
    { results: Set<string>; customs: Set<string> }
  > = {};
  const periodDrop = new Set<string>();
  let priorPeriodDepth = 0;
  const companyStandard = new Set<string>();
  const companyCustom = new Set<string>();

  const ensureCross = (h: string) => {
    if (!crossTemplate[h])
      crossTemplate[h] = { results: new Set(), customs: new Set() };
    return crossTemplate[h];
  };

  const classify = (rawPath: string) => {
    const p = resolveAlias(rawPath, aliasMap);
    let m;
    // Prior-period depth: any period.minus_Ny reference (recorded independently so
    // a cross-template ref on a prior period sets BOTH the depth and the handle).
    if ((m = p.match(/^period\.minus_(\d+)y/i))) {
      priorPeriodDepth = Math.max(priorPeriodDepth, Number(m[1]));
    }
    // Cross-template results/customs — current OR prior period, STATIC or DYNAMIC key.
    // A handle referenced only via a dynamic key (`.results.[var]`) must still be
    // registered so the whole result/custom map gets captured for it.
    const recon = p.match(
      /^period(?:\.minus_\d+y)?\.reconciliations\.([a-z0-9_]+)\.(results|custom)\b(.*)$/i,
    );
    if (recon) {
      const cross = ensureCross(recon[1]);
      const rest = recon[3] || "";
      if (recon[2].toLowerCase() === "results") {
        const tag = rest.match(/^\.([a-z0-9_]+)/i);
        if (tag) cross.results.add(tag[1]);
      } else {
        const kv = rest.match(/^\.([a-z0-9_]+)\.([a-z0-9_]+)/i);
        if (kv) cross.customs.add(`${kv[1]}.${kv[2]}`);
      }
      return;
    }
    if ((m = p.match(/^company\.custom\.([a-z0-9_]+)\.([a-z0-9_]+)/i))) {
      companyCustom.add(`${m[1]}.${m[2]}`);
    } else if ((m = p.match(/^company\.([a-z_][a-z0-9_]*)/i))) {
      if (m[1] !== "custom") companyStandard.add(m[1]);
    } else if ((m = p.match(/^period\.([a-z_][a-z0-9_]*)/i))) {
      if (
        !["reconciliations", "accounts", "custom"].includes(m[1]) &&
        !/^minus_\d+y$/.test(m[1])
      )
        periodDrop.add(m[1]);
    } else if ((m = p.match(/^custom\.([a-z0-9_]+)\.([a-z0-9_]+)/i))) {
      ownCustoms.add(`custom.${m[1]}.${m[2]}`);
    }
  };

  for (const accessPathText of collected.accessPaths) classify(accessPathText);

  // Result echoes: result tag -> the custom path it directly echoes (alias-resolved).
  const resultEchoes: Record<string, string> = {};
  for (const { tag, valuePath } of collected.results) {
    const resolved = resolveAlias(valuePath, aliasMap);
    if (/^custom\.[a-z0-9_]+\.[a-z0-9_]+/i.test(resolved)) {
      resultEchoes[tag] = resolved.split(".").slice(0, 3).join(".");
    }
  }

  // Accounts referenced directly (#number) — text-level (no dedicated access node).
  const accounts = uniq(combinedText.match(/#\d{3,}/g) || []);

  const crossOut: DataScope["crossTemplate"] = {};
  for (const h of Object.keys(crossTemplate)) {
    // The template's own results (e.g. read via rollforward) aren't a separate dependency.
    if (h === handle) continue;
    crossOut[h] = {
      results: [...crossTemplate[h].results],
      customs: [...crossTemplate[h].customs],
    };
  }

  return {
    handle,
    ownCustoms: [...ownCustoms],
    crossTemplate: crossOut,
    periodDrop: [...periodDrop],
    priorPeriodDepth,
    companyDrop: { standard: [...companyStandard], custom: [...companyCustom] },
    accounts,
    resultEchoes,
    involvedFiles,
    warnings,
  };
}
