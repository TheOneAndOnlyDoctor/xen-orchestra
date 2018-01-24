module.exports = {
  extends: ['standard', 'standard-jsx'],
  globals: {
    __DEV__: true,
  },
  parser: 'babel-eslint',
  rules: {
    'comma-dangle': ['error', 'always-multiline'],
    'no-var': 'error',
    'node/no-extraneous-import': 'error',
    'node/no-extraneous-require': 'error',
    'node/no-missing-require': 'error',
    'node/no-missing-import': 'error',
    'prefer-const': 'error',
  },
}
