import { URI } from "vscode-uri";
import { Logger } from "../logger";
import { findMarketRepoRoot } from "../utils/marketRepoRoot";
import { parseTemplateUri } from "../utils/templateUriParser";
import { MainTemplateTypes } from "./types";

interface LastVisitedTemplate {
  type: MainTemplateTypes;
  handle: string;
  marketRoot: string | null;
}

/**
 * Singleton that tracks the last visited main template (non-shared part).
 * Uses LSP document events to track user activity.
 */
export class TemplateTracker {
  private static instance: TemplateTracker | null = null;
  private logger: Logger = new Logger("TemplateTracker");
  private lastVisitedTemplate: LastVisitedTemplate | null = null;

  private constructor() {}

  static getInstance(): TemplateTracker {
    if (!TemplateTracker.instance) {
      TemplateTracker.instance = new TemplateTracker();
    }
    return TemplateTracker.instance;
  }

  /**
   * Updates the last visited template based on document URI.
   * Only tracks main templates (reconciliationText, exportFile, accountTemplate).
   * Ignores shared parts.
   */
  updateFromUri(textDocumentUri: string): void {
    const templateUriInfo = parseTemplateUri(textDocumentUri);
    if (!templateUriInfo) {
      return;
    }

    if (templateUriInfo.templateType === "sharedPart") {
      return;
    }

    this.lastVisitedTemplate = {
      type: templateUriInfo.templateType,
      handle: templateUriInfo.templateName,
      marketRoot: findMarketRepoRoot(URI.parse(textDocumentUri).fsPath),
    };

    this.logger.debug(
      `Last visited template updated: ${this.lastVisitedTemplate.type}/${this.lastVisitedTemplate.handle}`,
    );
  }

  /**
   * Returns the last visited template.
   * When a marketRoot is given, a template from a different market repo is ignored.
   */
  getLastVisited(marketRoot?: string): LastVisitedTemplate | null {
    if (!this.lastVisitedTemplate) {
      return null;
    }
    const trackedRoot = this.lastVisitedTemplate.marketRoot;
    if (marketRoot && trackedRoot && trackedRoot !== marketRoot) {
      return null;
    }
    return { ...this.lastVisitedTemplate };
  }
}
