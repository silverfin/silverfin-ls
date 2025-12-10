import { Logger } from "../logger";
import {
  TreeSitterLiquidProvider,
  SyntaxNode,
} from "./treeSitterLiquidProvider";
import * as fs from "fs";
import { TemplatePartsCollectionManager } from "../templates/templatePartsCollectionManager";
import {
  TemplatePartSection,
  TemplateMap,
  TemplateMapContext,
} from "../templates/types";
import { TemplateQueryService, NodeInTemplate } from "./templateQueryService";

export { NodeInTemplate };

/**
 * High-level service for finding liquid tags, variables, and translations in templates.
 * Uses TemplateQueryService for optimized tree-sitter parsing and querying.
 * Handles complex logic like variable scoping and loop shadowing.
 */
export class LiquidTagFinder {
  private logger = new Logger("LiquidTagFinder");
  private parser = new TreeSitterLiquidProvider();
  private queryService = new TemplateQueryService();

  /**
   * Get and validate template map for the given URI and row.
   * Throws descriptive errors if validation fails.
   */
  private async getValidatedTemplateMap(
    textDocumentUri: string,
    currentRow: number,
    workspaceRoot: string,
  ): Promise<TemplateMapContext> {
    const templateManager =
      TemplatePartsCollectionManager.getInstance(workspaceRoot);
    const templateContext = await templateManager.getMapAndIndexFromUri(
      textDocumentUri,
      currentRow,
    );

    if (!templateContext) {
      throw new Error(
        `No template map found for URI: ${textDocumentUri}. ` +
          "The file may not be part of a recognized template or the template structure could not be determined.",
      );
    }

    const { templateMap, currentFileIndex } = templateContext;

    if (!templateMap.partSections || templateMap.partSections.length === 0) {
      throw new Error(
        `Template map is empty for URI: ${textDocumentUri}. ` +
          "Cannot process template without part sections.",
      );
    }

    if (
      currentFileIndex === -1 ||
      currentFileIndex >= templateMap.partSections.length
    ) {
      throw new Error(
        `Invalid current file index (${currentFileIndex}) for URI: ${textDocumentUri}. ` +
          `Template has ${templateMap.partSections.length} part sections.`,
      );
    }

    this.logger.info(
      `Template map loaded: ${templateMap.partSections.length} part sections, ${templateMap.involvedFiles.length} unique files, current file at index ${currentFileIndex}`,
    );

    return templateContext;
  }

  /**
   * Safely read file content with error handling.
   * Used for loop context checking which needs file content.
   */
  private readFileContent(filePath: string): string | null {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (error) {
      this.logger.warn(`Could not read file: ${filePath}, ${error}`);
      return null;
    }
  }

  /**
   * Find all nodes of specific types before a position.
   * Uses optimized query service (parses 20 files instead of 222 sections).
   * @returns Array of matching nodes, or empty array if error occurs
   */
  public async findAllNodesBeforePosition(
    textDocumentUri: string,
    currentRow: number,
    liquidKey: string,
    liquidTypes: string[],
    workspaceRoot: string,
  ): Promise<NodeInTemplate[]> {
    try {
      const { templateMap, currentFileIndex } =
        await this.getValidatedTemplateMap(
          textDocumentUri,
          currentRow,
          workspaceRoot,
        );

      return this.queryService.queryNodesBeforePosition(
        templateMap,
        currentFileIndex,
        liquidKey,
        liquidTypes,
        currentRow,
      );
    } catch (error) {
      this.logger.error(`findAllNodesBeforePosition failed: ${error}`);
      return [];
    }
  }

  /**
   * Find all variable definitions before a position.
   * Handles loop variable scoping (loop variables shadow outer variables).
   * @returns Array of matching nodes, or empty array if error occurs
   */
  public async findAllVariableDefinitionsBeforePosition(
    textDocumentUri: string,
    currentRow: number,
    variableName: string,
    workspaceRoot: string,
  ): Promise<NodeInTemplate[]> {
    try {
      const { templateMap, currentFileIndex } =
        await this.getValidatedTemplateMap(
          textDocumentUri,
          currentRow,
          workspaceRoot,
        );

      const allDefinitions =
        this.queryService.queryVariableDefinitionsBeforePosition(
          templateMap,
          currentFileIndex,
          variableName,
          currentRow,
        );

      // Handle loop variable scoping in current file
      const currentSection = templateMap.partSections[currentFileIndex];
      if (!currentSection) {
        this.logger.error(
          `Invalid section index: ${currentFileIndex} for template with ${templateMap.partSections.length} sections`,
        );
        return allDefinitions;
      }

      const definitionsInCurrentSection = allDefinitions.filter(
        (def) => def.executionIndex === currentFileIndex,
      );

      if (definitionsInCurrentSection.length > 0) {
        const fileContent = this.readFileContent(currentSection.fileFullPath);
        if (fileContent) {
          return this.filterDefinitionsForCurrentFile(
            definitionsInCurrentSection.map((d) => d.node),
            currentRow,
            currentSection,
            allDefinitions.filter(
              (def) => def.executionIndex < currentFileIndex,
            ),
          );
        }
      }

      return allDefinitions;
    } catch (error) {
      this.logger.error(
        `findAllVariableDefinitionsBeforePosition failed: ${error}`,
      );
      return [];
    }
  }

  /**
   * Filter definitions in the current file, handling loop scoping.
   * Loop variables shadow outer variables with the same name.
   */
  private filterDefinitionsForCurrentFile(
    nodesInCurrentSection: SyntaxNode[],
    currentRow: number,
    currentSection: TemplatePartSection,
    previousDefinitions: NodeInTemplate[],
  ): NodeInTemplate[] {
    const beforeCurrentRow = nodesInCurrentSection.filter(
      (node) => node.startPosition.row < currentRow,
    );

    // Check if any loop iterator is in scope
    let loopIteratorInScope: SyntaxNode | null = null;
    for (const node of beforeCurrentRow) {
      if (this.isForLoopIterator(node)) {
        const loopParent = this.findForLoopParent(node);
        if (loopParent && this.isPositionInLoopScope(currentRow, loopParent)) {
          loopIteratorInScope = node;
          break;
        }
      }
    }

    // If a loop iterator is in scope, return only that (it shadows outer variables)
    if (loopIteratorInScope) {
      return [
        {
          node: loopIteratorInScope,
          partSection: currentSection,
          executionIndex: previousDefinitions.length,
        },
      ];
    }

    // Filter out loop iterators that are not in scope
    const filteredCurrentSection = beforeCurrentRow.filter((node) => {
      if (this.isForLoopIterator(node)) {
        const loopParent = this.findForLoopParent(node);
        return loopParent && this.isPositionInLoopScope(currentRow, loopParent);
      }
      return true;
    });

    // Combine with previous definitions
    const result = [...previousDefinitions];
    filteredCurrentSection.forEach((node) => {
      result.push({
        node,
        partSection: currentSection,
        executionIndex: previousDefinitions.length,
      });
    });

    return result;
  }

  /**
   * Checks if a node is a for loop iterator variable definition.
   */
  private isForLoopIterator(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    while (current) {
      if (current.type === "for_loop_statement") {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  /**
   * Finds the for_loop_statement parent node for a given node.
   */
  private findForLoopParent(node: SyntaxNode): SyntaxNode | null {
    let current: SyntaxNode | null = node;
    while (current) {
      if (current.type === "for_loop_statement") {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  /**
   * Checks if a position is within the scope of a for loop.
   */
  private isPositionInLoopScope(
    position: number,
    loopNode: SyntaxNode,
  ): boolean {
    const loopStart = loopNode.startPosition.row;
    const loopEnd = loopNode.endPosition.row;
    return position >= loopStart && position <= loopEnd;
  }

  /**
   * Find all variable references across the entire template.
   * Handles loop variable scoping - loop variables are scoped to their loop.
   * @returns Array of matching nodes, or empty array if error occurs
   */
  public async findAllVariableReferencesInScope(
    textDocumentUri: string,
    currentRow: number,
    variableName: string,
    workspaceRoot: string,
  ): Promise<NodeInTemplate[]> {
    try {
      const { templateMap, currentFileIndex } =
        await this.getValidatedTemplateMap(
          textDocumentUri,
          currentRow,
          workspaceRoot,
        );

      const currentPartSection = templateMap.partSections[currentFileIndex];
      if (!currentPartSection) {
        this.logger.error(
          `Invalid section index: ${currentFileIndex} for template with ${templateMap.partSections.length} sections`,
        );
        return [];
      }

      this.logger.info(
        `Searching for references in ${templateMap.partSections.length} part sections (current: ${currentPartSection.fileFullPath})`,
      );

      const currentFileContent = this.readFileContent(
        currentPartSection.fileFullPath,
      );
      if (!currentFileContent) {
        return [];
      }

      // Check if we're inside a loop with a loop variable that matches
      const currentLoopContext = this.findLoopContext(
        currentFileContent,
        currentRow,
        variableName,
      );

      // If in a loop scope with this variable, only find references in that loop
      if (currentLoopContext) {
        return this.findLoopScopedReferences(
          templateMap,
          currentFileIndex,
          currentLoopContext,
          variableName,
        );
      }

      // Otherwise, find all references across template, excluding shadowed loop variables
      return this.findGlobalScopedReferences(templateMap, variableName);
    } catch (error) {
      this.logger.error(`findAllVariableReferencesInScope failed: ${error}`);
      return [];
    }
  }

  /**
   * Find references within a specific loop scope.
   */
  private findLoopScopedReferences(
    templateMap: TemplateMap,
    executionIndex: number,
    loopNode: SyntaxNode,
    variableName: string,
  ): NodeInTemplate[] {
    const matchingNodes: NodeInTemplate[] = [];

    // Query all references from the service
    const allReferences = this.queryService.queryAllVariableReferences(
      templateMap,
      variableName,
    );

    // Filter to only those in the current section and within loop scope
    for (const ref of allReferences) {
      if (
        ref.executionIndex === executionIndex &&
        this.isPositionInLoopScope(ref.node.startPosition.row, loopNode)
      ) {
        matchingNodes.push(ref);
      }
    }

    this.logger.debug(
      `Found ${matchingNodes.length} references for loop variable: ${variableName}`,
    );
    return matchingNodes;
  }

  /**
   * Find references in global scope, excluding shadowed loop variables.
   * Uses query service for optimized parsing.
   */
  private findGlobalScopedReferences(
    templateMap: TemplateMap,
    variableName: string,
  ): NodeInTemplate[] {
    // Get all references from the service (optimized: parses each file once)
    const allReferences = this.queryService.queryAllVariableReferences(
      templateMap,
      variableName,
    );

    // Filter out references inside loops that shadow this variable
    const result: NodeInTemplate[] = [];

    for (const ref of allReferences) {
      const partSection = ref.partSection;
      const fileContent = this.readFileContent(partSection.fileFullPath);

      if (!fileContent) {
        continue;
      }

      const loopContext = this.findLoopContext(
        fileContent,
        ref.node.startPosition.row,
        variableName,
      );

      // Only include if not in a shadowing loop
      if (!loopContext) {
        result.push(ref);
      }
    }

    this.logger.debug(
      `Found ${result.length} references for variable: ${variableName} across ${templateMap.partSections.length} part sections`,
    );
    return result;
  }

  /**
   * Find if the current position is inside a for loop that defines a variable with the given name.
   */
  private findLoopContext(
    text: string,
    position: number,
    variableName: string,
  ): SyntaxNode | null {
    const tree = this.parser.parseTree(text);
    if (!tree) {
      return null;
    }

    try {
      const queryString = "(for_loop_statement) @loop";
      const matches = this.parser.queryTree(queryString, tree);

      for (const match of matches) {
        for (const capture of match.captures) {
          if (capture.name === "loop") {
            const loopNode = capture.node;

            // Check if position is inside this loop
            if (this.isPositionInLoopScope(position, loopNode)) {
              // Check if this loop defines the variable
              const itemField = loopNode.childForFieldName("item");
              if (itemField && itemField.text === variableName) {
                return loopNode;
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(`Error finding loop context: ${error}`);
    }

    return null;
  }

  /**
   * Find all translation references across the entire template.
   * Uses query service for optimized parsing.
   * @returns Array of matching nodes, or empty array if error occurs
   */
  public async findAllTranslationReferences(
    textDocumentUri: string,
    currentRow: number,
    translationKey: string,
    workspaceRoot: string,
  ): Promise<NodeInTemplate[]> {
    try {
      const { templateMap } = await this.getValidatedTemplateMap(
        textDocumentUri,
        currentRow,
        workspaceRoot,
      );

      return this.queryService.queryAllTranslationReferences(
        templateMap,
        translationKey,
      );
    } catch (error) {
      this.logger.error(`findAllTranslationReferences failed: ${error}`);
      return [];
    }
  }
}
