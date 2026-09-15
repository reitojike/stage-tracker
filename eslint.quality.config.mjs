import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * `noInlineConfig` makes inline ESLint configuration ineffective, but ESLint
 * reports that condition as a warning. Keep the blocking part explicit for
 * disable directives; TypeScript directives are handled by the standard
 * `@typescript-eslint/ban-ts-comment` rule below.
 */
const noEslintDisable = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow inline ESLint disable directives.' },
    schema: [],
    messages: { forbidden: 'Inline ESLint disable directives are forbidden.' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (/\beslint-disable(?:-next-line|-line)?\b/u.test(comment.value)) {
            context.report({ loc: comment.loc, messageId: 'forbidden' });
          }
        }
      },
    };
  },
};

/**
 * The blocking TypeScript quality floor owned by this repository. Package
 * configs add their own architecture rules after this shared baseline.
 */
export function projectTypeScriptQualityProfile() {
  return [
    {
      linterOptions: {
        noInlineConfig: true,
        reportUnusedDisableDirectives: 'error',
      },
    },
    ...tseslint.configs.strictTypeChecked.map((config) => ({
      ...config,
      files: ['**/*.{ts,tsx}'],
    })),
    eslintConfigPrettier,
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parserOptions: { projectService: true },
      },
      plugins: { project: { rules: { 'no-eslint-disable': noEslintDisable } } },
      rules: {
        // Keep these safety boundaries explicit rather than relying on a
        // preset's current membership. `noInlineConfig` makes ESLint
        // disable comments ineffective, while ban-ts-comment rejects the
        // TypeScript directives themselves.
        'project/no-eslint-disable': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-check': true,
            'ts-expect-error': true,
            'ts-ignore': true,
            'ts-nocheck': true,
          },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-non-null-assertion': 'error',
        '@typescript-eslint/no-unsafe-argument': 'error',
        '@typescript-eslint/no-unsafe-assignment': 'error',
        '@typescript-eslint/no-unsafe-call': 'error',
        '@typescript-eslint/no-unsafe-member-access': 'error',
        '@typescript-eslint/no-unsafe-return': 'error',
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
}

export default projectTypeScriptQualityProfile();
