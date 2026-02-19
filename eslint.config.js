import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import perfectionist from 'eslint-plugin-perfectionist';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      perfectionist,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // TypeScript specific
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',

      // Import/export sorting (no blank lines between groups)
      'perfectionist/sort-imports': [
        'error',
        { type: 'natural', order: 'asc', ignoreCase: true, newlinesBetween: 0 },
      ],
      'perfectionist/sort-named-imports': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-named-exports': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-exports': ['error', { type: 'natural', order: 'asc' }],
      'no-duplicate-imports': 'error',

      // Type sorting
      'perfectionist/sort-union-types': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-intersection-types': ['error', { type: 'natural', order: 'asc' }],
      'perfectionist/sort-enums': ['error', { type: 'natural', order: 'asc' }],

      // General
      'no-console': 'off', // CLI app needs console
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['**/*.js', 'tests/**/*.ts', 'vitest.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'examples/**'],
  }
);
