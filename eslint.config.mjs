import {
  architectureImportBoundary,
  nextSupabaseQualityProfile,
} from './.ai-dev-foundation/quality/eslint.config.mjs';

export default [
  { ignores: ['.next/**', 'node_modules/**', '.foundation-checkout/**'] },
  ...nextSupabaseQualityProfile(),
  architectureImportBoundary({
    files: ['src/domain/**/*.{ts,tsx}'],
    // Depth-independent patterns: a relative import from a nested domain
    // file (e.g. src/domain/nested/x.ts importing "../../ui/HomePage")
    // needs more ".." segments than a top-level "../ui/**" pattern can
    // match, so match on the "/ui/" path segment itself instead.
    restrictedPatterns: ['**/ui/**', '**/app/**', '**/infrastructure/**'],
    message: 'Domain code must not import UI, app entrypoints, or infrastructure.',
  }),
];
