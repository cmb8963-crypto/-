// ESLint: plain browser scripts (no bundler) + the Apps Script backend + Vitest tests.
const globals = require("globals");

const shared = { MK: "readonly", UI: "readonly", Api: "readonly", DemoBackend: "readonly", App: "readonly", Dialogs: "readonly", Pages: "readonly" };
const rules = {
  "no-undef": "error",
  "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }],
  "eqeqeq": ["error", "smart"],
  "no-console": "error",          // case data is sensitive: never log it
  "no-eval": "error",
  "no-implied-eval": "error"
};

module.exports = [
  { ignores: ["node_modules/**", "apps-script/dist/**"] },
  {
    files: ["js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...globals.browser, ...shared, module: "readonly" } },
    rules
  },
  {
    files: ["apps-script/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "script",
      globals: { MK: "readonly", SpreadsheetApp: "readonly", DriveApp: "readonly", PropertiesService: "readonly", ScriptApp: "readonly",
        Logger: "readonly", Utilities: "readonly", ContentService: "readonly", LockService: "readonly", CacheService: "readonly",
        MailApp: "readonly", Session: "readonly" }
    },
    rules: { ...rules, "no-unused-vars": ["error", { vars: "local", args: "none", caughtErrors: "none" }] }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
    rules
  },
  {
    files: ["eslint.config.js", "vitest.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } }
  }
];
