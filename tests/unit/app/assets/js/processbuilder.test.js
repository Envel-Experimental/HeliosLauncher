const path = require('path')

describe('ProcessBuilder', () => {
    let ProcessBuilder
    let ConfigManager
    let fs

    beforeEach(() => {
        jest.resetModules()
        
        // Mock fs
        const mockFs = {
            mkdirSync: jest.fn(),
            existsSync: jest.fn(() => true),
            statSync: jest.fn(() => ({ isDirectory: () => false })),
            promises: {
                rm: jest.fn().mockResolvedValue(),
                mkdir: jest.fn().mockResolvedValue()
            }
        }
        jest.mock('fs', () => mockFs)
        jest.mock('fs/promises', () => mockFs.promises)

        jest.mock('../../../../../app/assets/js/preloader', () => ({
            sendToSentry: jest.fn(),
        }))

        // Correct path: tests/unit/app/assets/js/processbuilder.test.js -> core/configmanager
        jest.mock('../../../../../app/assets/js/core/configmanager', () => ({
            getMinRAM: jest.fn(),
            getMaxRAM: jest.fn(),
            getJVMOptions: jest.fn(),
            getGameWidth: jest.fn(),
            getGameHeight: jest.fn(),
            getFullscreen: jest.fn(),
            getAutoConnect: jest.fn(),
            getInstanceDirectorySync: jest.fn(() => '/mock/instances'),
            getCommonDirectorySync: jest.fn(() => '/mock/common'),
            fetchWithTimeout: jest.fn()
        }))

        ProcessBuilder = require('../../../../../app/assets/js/core/processbuilder')
        ConfigManager = require('../../../../../app/assets/js/core/configmanager')
        fs = require('fs')
    })

    test('should build arguments correctly', () => {
        ConfigManager.getMinRAM.mockReturnValue('1G')
        ConfigManager.getMaxRAM.mockReturnValue('2G')
        ConfigManager.getJVMOptions.mockReturnValue([])
        ConfigManager.getGameWidth.mockReturnValue(800)
        ConfigManager.getGameHeight.mockReturnValue(600)
        ConfigManager.getFullscreen.mockReturnValue(false)
        ConfigManager.getAutoConnect.mockReturnValue(false)

        const builder = new ProcessBuilder({ id: 'test', rawServer: { id: 'test' } }, { id: '1.12.2' }, {}, { displayName: 'Player' }, '1.0.0')
        expect(builder).toBeDefined()
        expect(builder.gameDir).toContain('test')
    })
})
