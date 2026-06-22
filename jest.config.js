module.exports = {
  testMatch: [
    "<rootDir>/tests/unit/**/*.test.[jt]s?(x)",
    "<rootDir>/tests/integration/**/*.test.[jt]s?(x)",
    "<rootDir>/__tests__/**/*.test.[jt]s?(x)"
  ],
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^@core/(.*)$': '<rootDir>/app/assets/js/core/$1',
    '^@ui/(.*)$': '<rootDir>/app/assets/js/ui/$1',
    '^@common/(.*)$': '<rootDir>/app/assets/js/core/common/$1',
    '^@network/(.*)$': '<rootDir>/network/$1',
    '^@app/(.*)$': '<rootDir>/app/$1',
    '^@sentry/electron/main$': '<rootDir>/__mocks__/@sentry/electron/main.js',
    '^helios-distribution-types$': '<rootDir>/app/assets/js/core/common/DistributionClasses.js',
  },
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
