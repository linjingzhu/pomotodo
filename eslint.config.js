const { defineConfig } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = defineConfig([
  { ignores: ['dist/**', 'node_modules/**', '.ai/**', '.agents/**', '.codex/**', '.claude/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['renderer/*.js'],
    languageOptions: { sourceType: 'script', globals: globals.browser },
  },
]);
