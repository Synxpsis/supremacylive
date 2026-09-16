import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", ".wrangler/**", "design-system/**", "migrations/**"],
  },
  js.configs.recommended,
  {
    // Worker runtime: src/worker.js, src/match.js, src/matchmaker.js
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.worker,
        // Cloudflare Workers runtime global, not part of the standard
        // service-worker globals set that the `globals` package ships.
        WebSocketPair: "readonly",
      },
    },
  },
  {
    // ES module client code loaded via <script type="module">
    files: ["public/board-render-3d.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    // Classic <script> client code, no bundler/module system
    files: ["public/**/*.js"],
    ignores: ["public/board-render-3d.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        // These files run as plain <script> tags but guard a CommonJS
        // export path for reuse under Node (tests, tooling).
        module: "readonly",
      },
    },
  },
  {
    rules: {
      // Existing code predates lint; don't fail CI on stylistic debt yet —
      // only on the checks that catch real bugs (undefined vars, dead code paths).
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
      "no-empty": "warn",
      "no-constant-condition": ["error", { checkLoops: false }],
    },
  },
];
