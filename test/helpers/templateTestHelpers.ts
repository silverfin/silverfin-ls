import * as path from "path";
import { URI } from "vscode-uri";
import { TemplateTracker } from "../../src/templates/templateTracker";

export const fixturesPath = path.resolve(
  __dirname,
  "../../fixtures/market-repo",
);

/**
 * Simulates a user visiting a template by updating the TemplateTracker.
 * This is needed for shared part tests to know which template context to use.
 */
export function visitTemplate(
  templateType: string,
  templateName: string,
): void {
  const templatePath = getTemplatePath(templateType, templateName);
  const tracker = TemplateTracker.getInstance();
  tracker.updateFromUri(URI.file(templatePath).toString());
}

/**
 * Gets the full path for a template file.
 * Works for all template types including shared parts.
 * 
 * @example
 * getTemplatePath('reconciliationText', 'my_template') 
 * // => 'reconciliation_texts/my_template/main.liquid'
 * 
 * getTemplatePath('sharedPart', 'shared_part_1')
 * // => 'shared_parts/shared_part_1/shared_part_1.liquid'
 */
export function getTemplatePath(
  templateType: string,
  templateName: string,
): string {
  const fileName = templateType === "sharedPart" 
    ? `${templateName}.liquid` 
    : "main.liquid";
  
  return path.join(fixturesPath, `${templateType}/${templateName}/${fileName}`);
}
