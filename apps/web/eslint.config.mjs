import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import storybook from "eslint-plugin-storybook";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...tseslint.configs.recommended,
  ...storybook.configs["flat/recommended"],
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
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test/build outputs (Vitest coverage / Playwright / Storybook).
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "storybook-static/**",
  ]),
]);

export default eslintConfig;
