module.exports = {
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
    transformIgnorePatterns: [
    // Chai is now handled by babel-jest, so we can revert to default or keep it narrow.
    // Default is /node_modules/, which is usually fine when using Babel.
        '/node_modules/(?!helios-core|helios-distribution-types)/', // Example: if these also need transform
    ],
    moduleNameMapper: {
        '^@electron/remote$': '<rootDir>/test/mocks/electronRemote.js',
    },
}
