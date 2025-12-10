import { Logger } from "../logger";
import { parseTemplateUri } from "../utils/templateUriParser";
import { MainTemplateTypes } from "./types";

interface LastVisitedTemplate {
  type: MainTemplateTypes;
  handle: string;
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
    };

    this.logger.debug(
      `Last visited template updated: ${this.lastVisitedTemplate.type}/${this.lastVisitedTemplate.handle}`,
    );
  }

  getLastVisited(): LastVisitedTemplate | null {
    if (!this.lastVisitedTemplate) {
      return null;
    }
    return { ...this.lastVisitedTemplate };
  }
}
