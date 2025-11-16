const os = require('os');
const { isAppleM } = require('../app/assets/js/sysutil');

jest.mock('os');

describe('isAppleM', () => {
  it('should return true if os is darwin and arch is arm64', () => {
    os.platform.mockReturnValue('darwin');
    os.arch.mockReturnValue('arm64');
    expect(isAppleM()).toBe(true);
  });

  it('should return false if os is not darwin', () => {
    os.platform.mockReturnValue('win32');
    os.arch.mockReturnValue('arm64');
    expect(isAppleM()).toBe(false);
  });

  it('should return false if arch is not arm64', () => {
    os.platform.mockReturnValue('darwin');
    os.arch.mockReturnValue('x64');
    expect(isAppleM()).toBe(false);
  });
});
