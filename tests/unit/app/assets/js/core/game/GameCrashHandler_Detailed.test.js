const path = require('path')

describe('GameCrashHandler Detailed Tests', () => {
    let GameCrashHandler
    let fs
    let CrashHandler
    let ConfigManager
    let Lang
    let electron
    let os

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('fs', () => ({
            existsSync: jest.fn(),
            rmSync: jest.fn(),
            unlinkSync: jest.fn(),
            renameSync: jest.fn(),
            promises: {
                stat: jest.fn(),
                readdir: jest.fn(),
                readFile: jest.fn()
            }
        }))

        jest.doMock('electron', () => ({
            shell: { openExternal: jest.fn() },
            ipcMain: { once: jest.fn(), emit: jest.fn() },
            BrowserWindow: jest.fn()
        }))

        jest.doMock('os', () => ({
            totalmem: jest.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
            freemem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
            platform: jest.fn().mockReturnValue('win32'),
            release: jest.fn().mockReturnValue('10.0.0'),
            arch: jest.fn().mockReturnValue('x64')
        }))

        jest.doMock('@core/crash-handler', () => ({
            analyzeFile: jest.fn(),
            analyzeLog: jest.fn()
        }))

        jest.doMock('@core/configmanager', () => ({
            getSupportUrl: jest.fn().mockReturnValue('http://support.com'),
            getJavaExecutable: jest.fn(),
            setJavaExecutable: jest.fn(),
            getDataDirectory: jest.fn().mockReturnValue('/mock/data'),
            getModConfiguration: jest.fn(),
            setModConfiguration: jest.fn(),
            save: jest.fn()
        }))

        jest.doMock('@core/langloader', () => ({
            queryJS: jest.fn((key) => key)
        }))

        jest.doMock('@core/util/LoggerUtil', () => ({
            LoggerUtil: {
                getLogger: jest.fn(() => ({
                    info: jest.fn(),
                    warn: jest.fn(),
                    error: jest.fn(),
                    debug: jest.fn()
                }))
            }
        }))

        // Mock WindowManager to avoid complex electron window logic
        jest.doMock('../../../../main/WindowManager', () => ({
            getMainWindow: jest.fn().mockReturnValue({
                isDestroyed: () => false,
                webContents: { send: jest.fn() }
            })
        }), { virtual: true })

        GameCrashHandler = require('@core/game/GameCrashHandler')
        fs = require('fs')
        CrashHandler = require('@core/crash-handler')
        ConfigManager = require('@core/configmanager')
        Lang = require('@core/langloader')
        electron = require('electron')
        os = require('os')
    })

    const mockServer = {
        rawServer: { id: 'test-server', minecraftVersion: '1.17.1' },
        modules: []
    }

    test('handleExit should ignore non-crash codes', async () => {
        const handler = new GameCrashHandler('/game', '/common', mockServer, [])
        const analyzeSpy = jest.spyOn(handler, 'analyzeCrash')
        
        await handler.handleExit(0) // Success
        expect(analyzeSpy).not.toHaveBeenCalled()

        await handler.handleExit(143) // SIGTERM
        expect(analyzeSpy).not.toHaveBeenCalled()
    })

    test('handleExit should trigger analysis on crash', async () => {
        const handler = new GameCrashHandler('/game', '/common', mockServer, [])
        CrashHandler.analyzeFile.mockResolvedValue({ type: 'unknown' })
        
        const showSpy = jest.spyOn(handler, 'showSpecificCrashOverlay').mockResolvedValue()
        
        await handler.handleExit(1)
        expect(showSpy).toHaveBeenCalled()
    })

    test('analyzeCrash should fall back to memory buffer if disk fails', async () => {
        const logBuffer = ['line 1', 'line 2']
        const handler = new GameCrashHandler('/game', '/common', mockServer, logBuffer)
        
        // Disk analysis fails
        CrashHandler.analyzeFile.mockRejectedValue(new Error('ENOENT'))
        fs.promises.stat.mockRejectedValue(new Error('ENOENT'))
        
        // Memory analysis
        CrashHandler.analyzeLog.mockReturnValue({ type: 'oom' })

        const res = await handler.analyzeCrash()
        expect(res.type).toBe('oom')
        expect(CrashHandler.analyzeLog).toHaveBeenCalledWith('line 1\nline 2')
    })

    test('enrichOOMAnalysis should provide advice based on memory', () => {
        const handler = new GameCrashHandler('/game', '/common', mockServer, [])
        const analysis = { type: 'java-oom' }
        
        os.totalmem.mockReturnValue(4 * 1024 * 1024 * 1024) // 4GB total
        handler.enrichOOMAnalysis(analysis)
        expect(analysis.description).toContain('Мало оперативной памяти')

        os.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024) // 16GB total
        os.freemem.mockReturnValue(1 * 1024 * 1024 * 1024) // 1GB free
        handler.enrichOOMAnalysis(analysis)
        expect(analysis.description).toContain('Мало свободной')
    })

    test('handleJavaRepair should delete managed java directory', () => {
        const handler = new GameCrashHandler('/game', '/common', mockServer, [])
        ConfigManager.getJavaExecutable.mockReturnValue('/mock/data/runtime/x64/java-17/bin/java.exe')
        fs.existsSync.mockReturnValue(true)

        handler.handleJavaRepair()

        expect(fs.rmSync).toHaveBeenCalledWith(
            expect.stringContaining(path.join('runtime', 'x64', 'java-17')),
            expect.any(Object)
        )
        expect(ConfigManager.setJavaExecutable).toHaveBeenCalledWith('test-server', null)
    })
})
