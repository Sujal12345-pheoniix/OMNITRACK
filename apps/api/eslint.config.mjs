import base from '@omnitrack/config/eslint';

export default [
  ...base,
  {
    // NestJS resolves constructor dependencies from emitted type metadata, so
    // `import type` must not be forced on injected classes.
    files: ['**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
