import { Logger } from "../logger";
import {
  TreeSitterLiquidProvider,
  SyntaxNode,
  Tree,
} from "./treeSitterLiquidProvider";
import * as fs from "fs";
import { TemplatePartSection, TemplateMap } from "../templates/types";

export interface NodeInTemplate {
  node: SyntaxNode;
  partSection: TemplatePartSection;
  executionIndex: number;
}

interface ParsedFile {
  tree: Tree;
  content: string;
}

interface NodeWithFile {
  node: SyntaxNode;
  filePath: string;
}

/**
 * Service responsible for parsing and querying template files using tree-sitter.
 * Optimizes performance by parsing each unique file once, then mapping results to sections.
 */
export class TemplateQueryService {
  private logger = new Logger("TemplateQueryService");
  private parser = new TreeSitterLiquidProvider();

  /**
   * Parse all involved files once and cache the results.
   * This is the key optimization: parse 20 files instead of 222 sections.
   */
  private parseFiles(involvedFiles: string[]): Map<string, ParsedFile> {
    const startTime = Date.now();
    const cache = new Map<string, ParsedFile>();

    for (const filePath of involvedFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const tree = this.parser.parseTree(content);

        if (tree) {
          cache.set(filePath, { tree, content });
        } else {
          this.logger.warn(`Failed to parse file: ${filePath}`);
        }
      } catch (error) {
        this.logger.warn(`Could not read file: ${filePath}, ${error}`);
      }
    }

    const duration = Date.now() - startTime;
    this.logger.debug(
      `Parsed ${cache.size} unique files in ${duration}ms`,
    );
    return cache;
  }

  /**
   * Query all parsed files for nodes matching the given key and types.
   * Returns all matching nodes with their file paths.
   */
  private queryAllFiles(
    parsedFiles: Map<string, ParsedFile>,
    liquidKey: string,
    liquidTypes: string[],
  ): NodeWithFile[] {
    const allNodes: NodeWithFile[] = [];
    const keyKey = "key";

    for (const [filePath, { tree }] of parsedFiles.entries()) {
      try {
        for (const liquidType of liquidTypes) {
          const queryString = `(${liquidType}
            ${keyKey}: (string) @${keyKey}
          )`;

          const matches = this.parser.queryTree(queryString, tree);

          for (const match of matches) {
            for (const capture of match.captures) {
              if (capture.name === "key") {
                const captureKey = this.extractKey(capture.node);
                if (captureKey && captureKey === liquidKey) {
                  let parent = capture.node.parent;
                  while (parent && parent.type !== liquidType) {
                    parent = parent.parent;
                  }
                  if (parent) {
                    allNodes.push({ node: parent, filePath });
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Error querying file ${filePath} for types [${liquidTypes.join(", ")}]: ${error}`,
        );
      }
    }

    return allNodes;
  }

  /**
   * Extract string key from a string node (removes quotes).
   */
  private extractKey(stringNode: SyntaxNode): string | null {
    if (stringNode.type !== "string") {
      this.logger.warn(`Expected string node, got ${stringNode.type}`);
      return null;
    }
    const text = stringNode.text.trim();
    if (!text) {
      return null;
    }
    return text.replace(/^['"]|['"]$/g, "");
  }

  /**
   * Map nodes with file paths to their corresponding part sections.
   * Filters nodes to only include those within the specified section range.
   */
  private mapNodesToSections(
    nodesWithFile: NodeWithFile[],
    partSections: TemplatePartSection[],
    upToSectionIndex: number,
    currentRow?: number,
  ): NodeInTemplate[] {
    const result: NodeInTemplate[] = [];

    for (let i = 0; i <= upToSectionIndex; i++) {
      const section = partSections[i];

      for (const nodeWithFile of nodesWithFile) {
        // Check if node belongs to this section
        if (
          nodeWithFile.filePath === section.fileFullPath &&
          nodeWithFile.node.startPosition.row >= section.startLine &&
          nodeWithFile.node.endPosition.row <= section.endLine
        ) {
          // If we're in the current section, filter by current row
          if (i === upToSectionIndex && currentRow !== undefined) {
            if (nodeWithFile.node.startPosition.row < currentRow) {
              result.push({
                node: nodeWithFile.node,
                partSection: section,
                executionIndex: i,
              });
            }
          } else {
            result.push({
              node: nodeWithFile.node,
              partSection: section,
              executionIndex: i,
            });
          }
        }
      }
    }

    return result;
  }

  /**
   * Query for nodes before a specific position in the template.
   * Optimized: parses each unique file once, then maps to sections.
   */
  public queryNodesBeforePosition(
    templateMap: TemplateMap,
    currentSectionIndex: number,
    liquidKey: string,
    liquidTypes: string[],
    currentRow?: number,
  ): NodeInTemplate[] {
    this.logger.debug(
      `Querying nodes before position: key="${liquidKey}", types=[${liquidTypes.join(", ")}]`,
    );

    // Step 1: Parse all involved files once (20 files)
    const parsedFiles = this.parseFiles(templateMap.involvedFiles);

    // Step 2: Query all files for matching nodes
    const nodesWithFile = this.queryAllFiles(
      parsedFiles,
      liquidKey,
      liquidTypes,
    );

    // Step 3: Map nodes to sections and filter by position
    const result = this.mapNodesToSections(
      nodesWithFile,
      templateMap.partSections,
      currentSectionIndex,
      currentRow,
    );

    this.logger.debug(
      `Found ${result.length} nodes (parsed ${parsedFiles.size} files instead of ${currentSectionIndex + 1} sections)`,
    );

    return result;
  }

  /**
   * Query for variable definitions in all files.
   * Returns all matching variable definition nodes with metadata.
   */
  public queryVariableDefinitionsInAllFiles(
    parsedFiles: Map<string, ParsedFile>,
    variableName: string,
  ): NodeWithFile[] {
    const allNodes: NodeWithFile[] = [];

    const statementConfigs = [
      {
        type: "assignment_statement",
        field: "variable_name",
        supportsDeferred: true,
      },
      { type: "capture_statement", field: "variable", supportsDeferred: true },
      { type: "for_loop_statement", field: "item", supportsDeferred: false },
    ];

    for (const [filePath, { tree }] of parsedFiles.entries()) {
      try {
        for (const config of statementConfigs) {
          // Query for identifiers
          const identifierQueryString = `(${config.type}
            ${config.field}: (identifier) @var_name
          )`;

          let matches = this.parser.queryTree(identifierQueryString, tree);

          // Also query for deferred variables if supported
          if (config.supportsDeferred) {
            const deferredQueryString = `(${config.type}
              ${config.field}: (deferred_variable
                key: (identifier) @var_name
              )
            )`;

            const deferredMatches = this.parser.queryTree(
              deferredQueryString,
              tree,
            );
            matches = [...matches, ...deferredMatches];
          }

          for (const match of matches) {
            for (const capture of match.captures) {
              if (capture.name === "var_name") {
                const capturedName = capture.node.text;
                if (capturedName === variableName) {
                  const immediateParent = capture.node.parent;
                  const isDeferredVariable =
                    immediateParent &&
                    immediateParent.type === "deferred_variable";

                  if (isDeferredVariable) {
                    allNodes.push({ node: immediateParent, filePath });
                  } else {
                    let parent = capture.node.parent;
                    while (parent && parent.type !== config.type) {
                      parent = parent.parent;
                    }
                    if (parent) {
                      // Find the keyword node for better positioning
                      let keywordNode: SyntaxNode | null = null;
                      for (let i = 0; i < parent.childCount; i++) {
                        const child = parent.child(i);
                        if (
                          child &&
                          (child.type === "assign" ||
                            child.type === "capture" ||
                            child.type === "for")
                        ) {
                          keywordNode = child;
                          break;
                        }
                      }
                      allNodes.push({
                        node: keywordNode || parent,
                        filePath,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Error querying variable definitions in ${filePath}: ${error}`,
        );
      }
    }

    return allNodes;
  }

  /**
   * Query for variable definitions before a specific position.
   */
  public queryVariableDefinitionsBeforePosition(
    templateMap: TemplateMap,
    currentSectionIndex: number,
    variableName: string,
    currentRow?: number,
  ): NodeInTemplate[] {
    this.logger.debug(
      `Querying variable definitions before position: variable="${variableName}"`,
    );

    // Step 1: Parse all involved files once
    const parsedFiles = this.parseFiles(templateMap.involvedFiles);

    // Step 2: Query all files for variable definitions
    const nodesWithFile = this.queryVariableDefinitionsInAllFiles(
      parsedFiles,
      variableName,
    );

    // Step 3: Map nodes to sections and filter by position
    const result = this.mapNodesToSections(
      nodesWithFile,
      templateMap.partSections,
      currentSectionIndex,
      currentRow,
    );

    this.logger.debug(
      `Found ${result.length} variable definitions (parsed ${parsedFiles.size} files instead of ${currentSectionIndex + 1} sections)`,
    );

    return result;
  }

  /**
   * Query for variable references in all files.
   */
  public queryVariableReferencesInAllFiles(
    parsedFiles: Map<string, ParsedFile>,
    variableName: string,
  ): NodeWithFile[] {
    const allNodes: NodeWithFile[] = [];

    for (const [filePath, { tree }] of parsedFiles.entries()) {
      try {
        const queryString = "(identifier) @var";
        const matches = this.parser.queryTree(queryString, tree);

        for (const match of matches) {
          for (const capture of match.captures) {
            if (
              capture.name === "var" &&
              capture.node.text === variableName &&
              this.isVariableReference(capture.node)
            ) {
              allNodes.push({ node: capture.node, filePath });
            }
          }
        }
      } catch (error) {
        this.logger.error(
          `Error querying variable references in ${filePath}: ${error}`,
        );
      }
    }

    return allNodes;
  }

  /**
   * Determines if an identifier node is a variable reference (not a definition).
   */
  private isVariableReference(identifierNode: SyntaxNode): boolean {
    if (identifierNode.type !== "identifier") {
      return false;
    }

    const parent = identifierNode.parent;
    if (!parent) {
      return false;
    }

    let fieldName: string | null = null;
    for (let i = 0; i < parent.childCount; i++) {
      if (parent.child(i) === identifierNode) {
        fieldName = parent.fieldNameForChild(i);
        break;
      }
    }

    switch (parent.type) {
      case "program":
      case "block":
        return true;

      case "assignment_statement":
        return fieldName === "value";

      case "capture_statement":
        return false;

      case "for_loop_statement":
        return fieldName === "iterator";

      case "if_statement":
      case "unless_statement":
      case "elsif_clause":
        return fieldName === "condition";

      case "push_statement":
      case "pop_statement":
        return fieldName === "array" || fieldName === "item";

      case "filter":
        return fieldName === "body";

      case "argument_list":
        return true;

      case "predicate":
        return fieldName === "left" || fieldName === "right";

      case "translation_expression":
        return fieldName === "key";

      case "deferred_variable":
        return fieldName === "key";

      default:
        return false;
    }
  }

  /**
   * Query for all variable references across the entire template.
   */
  public queryAllVariableReferences(
    templateMap: TemplateMap,
    variableName: string,
  ): NodeInTemplate[] {
    this.logger.debug(
      `Querying all variable references: variable="${variableName}"`,
    );

    // Step 1: Parse all involved files once
    const parsedFiles = this.parseFiles(templateMap.involvedFiles);

    // Step 2: Query all files for variable references
    const nodesWithFile = this.queryVariableReferencesInAllFiles(
      parsedFiles,
      variableName,
    );

    // Step 3: Map nodes to ALL sections (no position filter)
    const result: NodeInTemplate[] = [];
    for (let i = 0; i < templateMap.partSections.length; i++) {
      const section = templateMap.partSections[i];

      for (const nodeWithFile of nodesWithFile) {
        if (
          nodeWithFile.filePath === section.fileFullPath &&
          nodeWithFile.node.startPosition.row >= section.startLine &&
          nodeWithFile.node.endPosition.row <= section.endLine
        ) {
          result.push({
            node: nodeWithFile.node,
            partSection: section,
            executionIndex: i,
          });
        }
      }
    }

    this.logger.debug(
      `Found ${result.length} variable references (parsed ${parsedFiles.size} files instead of ${templateMap.partSections.length} sections)`,
    );

    return result;
  }

  /**
   * Query for all translation references across the entire template.
   */
  public queryAllTranslationReferences(
    templateMap: TemplateMap,
    translationKey: string,
  ): NodeInTemplate[] {
    this.logger.debug(
      `Querying all translation references: key="${translationKey}"`,
    );

    // Step 1: Parse all involved files once
    const parsedFiles = this.parseFiles(templateMap.involvedFiles);

    // Step 2: Query all files for translation expressions
    const nodesWithFile = this.queryAllFiles(parsedFiles, translationKey, [
      "translation_expression",
    ]);

    // Step 3: Map nodes to ALL sections (no position filter)
    const result: NodeInTemplate[] = [];
    for (let i = 0; i < templateMap.partSections.length; i++) {
      const section = templateMap.partSections[i];

      for (const nodeWithFile of nodesWithFile) {
        if (
          nodeWithFile.filePath === section.fileFullPath &&
          nodeWithFile.node.startPosition.row >= section.startLine &&
          nodeWithFile.node.endPosition.row <= section.endLine
        ) {
          result.push({
            node: nodeWithFile.node,
            partSection: section,
            executionIndex: i,
          });
        }
      }
    }

    this.logger.debug(
      `Found ${result.length} translation references (parsed ${parsedFiles.size} files instead of ${templateMap.partSections.length} sections)`,
    );

    return result;
  }
}
