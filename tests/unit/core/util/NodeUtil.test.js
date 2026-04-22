// Mock OS platform before anything else
jest.mock('os', () => ({
    hostname: jest.fn().mockReturnValue('test-host'),
    platform: jest.fn()
}))

const os = require('os')
const NodeUtil = require('../../../../app/assets/js/core/util/NodeUtil')

describe('NodeUtil', () => {
    
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('should sleep', async () => {
        const start = Date.now()
        await NodeUtil.sleep(50)
        const end = Date.now()
        expect(end - start).toBeGreaterThanOrEqual(40)
    })

    it('should encode paths (replace backslashes)', () => {
        expect(NodeUtil.ensureEncodedPath('C:\\path\\to\\file')).toBe('C:/path/to/file')
    })

    describe('ensureDecodedPath', () => {
        it('should handle win32 paths', () => {
            os.platform.mockReturnValue('win32')
            expect(NodeUtil.ensureDecodedPath('C:/path/to/file')).toBe('C:\\path\\to\\file')
        })

        it('should handle unix paths', () => {
            os.platform.mockReturnValue('linux')
            expect(NodeUtil.ensureDecodedPath('/home/user/file')).toBe('/home/user/file')
        })

        it('should decode file URLs', () => {
            os.platform.mockReturnValue('win32')
            const decoded = NodeUtil.ensureDecodedPath('file:///C:/path/to/file')
            expect(decoded.toLowerCase()).toContain('c:')
        })
    })

    describe('pLimit', () => {
        it('should limit concurrency', async () => {
            const limit = NodeUtil.pLimit(2)
            let activeTasks = 0
            let maxActive = 0

            const task = async () => {
                activeTasks++
                maxActive = Math.max(maxActive, activeTasks)
                await NodeUtil.sleep(50)
                activeTasks--
            }

            await Promise.all([limit(task), limit(task), limit(task), limit(task)])
            expect(maxActive).toBeLessThanOrEqual(2)
        })
    })
})
