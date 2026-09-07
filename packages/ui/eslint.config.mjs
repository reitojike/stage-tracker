import { nextSupabaseQualityProfile } from '../../.ai-dev-foundation/quality/eslint.config.mjs';

const appsWebBoundaryMessage =
  'packages/ui は apps/web 固有のモジュール（src/lib/supabase, src/lib/auth, ' +
  'src/lib/safe-action, src/lib/action-error, src/env, src/app/** 等）を import ' +
  'できません。packages/ui は apps/web から依存される側であり、逆方向の依存を ' +
  '作ってはいけません。';

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
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/web/**', '@stage-tracker/web', '@stage-tracker/web/**'],
              message: appsWebBoundaryMessage,
            },
          ],
        },
      ],
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
