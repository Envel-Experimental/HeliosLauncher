// Manual mock for app/assets/js/processbuilder/classpath.js
const classpathArg = jest.fn().mockReturnValue(['/mocked_cp_from_manual_mock.jar'])

module.exports = {
    classpathArg
}
