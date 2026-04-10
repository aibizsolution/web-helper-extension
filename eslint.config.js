import globals from 'globals';

const browserLikeFiles = [
  'background.js',
  'content.js',
  'logger.js',
  'meta.js',
  'sidepanel.js',
  'content/**/*.js',
  'modules/**/*.js',
  'sidepanel/**/*.js'
];

const nodeFiles = [
  'eslint.config.js',
  'scripts/**/*.mjs'
];

const correctnessRules = {
  'no-constant-binary-expression': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-unreachable': 'error',
  'no-undef': 'error',
  'valid-typeof': 'error'
};

export default [
  {
    ignores: [
      'node_modules/**',
      'test-results/**',
      'icons/**'
    ]
  },
  {
    files: browserLikeFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: correctnessRules
  },
  {
    files: nodeFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: correctnessRules
  }
];
