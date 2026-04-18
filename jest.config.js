module.exports = {
  roots: ['<rootDir>/tests'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['app/**/*.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['html', 'text'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/assets/js/(?!core/|ui/|mocks/|errorPreload|preloader|renderer-entry)(.*)$': '<rootDir>/app/assets/js/core/$1.js',
    '^@app/(.*)$': '<rootDir>/app/$1',
    '^@core/(.*)$': '<rootDir>/app/assets/js/core/$1',
    '^@ui/(.*)$': '<rootDir>/app/assets/js/ui/$1',
    '^@common/(.*)$': '<rootDir>/app/assets/js/core/common/$1',
    '^@network/(.*)$': '<rootDir>/network/$1',
    '^helios-distribution-types$': '<rootDir>/app/assets/js/core/common/DistributionClasses.js'
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.js'],
  transform: {},
  transformIgnorePatterns: [
    '/node_modules/(?!msw|until-async)',
  ],
  testPathIgnorePatterns: [
    '<rootDir>/tests/performance',
    '<rootDir>/tests/smoke',
  ],
};
