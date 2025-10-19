const AuthManager = require('@app/assets/js/authmanager');
const ConfigManager = require('@app/assets/js/configmanager');
const { MicrosoftAuth } = require('@envel/helios-core/microsoft');

jest.mock('@app/assets/js/configmanager', () => ({
    addMojangAuthAccount: jest.fn(),
    addMicrosoftAuthAccount: jest.fn(),
    removeAuthAccount: jest.fn(),
    save: jest.fn(),
}));

jest.mock('@envel/helios-core/microsoft', () => ({
    MicrosoftAuth: {
        getAccessToken: jest.fn(),
        getXBLToken: jest.fn(),
        getXSTSToken: jest.fn(),
        getMCAccessToken: jest.fn(),
        getMCProfile: jest.fn(),
    },
}));

describe('AuthManager', () => {
    it('should add a Mojang account', async () => {
        await AuthManager.addMojangAccount('testuser', 'testpass');
        expect(ConfigManager.addMojangAuthAccount).toHaveBeenCalledWith(
            expect.any(String),
            'offline-access-token',
            'testuser',
            'testuser'
        );
        expect(ConfigManager.save).toHaveBeenCalled();
    });

    it('should add a Microsoft account', async () => {
        MicrosoftAuth.getAccessToken.mockResolvedValue({
            responseStatus: 'SUCCESS',
            data: {
                access_token: 'test-ms-access-token',
                refresh_token: 'test-ms-refresh-token',
                expires_in: 3600,
            },
        });
        MicrosoftAuth.getXBLToken.mockResolvedValue({
            responseStatus: 'SUCCESS',
            data: 'test-xbl-token',
        });
        MicrosoftAuth.getXSTSToken.mockResolvedValue({
            responseStatus: 'SUCCESS',
            data: 'test-xsts-token',
        });
        MicrosoftAuth.getMCAccessToken.mockResolvedValue({
            responseStatus: 'SUCCESS',
            data: {
                access_token: 'test-mc-access-token',
                expires_in: 3600,
            },
        });
        MicrosoftAuth.getMCProfile.mockResolvedValue({
            responseStatus: 'SUCCESS',
            data: {
                id: 'test-mc-id',
                name: 'test-mc-name',
            },
        });

        await AuthManager.addMicrosoftAccount('test-auth-code');
        expect(ConfigManager.addMicrosoftAuthAccount).toHaveBeenCalledWith(
            'test-mc-id',
            'test-mc-access-token',
            'test-mc-name',
            expect.any(Number),
            'test-ms-access-token',
            'test-ms-refresh-token',
            expect.any(Number)
        );
        expect(ConfigManager.save).toHaveBeenCalled();
    });

    it('should remove a Mojang account', async () => {
        await AuthManager.removeMojangAccount('test-uuid');
        expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('test-uuid');
        expect(ConfigManager.save).toHaveBeenCalled();
    });

    it('should remove a Microsoft account', async () => {
        await AuthManager.removeMicrosoftAccount('test-uuid');
        expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('test-uuid');
        expect(ConfigManager.save).toHaveBeenCalled();
    });
});
