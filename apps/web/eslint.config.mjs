import { defineConfig, globalIgnores } from "eslint/config";
import next from "@next/eslint-plugin-next";
import reactX from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import importX from "eslint-plugin-import-x";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import storybook from "eslint-plugin-storybook";

const eslintConfig = defineConfig([
  {
    name: "stage-tracker:base",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
  },
  // First-party Next.js flat config: keep the Core Web Vitals rule set
  // without importing a framework umbrella config.
  next.configs["core-web-vitals"],
  ...tseslint.configs.recommended,
  {
    name: "stage-tracker:react",
    files: ["**/*.{jsx,tsx}"],
    plugins: { "@eslint-react": reactX },
    rules: {
      // Bounded semantic replacements for the current React rules. The full
      // @eslint-react recommended preset is intentionally not adopted.
      "@eslint-react/no-missing-component-display-name": "error",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/dom-no-find-dom-node": "error",
      "@eslint-react/dom-no-render": "error",
      "@eslint-react/dom-no-render-return-value": "error",
    },
  },
  {
    name: "stage-tracker:react-hooks",
    files: ["**/*.{jsx,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.flat.recommended.rules,
  },
  {
    name: "stage-tracker:import",
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    plugins: { "import-x": importX },
    rules: {
      "import-x/no-anonymous-default-export": "warn",
    },
  },
  {
    name: "stage-tracker:accessibility",
    files: ["**/*.{jsx,tsx}"],
    plugins: { "jsx-a11y-x": jsxA11yX },
    rules: {
      "jsx-a11y-x/alt-text": [
        "warn",
        {
          elements: ["img"],
          img: ["Image"],
        },
      ],
      "jsx-a11y-x/aria-props": "warn",
      "jsx-a11y-x/aria-proptypes": "warn",
      "jsx-a11y-x/aria-unsupported-elements": "warn",
      "jsx-a11y-x/role-has-required-aria-props": "warn",
      "jsx-a11y-x/role-supports-aria-props": "warn",
    },
  },
  ...storybook.configs["flat/recommended"],
  {
    name: "stage-tracker:storybook-import-parity",
    files: [
      "**/*.stories.@(ts|tsx|js|jsx|mjs|cjs)",
      "**/*.story.@(ts|tsx|js|jsx|mjs|cjs)",
    ],
    rules: {
      "import-x/no-anonymous-default-export": "off",
    },
  },
  eslintConfigPrettier,
  // `(app)/layout.tsx` の AppShell が唯一の <main> landmark を持つ。
  // route group へ移す前は各 page が自前の <main> を持っていて問題なかったが、
  // 移動後は AppShell の <main> の内側へ入れ子になり、axe の
  // landmark-main-is-top-level / landmark-no-duplicate-main 違反になる
  // （PR #383 review finding）。移動 PR ごとに人が気づく前提にしない。
  {
    files: ["src/app/(app)/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='main']",
          message:
            "(app) 配下の画面は <main> を持たない。AppShell ((app)/layout.tsx) が唯一の main landmark を提供する。外側の wrapper は <div> か fragment にすること。",
        },
      ],
    },
  },
  // Keep the existing generated-output ignore boundary after removing the
  // framework preset default ignore source.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "storybook-static/**",
  ]),
]);

export default eslintConfig;
