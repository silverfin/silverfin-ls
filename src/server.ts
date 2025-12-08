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
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { Logger } from "./logger";
import { HoverProvider } from "./lspCapabilities/hoverProvider";
import { DefinitionProvider } from "./lspCapabilities/definitionProvider";

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
          textDocumentSync: TextDocumentSyncKind.Full,
          hoverProvider: true,
          definitionProvider: true,
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

    // this.connection.onDidChangeWatchedFiles((_change) => {
    //   this.connection.console.log("File change event received");
    // });
    //
    // this.documents.onDidChangeContent((change) => {
    //   this.connection.console.log(`didChangeContent: ${change.document.uri}`);
    // });

    this.connection.onHover(async (params): Promise<Hover | null> => {
      if (!(this.settings.hover?.enabled ?? DEFAULT_SETTINGS.hover!.enabled)) {
        this.logger.debug("Hover is disabled in settings");
        return null;
      }

      this.logger.debug(`Hover request for: ${params.textDocument.uri}`);

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
    });

    this.connection.onDefinition(async (params): Promise<Definition | null> => {
      this.logger.debug(`Definition request for: ${params.textDocument.uri}`);

      const definitionProvider = new DefinitionProvider(
        params,
        this.workspaceRoot,
      );
      const response = await definitionProvider.handleDefinitionRequest();
      return response;
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
