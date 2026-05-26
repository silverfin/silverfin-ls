module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/test"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.spec.ts",
    "!src/**/*.test.ts",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  // Workaround for a tree-sitter / Jest race: when a single Jest worker process
  // runs multiple test-file sandboxes that each require('tree-sitter'), the
  // second sandbox's destructure of Tree.prototype invokes the getter the first
  // sandbox installed, captures `undefined`, and reinstalls a getter that
  // permanently returns undefined for every Tree in that worker. See
  // node_modules/tree-sitter/index.js:13-32. Spawning at least one worker per
  // test file keeps each file in its own process, so the wrapper only runs
  // once per process and the race cannot fire. Must stay >= number of test files.
  maxWorkers: 16,
};
