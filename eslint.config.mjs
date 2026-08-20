import {
  architectureImportBoundary,
  nextSupabaseQualityProfile,
} from './.ai-dev-foundation/quality/eslint.config.mjs';

export default [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...nextSupabaseQualityProfile(),
  architectureImportBoundary({
    files: ['src/domain/**/*.{ts,tsx}'],
    restrictedPatterns: [
      '../ui/**',
      '../app/**',
      '../infrastructure/**',
      '@/ui/**',
      '@/app/**',
      '@/infrastructure/**',
    ],
    message: 'Domain code must not import UI, app entrypoints, or infrastructure.',
  }),
];
