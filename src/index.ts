#!/usr/bin/env node

import { LiquidLanguageServer } from "./server";
import { extractDataScope } from "./liquid/dataScopeExtractor";

async function main() {
  // Batch sub-command: `silverfin-ls data-scope <path-to-main.liquid>` -> JSON on stdout.
  if (process.argv[2] === "data-scope") {
    const target = process.argv[3];
    if (!target) {
      console.error("Usage: silverfin-ls data-scope <path-to-main.liquid>");
      process.exit(1);
    }
    const scope = await extractDataScope(target);
    console.log(JSON.stringify(scope, null, 2));
    process.exit(0);
  }

  const server = new LiquidLanguageServer();
  server.start();

  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}

main();
