import { Logger } from "../logger";
import { TemplatePartsMapper } from "./templatePartsMapper";
import { URI } from "vscode-uri";
import { parseTemplateUri } from "../utils/templateUriParser";
import { TemplateTracker } from "./templateTracker";
import {
  TemplateTypes,
  TemplateKey,
  TemplateCollection,
  TemplateMap,
  TemplateMapContext,
} from "./types";

/**
 * Singleton class that manages a collection of template parts mappings.
 * Provides methods to load, refresh, and retrieve template parts with caching.
 * Each template is identified by a unique key in the format "templateType/templateName".
 *
 * Caching Strategy:
 * - Template maps are loaded once and cached in memory for the server lifetime
 * - Cache is shared across all LSP requests (definition, reference, hover)
 * - Cache is automatically regenerated when .liquid files are saved (via LSP onDidSave)
 * - This ensures fast subsequent requests while keeping data fresh
 *
 * @example
 * const manager = TemplatePartsCollectionManager.getInstance(workspaceRoot);
 * const templateMap = await manager.getMap('reconciliationText', 'my_template');
 * // templateMap.partSections - ordered execution sections
 * // templateMap.involvedFiles - unique files for efficient parsing
 * await manager.loadMap('accountTemplate', 'invoice_template');
 */
export class TemplatePartsCollectionManager {
  private static instance: TemplatePartsCollectionManager | null = null;
  private logger: Logger = new Logger("TemplatePartsCollectionManager");
  private loadedMaps: TemplateCollection = new Map();
  private templatePartsMapper: TemplatePartsMapper;

  private constructor(workspaceRoot: string) {
    this.templatePartsMapper = new TemplatePartsMapper(workspaceRoot);
  }

  /**
   * Gets the singleton instance of TemplatePartsCollectionManager
   * @param workspaceRoot The workspace root path (required on first call)
   * @returns The singleton instance
   */
  public static getInstance(
    workspaceRoot?: string,
  ): TemplatePartsCollectionManager {
    if (!TemplatePartsCollectionManager.instance) {
      if (!workspaceRoot) {
        throw new Error(
          "workspaceRoot is required when creating the first instance",
        );
      }
      TemplatePartsCollectionManager.instance =
        new TemplatePartsCollectionManager(workspaceRoot);
    }
    return TemplatePartsCollectionManager.instance;
  }

  /**
   * Loads or refreshes a template's map (part sections + involved files).
   * If the template already exists in the collection, it will be refreshed.
   * @param templateType The type of template to load
   * @param templateName The name of the template to load
   * @returns Promise resolving to the template map or null if loading failed
   */
  public async loadMap(
    templateType: TemplateTypes,
    templateName: string,
  ): Promise<TemplateMap | null> {
    const templateKey = this.generateTemplateKey(templateType, templateName);

    this.logger.debug(`Loading or refreshing template: ${templateKey}`);

    try {
      const templateMap = this.templatePartsMapper.generateTemplateMap(
        templateType,
        templateName,
      );

      if (templateMap) {
        this.loadedMaps.set(templateKey, templateMap);
        this.logger.debug(
          `Successfully loaded template: ${templateKey} with ${templateMap.partSections.length} part sections, ${templateMap.involvedFiles.length} unique files`,
        );
      } else {
        this.logger.warn(`Failed to load template: ${templateKey}`);
        this.loadedMaps.delete(templateKey);
      }

      return templateMap;
    } catch (error) {
      this.logger.error(`Error loading template ${templateKey}: ${error}`);
      this.loadedMaps.delete(templateKey);
      return null;
    }
  }

  /**
   * Gets a template's map (part sections + involved files).
   * If the template is not in the collection, it will be loaded automatically.
   * @param templateType The type of template to get
   * @param templateName The name of the template to get
   * @returns Promise resolving to the template map or null if not found/loadable
   */
  public async getMap(
    templateType: TemplateTypes,
    templateName: string,
  ): Promise<TemplateMap | null> {
    const templateKey = this.generateTemplateKey(templateType, templateName);

    if (this.loadedMaps.has(templateKey)) {
      const loadedMap = this.loadedMaps.get(templateKey)!;
      this.logger.debug(
        `Retrieved cached template: ${templateKey} with ${loadedMap.partSections.length} part sections`,
      );
      return loadedMap;
    }

    // Load if not in collection
    this.logger.debug(`Template not cached, loading: ${templateKey}`);
    return await this.loadMap(templateType, templateName);
  }

  /**
   * Gets a template's part sections mapping based on a document URI.
   * The URI is parsed to extract the template type and name.
   * If the template is not in the collection, it will be loaded automatically.
   * @param textDocumentUri The document URI containing template info
   * @returns Promise resolving to the template map context or null if not found/loadable
   */
  public async getMapAndIndexFromUri(
    textDocumentUri: string,
    currentLine: number,
  ): Promise<TemplateMapContext | null> {
    const templateUriInfo = parseTemplateUri(textDocumentUri);
    if (!templateUriInfo) {
      this.logger.warn(`Could not parse template URI: ${textDocumentUri}`);
      return null;
    }

    let templateType = templateUriInfo.templateType;
    let templateName = templateUriInfo.templateName;

    // If it's a shared part, use last visited template to determine context
    if (templateUriInfo.templateType === "sharedPart") {
      const tracker = TemplateTracker.getInstance();
      const lastVisited = tracker.getLastVisited();
      if (!lastVisited) {
        this.logger.warn(
          `Shared part detected but no last visited template: ${textDocumentUri}`,
        );
        return null;
      }

      this.logger.info(
        `Using last visited template context for shared part: ${lastVisited.type}/${lastVisited.handle}`,
      );

      templateType = lastVisited.type;
      templateName = lastVisited.handle;
    }

    const templateMap = await this.getMap(templateType, templateName);
    if (!templateMap) {
      this.logger.warn(
        `No template map found for URI: ${textDocumentUri} (type: ${templateType}, name: ${templateName})`,
      );
      return null;
    }

    const index = this.findCurrentFileIndex(
      templateMap.partSections,
      textDocumentUri,
      currentLine,
    );

    if (index === -1) {
      this.logger.warn(
        `Current file not found in template map: ${textDocumentUri} at line ${currentLine}`,
      );
      return null;
    }

    return {
      templateMap,
      currentFileIndex: index,
    };
  }

  /**
   * Regenerates template maps when a liquid file is saved.
   * Determines which templates are affected by the saved file and reloads them.
   * @param textDocumentUri The URI of the saved file
   */
  public async regenerateFromUri(textDocumentUri: string): Promise<void> {
    const templateUriInfo = parseTemplateUri(textDocumentUri);
    if (!templateUriInfo) {
      this.logger.debug(
        `Could not parse template URI for regeneration: ${textDocumentUri}`,
      );
      return;
    }

    // For shared parts, reload all cached templates (they all might use it)
    if (templateUriInfo.templateType === "sharedPart") {
      this.logger.info(
        `Shared part saved, regenerating all cached templates: ${textDocumentUri}`,
      );
      const cachedKeys = Array.from(this.loadedMaps.keys());
      for (const key of cachedKeys) {
        const [type, name] = key.split("/") as [TemplateTypes, string];
        await this.loadMap(type, name);
      }
      return;
    }

    // For template files, reload just that template
    this.logger.info(
      `Template file saved, regenerating: ${templateUriInfo.templateType}/${templateUriInfo.templateName}`,
    );
    await this.loadMap(
      templateUriInfo.templateType,
      templateUriInfo.templateName,
    );
  }

  /**
   * Generates the template key from template type and name
   * @param templateType The type of template
   * @param templateName The name of the template
   * @returns The template key in format "templateType/templateName"
   */
  private generateTemplateKey(
    templateType: TemplateTypes,
    templateName: string,
  ): TemplateKey {
    return `${templateType}/${templateName}`;
  }

  /**
   * Finds the index of the current file in the part sections array.
   * If the exact file and line match is not found, returns the last matching file index.
   * @param partSections The array of part sections
   * @param currentFilePath The full path of the current file
   * @param currentLine The current line number (0-based)
   * @returns The index of the current file in the part sections array, or -1 if not found
   */
  private findCurrentFileIndex(
    partSections: TemplateMap["partSections"],
    textDocumentUri: string,
    currentLine: number,
  ): number {
    const currentFilePath = URI.parse(textDocumentUri).fsPath;
    let lastMatchingIndex = -1;

    for (let i = 0; i < partSections.length; i++) {
      if (partSections[i].fileFullPath === currentFilePath) {
        if (
          currentLine >= partSections[i].startLine &&
          currentLine <= partSections[i].endLine
        ) {
          return i;
        }
        lastMatchingIndex = i;
      }
    }

    return lastMatchingIndex;
  }
}
