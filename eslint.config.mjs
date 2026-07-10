import nx from '@nx/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
      // Vendored / parked / generated trees — not owned active-core code.
      // The lint gate measures the code we maintain, nothing else.
      'localcoder/**',
      'client/src/vendor/**',
      'autogen-main/**',
      'Kronos-main/**',
      'vendor/**',
      'worldsignal/**',
      'coder-workspace/**',
      'e2e/**',
      'artifacts/**',
      'n8n_data/**',
      'test-results/**',
      // Python virtualenv ships thousands of JS files in site-packages;
      // eslint has no default ignore for .venv the way it does node_modules.
      '**/.venv/**',
      '**/__pycache__/**',
      'tmp/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    plugins: {
      'react-hooks': reactHooks,
      'unused-imports': unusedImports,
    },
    rules: {
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
