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
import { Logger } from "./logger";
import { HoverProvider } from "./lspCapabilities/hoverProvider";
import { DefinitionProvider } from "./lspCapabilities/definitionProvider";
import { ReferenceProvider } from "./lspCapabilities/referenceProvider";
import { TemplatePartsCollectionManager } from "./templates/templatePartsCollectionManager";
import { TemplateTracker } from "./templates/templateTracker";

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

  private setupHandlers(): void {
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

    this.connection.onInitialized(() => {
      this.logger.info("Server initialized");

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

    this.connection.onDidChangeConfiguration((change) => {
      if (this.hasConfigurationCapability) {
        this.logger.info("Configuration changed, updating settings");
      } else {
        this.settings = {
          ...DEFAULT_SETTINGS,
          ...(change.settings.liquidLS || {}),
        };
      }
      this.logger.info(
        `Hover enabled: ${this.settings.hover?.enabled ?? DEFAULT_SETTINGS.hover!.enabled}`,
      );
    });

    // Track last visited template from document open/change events
    this.documents.onDidOpen((event) => {
      const tracker = TemplateTracker.getInstance();
      tracker.updateFromUri(event.document.uri);
    });

    this.documents.onDidChangeContent((change) => {
      const tracker = TemplateTracker.getInstance();
      tracker.updateFromUri(change.document.uri);
    });

    this.connection.onHover(async (params): Promise<Hover | null> => {
      try {
        if (!(this.settings.hover?.enabled ?? DEFAULT_SETTINGS.hover!.enabled)) {
          this.logger.debug("Hover is disabled in settings");
          return null;
        }

        this.logger.debug(`Hover request for: ${params.textDocument.uri}`);

        // Track template on every request to handle buffer switching
        const tracker = TemplateTracker.getInstance();
        tracker.updateFromUri(params.textDocument.uri);

        const hoverProvider = new HoverProvider(params, this.workspaceRoot);
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

    this.connection.onDefinition(async (params): Promise<Definition | null> => {
      try {
        this.logger.debug(`Definition request for: ${params.textDocument.uri}`);

        // Track template on every request to handle buffer switching
        const tracker = TemplateTracker.getInstance();
        tracker.updateFromUri(params.textDocument.uri);

        const definitionProvider = new DefinitionProvider(
          params,
          this.workspaceRoot,
        );
        const response = await definitionProvider.handleDefinitionRequest();
        return response;
      } catch (error) {
        this.logger.error(`Definition request failed: ${error}`);
        return null;
      }
    });

    this.connection.onReferences(
      async (params: ReferenceParams): Promise<Location[] | null> => {
        try {
          this.logger.debug(`References request for: ${params.textDocument.uri}`);

          // Track template on every request to handle buffer switching
          const tracker = TemplateTracker.getInstance();
          tracker.updateFromUri(params.textDocument.uri);

          const referenceProvider = new ReferenceProvider(
            params,
            this.workspaceRoot,
          );
          const response = await referenceProvider.handleReferenceRequest();
          return response;
        } catch (error) {
          this.logger.error(`References request failed: ${error}`);
          return null;
        }
      },
    );

    // Regenerate template maps when liquid files are saved
    this.documents.onDidSave(async (change) => {
      const uri = change.document.uri;
      if (uri.endsWith(".liquid") && this.workspaceRoot) {
        this.logger.debug(`Liquid file saved, regenerating template map: ${uri}`);
        try {
          const manager = TemplatePartsCollectionManager.getInstance(this.workspaceRoot);
          await manager.regenerateFromUri(uri);
        } catch (error) {
          this.logger.error(`Failed to regenerate template map: ${error}`);
        }
      }
    });

    this.documents.listen(this.connection);
  }

  public start(): void {
    this.connection.listen();
  }

  public stop(): void {
    this.connection.dispose();
  }
}
