const { DistributionAPI } = require('@envel/helios-core/common');
const ConfigManager = require('@app/assets/js/configmanager');

jest.mock('@envel/helios-core/common', () => ({
    DistributionAPI: jest.fn(),
}));

jest.mock('@app/assets/js/configmanager', () => ({
    getLauncherDirectory: jest.fn(() => 'test-dir'),
}));

const DistroManager = require('@app/assets/js/distromanager');

describe('DistroManager', () => {
    it('should initialize the DistributionAPI with the correct values', () => {
        expect(DistributionAPI).toHaveBeenCalledWith(
            'test-dir',
            null,
            null,
            'https://f-launcher.ru/fox/new/distribution.json',
            false
        );
    });

    it('should export the DistroAPI', () => {
        expect(DistroManager.DistroAPI).toBeDefined();
    });
});
