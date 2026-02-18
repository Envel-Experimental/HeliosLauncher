const { DistributionAPI } = require('@app/assets/js/core/common/DistributionAPI');
const { HeliosDistribution } = require('@app/assets/js/core/common/DistributionClasses');
const fs = require('fs/promises');

// Mock dependencies
jest.mock('fs/promises');
jest.mock('@app/assets/js/core/common/DistributionClasses');
jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: () => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        })
    }
}));

// Mock global fetch
global.fetch = jest.fn();

describe('DistributionAPI', () => {
    const launcherDirectory = '/mock/launcher';
    const commonDir = '/mock/common';
    const instanceDir = '/mock/instances';
    const remoteUrls = ['http://example.com/distribution.json'];

    let distributionAPI;

    beforeEach(() => {
        jest.clearAllMocks();
        distributionAPI = new DistributionAPI(launcherDirectory, commonDir, instanceDir, remoteUrls, false);
    });

    describe('getDistribution', () => {
        it('should load distribution if not already loaded', async () => {
            const mockDistroData = { servers: [] };
            // Mock loadDistribution implementation via spy or mocking internal methods
            // Since we can't easily mock internal async methods without prototype spying, 
            // we'll mock the internal calls or the side effects.

            // Let's mock pullRemote to return data
            distributionAPI.pullRemote = jest.fn().mockResolvedValue({ data: mockDistroData });
            distributionAPI.writeDistributionToDisk = jest.fn().mockResolvedValue();

            await distributionAPI.getDistribution();

            expect(distributionAPI.pullRemote).toHaveBeenCalled();
            expect(HeliosDistribution).toHaveBeenCalledWith(mockDistroData, commonDir, instanceDir);
        });

        it('should use cached distribution if available', async () => {
            const mockDistroData = { servers: [] };
            distributionAPI.rawDistribution = mockDistroData;
            distributionAPI.distribution = {}; // Mock distribution object

            await distributionAPI.getDistribution();

            expect(global.fetch).not.toHaveBeenCalled();
        });
    });

    describe('toggleDevMode', () => {
        it('should toggle dev mode', () => {
            expect(distributionAPI.isDevMode()).toBe(false);
            distributionAPI.toggleDevMode(true);
            expect(distributionAPI.isDevMode()).toBe(true);
        });
    });

    describe('pullRemote', () => {
        it('should fetch from valid url', async () => {
            const mockData = { version: '1.0.0' };
            global.fetch.mockResolvedValue({
                ok: true,
                arrayBuffer: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify(mockData))),
                status: 200
            });

            const result = await distributionAPI.pullRemote();

            expect(result.data).toEqual(mockData);
        });

        it('should handle fetch errors', async () => {
            global.fetch.mockRejectedValue(new Error('Network error'));

            const result = await distributionAPI.pullRemote();

            expect(result.responseStatus).toBe('ERROR');
            expect(result.error.message).toBe('Network error');
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

        it('should return null if file does not exist', async () => {
            fs.access.mockRejectedValue(new Error('ENOENT'));

            const result = await distributionAPI.pullLocal();

            expect(result).toBeNull();
        });
    });
});
