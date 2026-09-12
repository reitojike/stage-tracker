import { nextSupabaseQualityProfile } from '../../.ai-dev-foundation/quality/eslint.config.mjs';

const appsWebBoundaryMessage =
  'packages/ui は apps/web 固有のモジュール（src/lib/supabase, src/lib/auth, ' +
  'src/lib/safe-action, src/lib/action-error, src/env, src/app/** 等）を import ' +
  'できません。packages/ui は apps/web から依存される側であり、逆方向の依存を ' +
  '作ってはいけません。';

const appsWebBoundaryPatterns = ['**/apps/web/**', '@stage-tracker/web', '@stage-tracker/web/**'];

function globToRegExp(glob) {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(char)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * Dynamic-import counterpart to `no-restricted-imports` below. That rule
 * only visits `ImportDeclaration` / `ExportNamedDeclaration` /
 * `ExportAllDeclaration` - it never inspects `ImportExpression`, so
 * `import("../../../apps/web/src/...")` resolves fine at the TypeScript
 * level yet slips past the static boundary check entirely.
 */
const noDynamicAppsWebImport = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow dynamic import() across the packages/ui -> apps/web boundary.' },
    schema: [],
    messages: { forbidden: appsWebBoundaryMessage },
  },
  create(context) {
    const regexes = appsWebBoundaryPatterns.map(globToRegExp);
    return {
      ImportExpression(node) {
        if (node.source.type !== 'Literal' || typeof node.source.value !== 'string') {
          return;
        }
        const value = node.source.value;
        if (regexes.some((re) => re.test(value))) {
          context.report({ node, messageId: 'forbidden' });
        }
      },
    };
  },
};

export default [
  ...nextSupabaseQualityProfile(),
  {
    ignores: ['node_modules/**'],
  },
  {
    // Re-declares the quality profile's type-assertion ban (`no-restricted-syntax`
    // is not additive across config objects matching the same files - the later
    // entry replaces it) and adds packages/ui's own dependency-direction
    // guardrail on top, mirroring packages/domain's eslint.config.mjs pattern.
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'ui-boundary': { rules: { 'no-dynamic-apps-web-import': noDynamicAppsWebImport } },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: appsWebBoundaryPatterns,
              message: appsWebBoundaryMessage,
            },
          ],
        },
      ],
      'ui-boundary/no-dynamic-apps-web-import': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
          message: 'Type assertions are forbidden; narrow unknown instead.',
        },
        {
          selector: 'TSTypeAssertion',
          message: 'Type assertions are forbidden; narrow unknown instead.',
        },
      ],
    },
  },
];
