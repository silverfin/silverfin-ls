import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  Connection,
  Hover,
  Definition,
  DidChangeConfigurationNotification,
  MarkupKind,
  Location,
  ReferenceParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { readFileSync } from "fs";
import { join } from "path";
import { Logger } from "./logger";
import { HoverProvider } from "./lspCapabilities/hoverProvider";
import { DefinitionProvider } from "./lspCapabilities/definitionProvider";
import { ReferenceProvider } from "./lspCapabilities/referenceProvider";
import { TemplatePartsCollectionManager } from "./templates/templatePartsCollectionManager";
import { TemplateTracker } from "./templates/templateTracker";
import { findMarketRepoRoot } from "./utils/marketRepoRoot";

interface LSSettings {
  hover?: {
    enabled?: boolean;
  };
  logLevel?: string;
  logFile?: string;
}

const DEFAULT_SETTINGS: LSSettings = {
  hover: { enabled: true },
  logLevel: "info",
};

export class LiquidLanguageServer {
  private connection: Connection;
  private documents: TextDocuments<TextDocument> = new TextDocuments(
    TextDocument,
  );
  private logger: Logger;
  private workspaceRoot: string | null = null;
  private hasConfigurationCapability: boolean = false;
  private hasWorkspaceFolderCapability: boolean = false;
  private settings: LSSettings = DEFAULT_SETTINGS;

  constructor(connection?: Connection) {
    this.connection = connection || createConnection(ProposedFeatures.all);

    this.logger = new Logger("LiquidLanguageServer");
    this.setupHandlers();
  }

  public start(): void {
    this.connection.listen();
  }

  public stop(): void {
    this.connection.dispose();
  }

  private setupHandlers(): void {
    this.setupOnInitializeHandler();
    this.setupOnInitializedHandler();
    this.setupOnDidChangeConfigurationHandler();
    this.setupOnDidOpenHandler();
    this.setupOnDidSaveHandler();
    this.setupOnDidChangeContentHandler();
    this.setupOnHoverHandler();
    this.setupOnDefinitionHandler();
    this.setupOnReferencesHandler();
    this.documents.listen(this.connection);
  }

  private setupOnInitializeHandler(): void {
    this.connection.onInitialize((params: InitializeParams) => {
      // Update log level and settings from initialization options if provided
      const initOptions = params.initializationOptions as
        | LSSettings
        | undefined;

      if (initOptions) {
        this.settings = { ...DEFAULT_SETTINGS, ...initOptions };
      }

      // Configure logger
      const logLevel = this.settings.logLevel || DEFAULT_SETTINGS.logLevel!;
      Logger.configure({
        level: logLevel,
        connection: this.connection,
        logFile: this.settings.logFile,
      });
      this.logger.info(`Log level set to: ${logLevel}`);

      this.logger.info("Server initializing");

      // Determine workspace root
      // #NOTE: we may want to set workspaceRoot differently (validating folder structure)
      if (params.workspaceFolders) {
        this.workspaceRoot = URI.parse(params.workspaceFolders[0].uri).fsPath;
        this.logger.info(`Workspace root from folders: ${this.workspaceRoot}`);
      }

      // Check client capabilities
      const capabilities = params.capabilities;
      this.hasConfigurationCapability = !!(
        capabilities.workspace &&
        !!capabilities.workspace.configuration &&
        !!capabilities.workspace.didChangeConfiguration &&
        !!capabilities.workspace.didChangeConfiguration.dynamicRegistration
      );
      this.hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
      );

      const result: InitializeResult = {
        capabilities: {
          textDocumentSync: {
            openClose: true,
            change: TextDocumentSyncKind.Full,
            save: {
              includeText: false,
            },
          },
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
          ...(this.hasConfigurationCapability && {
            workspace: {
              workspaceFolders: {
                supported: this.hasWorkspaceFolderCapability,
              },
            },
          }),
        },
      };
      this.logger.debug(
        `Client capabilities: ${JSON.stringify(result.capabilities)}`,
      );

      return result;
    });
  }

  private setupOnInitializedHandler(): void {
    this.connection.onInitialized(() => {
      this.logger.info("Server initialized");
      this.logVersion();

      // Only register for configuration changes if the client supports dynamic registration
      // and we have configuration capability
      if (this.hasConfigurationCapability) {
        this.logger.debug(
          "Client supports configuration capability - registering for changes",
        );
        this.connection.client.register(
          DidChangeConfigurationNotification.type,
          undefined,
        );
      }
    });
  }

  private setupOnDidChangeConfigurationHandler(): void {
    this.connection.onDidChangeConfiguration((change) => {
      if (this.hasConfigurationCapability) {
        this.logger.info("Configuration changed, updating settings");
      } else {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...(change.settings.silverfinLS || {}),
        };
      }
      this.logger.info(
        `Hover enabled: ${this.settings.hover?.enabled ?? DEFAULT_SETTINGS.hover!.enabled}`,
      );
    });
  }

  private setupOnDidOpenHandler(): void {
    // Track last visited template from document open/change events
    this.documents.onDidOpen((event) => {
      const tracker = TemplateTracker.getInstance();
      tracker.updateFromUri(event.document.uri);
    });
  }

  private setupOnDidChangeContentHandler(): void {
    this.documents.onDidChangeContent((change) => {
      const tracker = TemplateTracker.getInstance();
      tracker.updateFromUri(change.document.uri);
    });
  }

  private resolveMarketRoot(documentUri: string): string | null {
    const filePath = URI.parse(documentUri).fsPath;
    return findMarketRepoRoot(filePath) ?? this.workspaceRoot;
  }

  private setupOnHoverHandler(): void {
    this.connection.onHover(async (params): Promise<Hover | null> => {
      try {
        if (
          !(this.settings.hover?.enabled ?? DEFAULT_SETTINGS.hover!.enabled)
        ) {
          this.logger.debug("Hover is disabled in settings");
          return null;
        }

        this.logger.debug(`Hover request for: ${params.textDocument.uri}`);

        // Track template on every request to handle buffer switching
        const tracker = TemplateTracker.getInstance();
        tracker.updateFromUri(params.textDocument.uri);

        const marketRoot = this.resolveMarketRoot(params.textDocument.uri);
        const hoverProvider = new HoverProvider(params, marketRoot);
        const response = await hoverProvider.handleHoverRequest();
        if (response) {
          return {
            contents: {
              kind: MarkupKind.Markdown,
              value: response,
            },
          };
        }
        return null;
      } catch (error) {
        this.logger.error(`Hover request failed: ${error}`);
        return null;
      }
    });
  }

  private setupOnDefinitionHandler(): void {
    this.connection.onDefinition(async (params): Promise<Definition | null> => {
      try {
        this.logger.debug(`Definition request for: ${params.textDocument.uri}`);

        // Track template on every request to handle buffer switching
        const tracker = TemplateTracker.getInstance();
        tracker.updateFromUri(params.textDocument.uri);

        const marketRoot = this.resolveMarketRoot(params.textDocument.uri);
        const definitionProvider = new DefinitionProvider(
          params,
          marketRoot,
        );
        const response = await definitionProvider.handleDefinitionRequest();
        return response;
      } catch (error) {
        this.logger.error(`Definition request failed: ${error}`);
        return null;
      }
    });
  }

  private setupOnReferencesHandler(): void {
    this.connection.onReferences(
      async (params: ReferenceParams): Promise<Location[] | null> => {
        try {
          this.logger.debug(
            `References request for: ${params.textDocument.uri}`,
          );

          // Track template on every request to handle buffer switching
          const tracker = TemplateTracker.getInstance();
          tracker.updateFromUri(params.textDocument.uri);

          const marketRoot = this.resolveMarketRoot(params.textDocument.uri);
          const referenceProvider = new ReferenceProvider(
            params,
            marketRoot,
          );
          const response = await referenceProvider.handleReferenceRequest();
          return response;
        } catch (error) {
          this.logger.error(`References request failed: ${error}`);
          return null;
        }
      },
    );
  }

  private setupOnDidSaveHandler(): void {
    // Regenerate template maps when liquid files are saved
    this.documents.onDidSave(async (change) => {
      const uri = change.document.uri;
      const marketRoot = this.resolveMarketRoot(uri);
      if (uri.endsWith(".liquid") && marketRoot) {
        this.logger.debug(
          `Liquid file saved, regenerating template map: ${uri}`,
        );
        try {
          const manager = TemplatePartsCollectionManager.getInstance(marketRoot);
          await manager.regenerateFromUri(uri);
        } catch (error) {
          this.logger.error(`Failed to regenerate template map: ${error}`);
        }
      }
    });
  }

  private logVersion(): void {
    try {
      const packageJsonPath = join(__dirname, "..", "package.json");
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
      this.logger.info(`Liquid Language Server v${packageJson.version}`);
    } catch (error) {
      this.logger.warn(`Could not read version from package.json: ${error}`);
    }
  }
}
