import globals from 'globals'
import js from '@eslint/js'

export default [
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021,
                ...globals.jest,
                ...globals.browser
            }
        },
        rules: {
            'indent': ['error', 4, { 'SwitchCase': 1 }],
            'linebreak-style': ['error', 'windows'],
            'quotes': ['error', 'single'],
            'semi': ['error', 'never'],
            'no-var': 'error',
            'no-console': 'off',
            'no-control-regex': 'off',
            'no-unused-vars': ['error', { 'vars': 'all', 'args': 'none', 'ignoreRestSiblings': false, 'argsIgnorePattern': 'reject' }],
            'no-async-promise-executor': 'off'
        }
    },
    {
        files: ['app/assets/js/scripts/*.js'],
        rules: {
            'no-unused-vars': 'off',
            'no-undef': 'off'
        }
    },
    {
        ignores: ['dist/', 'build/', 'node_modules/', 'docs/']
    }
]
