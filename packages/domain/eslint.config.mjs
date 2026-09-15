import { projectTypeScriptQualityProfile } from '../../eslint.quality.config.mjs';

const purityMessage =
  'packages/domain must stay pure: no I/O, no framework/provider dependency. See the package architecture boundary.';

const clockMessage =
  'packages/domain must stay clock-free: accept "now" as a parameter instead of reading the current time (see docs/v2/decisions.md A6).';

export default [
  ...projectTypeScriptQualityProfile(),
  {
    ignores: ['node_modules/**'],
  },
  {
    // Re-declares the quality profile's type-assertion ban (`no-restricted-syntax`
    // is not additive across config objects matching the same files - the later
    // entry replaces it) and adds domain-specific purity/clock guardrails on top.
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: purityMessage },
            { name: 'node:fs', message: purityMessage },
            { name: 'fs/promises', message: purityMessage },
            { name: 'node:fs/promises', message: purityMessage },
            { name: 'react', message: purityMessage },
            { name: 'react-dom', message: purityMessage },
            { name: 'next', message: purityMessage },
          ],
          patterns: [{ group: ['next/*', '@supabase/*', '@supabase/**'], message: purityMessage }],
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
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: clockMessage,
        },
      ],
    },
  },
];
