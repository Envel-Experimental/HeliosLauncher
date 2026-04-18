const path = require('path');

describe('DistributionAPI', () => {
    let DistributionAPI;
    let HeliosDistribution;
    let fs;
    const launcherDirectory = '/mock/launcher';
    const commonDir = '/mock/common';
    const instanceDir = '/mock/instances';
    const remoteUrls = ['http://example.com/distribution.json'];

    let distributionAPI;

    beforeEach(() => {
        jest.resetModules();
        
        // Correct path: tests/unit/app/assets/js/core/common/DistributionAPI.test.js -> core/common/DistributionClasses
        jest.mock('../../../../../../../app/assets/js/core/common/DistributionClasses', () => ({
            HeliosDistribution: jest.fn().mockImplementation((data) => data)
        }));
        
        jest.mock('../../../../../../../app/assets/js/core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: () => ({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                })
            }
        }));

        // Mock fs/promises
        const mockFs = {
            access: jest.fn().mockResolvedValue(),
            readFile: jest.fn().mockResolvedValue('{}'),
            writeFile: jest.fn().mockResolvedValue(),
            mkdir: jest.fn().mockResolvedValue(),
        };
        jest.mock('fs/promises', () => mockFs);

        DistributionAPI = require('../../../../../../../app/assets/js/core/common/DistributionAPI').DistributionAPI;
        HeliosDistribution = require('../../../../../../../app/assets/js/core/common/DistributionClasses').HeliosDistribution;
        fs = require('fs/promises');
        global.fetch = jest.fn();

        distributionAPI = new DistributionAPI(launcherDirectory, commonDir, instanceDir, remoteUrls, false);
    });

    describe('getDistribution', () => {
        it('should load distribution if not already loaded', async () => {
            const mockDistroData = { servers: [] };
            distributionAPI.pullRemote = jest.fn().mockResolvedValue({ data: mockDistroData });
            distributionAPI.writeDistributionToDisk = jest.fn().mockResolvedValue();

            await distributionAPI.getDistribution();

            expect(distributionAPI.pullRemote).toHaveBeenCalled();
            expect(HeliosDistribution).toHaveBeenCalled();
        });
    });

    describe('pullLocal', () => {
        it('should read from file', async () => {
            const mockData = { version: '1.0.0' };
            fs.access.mockResolvedValue();
            fs.readFile.mockResolvedValue(JSON.stringify(mockData));

            const result = await distributionAPI.pullLocal();
            expect(result).toEqual(mockData);
        });
    });
});
