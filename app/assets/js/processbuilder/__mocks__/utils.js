// Manual mock for app/assets/js/processbuilder/utils.js
const getClasspathSeparator = jest.fn(() => (process.platform === 'win32' ? ';' : ':'))
const isModEnabled = jest.fn().mockReturnValue(true) // Default mock

module.exports = {
    getClasspathSeparator,
    isModEnabled
}
