import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
      'no-var': 'error',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },
  {
    files: ['js/**/*.js', 'runner/latex.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    // Classic scripts: no module syntax, and `Sk` comes from the vendored Skulpt build.
    files: ['js/theme-init.js', 'runner/runner.js'],
    languageOptions: { ecmaVersion: 2020, sourceType: 'script', globals: { ...globals.browser, Sk: 'readonly' } },
    rules: { 'no-var': 'off', 'prefer-const': 'off' },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
];
