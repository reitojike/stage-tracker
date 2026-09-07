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
  // v2 は greenfield 実装であり、apps/legacy-web は「実行して結果を比較する
  // oracle」であってコードの参照先ではない。legacy の実装を取り込むと、
  // 最終形が「旧 architecture を新ライブラリで書き直しただけ」になる。
  // 仕様は docs/v2/oracle-*.md を参照すること。
  {
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/legacy-web/**",
                "@stage-tracker/legacy-web",
                "@stage-tracker/legacy-web/**",
              ],
              message:
                "apps/legacy-web からの import は禁止です。legacy は移植元ではなく oracle です。仕様は docs/v2/oracle-*.md を参照してください。",
            },
          ],
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
