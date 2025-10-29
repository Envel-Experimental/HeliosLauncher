const { MojangIndexProcessor } = require('@envel/helios-core/dl')
const landing = require('../../../../../../app/assets/js/scripts/landing')

jest.mock('@envel/helios-core/dl', () => ({
    MojangIndexProcessor: jest.fn().mockImplementation(() => ({
        getVersionJson: jest.fn(),
        getLocalVersionJson: jest.fn(),
    })),
}))

describe('Landing', () => {
    it('should fall back to local version json on remote failure', async () => {
        const mockError = new Error('Network error')
        const mockLocalVersionJson = { id: '1.12.2' }

        const mockMojangIndexProcessor = new MojangIndexProcessor()
        mockMojangIndexProcessor.getVersionJson.mockRejectedValue(mockError)
        mockMojangIndexProcessor.getLocalVersionJson.mockResolvedValue(mockLocalVersionJson)

        landing.dlAsync(false)

        expect(mockMojangIndexProcessor.getVersionJson).toHaveBeenCalled()
        expect(mockMojangIndexProcessor.getLocalVersionJson).toHaveBeenCalled()
    })
})
