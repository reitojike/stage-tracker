import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import storybook from "eslint-plugin-storybook";

const legacyWebBoundaryPatterns = [
  "**/legacy-web/**",
  "@stage-tracker/legacy-web",
  "@stage-tracker/legacy-web/**",
];

const legacyWebBoundaryMessage =
  "apps/legacy-web からの import は禁止です。legacy は移植元ではなく oracle です。仕様は docs/v2/oracle-*.md を参照してください。";

function globToRegExp(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Dynamic-import counterpart to the `no-restricted-imports` rule below.
 * That rule only visits `ImportDeclaration` / `ExportNamedDeclaration` /
 * `ExportAllDeclaration` - it never inspects `ImportExpression`, so
 * `import("../../legacy-web/src/...")` resolves fine at the TypeScript
 * level yet slips past the static boundary check entirely. Mirrors the
 * dynamic-import guard apps/legacy-web/eslint.config.mjs already carries
 * for its own (different) import boundary.
 */
const noDynamicLegacyWebImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow dynamic import() of apps/legacy-web from apps/web.",
    },
    schema: [],
    messages: { forbidden: legacyWebBoundaryMessage },
  },
  create(context) {
    const regexes = legacyWebBoundaryPatterns.map(globToRegExp);
    return {
      ImportExpression(node) {
        if (
          node.source.type !== "Literal" ||
          typeof node.source.value !== "string"
        ) {
          return;
        }
        const value = node.source.value;
        if (regexes.some((re) => re.test(value))) {
          context.report({ node, messageId: "forbidden" });
        }
      },
    };
  },
};

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
    plugins: {
      "web-boundary": {
        rules: { "no-dynamic-legacy-web-import": noDynamicLegacyWebImport },
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: legacyWebBoundaryPatterns,
              message: legacyWebBoundaryMessage,
            },
          ],
        },
      ],
      "web-boundary/no-dynamic-legacy-web-import": "error",
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
