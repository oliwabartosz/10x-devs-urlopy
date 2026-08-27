/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [pluginReact.configs.flat.recommended],
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// Standalone Node scripts: `scripts/build-artifact.mjs` (npm's postbuild hook) and
// `deploy/backup.mjs` (run by the systemd backup timer on the VPS). Both are plain `.mjs` on
// purpose — the VPS installs with `--omit=dev` and has no `tsx`, and postbuild must not depend on
// a build step of its own. That costs them the two things `.ts` files get for free here:
// `@types/node` supplying the globals (typescript-eslint turns `no-undef` off for `.ts`; eslint's
// recommended set leaves it on everywhere else), and a reason to route output anywhere but stdout.
const nodeScriptConfig = tseslint.config({
  files: ["**/*.mjs"],
  languageOptions: {
    globals: { process: "readonly", console: "readonly", URL: "readonly" },
  },
  rules: { "no-console": "off" },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  languageOptions: {
    parserOptions: {
      projectService: false,
      project: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
    // astro-eslint-parser doesn't wire up ReturnStatement parent nodes in frontmatter,
    // causing no-misused-promises to hard-crash. Rule remains active for .ts/.tsx.
    "@typescript-eslint/no-misused-promises": "off",
  },
});

export default tseslint.config(
  includeIgnoreFile(gitignorePath),
  // TEMPORARY: design prototype exported from claude.ai/design. support.js is a
  // generated runtime bundle, not application code. Drop this entry when
  // new-design/ is deleted (see new-design/README.md).
  { ignores: ["new-design/**"] },
  baseConfig,
  nodeScriptConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  eslintPluginPrettier,
);
