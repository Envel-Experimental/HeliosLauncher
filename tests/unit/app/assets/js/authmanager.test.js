const AuthManager = require('@app/assets/js/authmanager');
const ConfigManager = require('@app/assets/js/configmanager');
const { MicrosoftAuth } = require('@app/assets/js/core/microsoft/MicrosoftAuth');
const { RestResponseStatus } = require('@app/assets/js/core/common/RestResponse');
const { MicrosoftErrorCode } = require('@app/assets/js/core/microsoft/MicrosoftResponse');

jest.mock('@app/assets/js/configmanager', () => ({
    addMojangAuthAccount: jest.fn(),
    addMicrosoftAuthAccount: jest.fn(),
    updateMicrosoftAuthAccount: jest.fn(),
    removeAuthAccount: jest.fn(),
    save: jest.fn(),
    getSelectedAccount: jest.fn(),
}));

jest.mock('@app/assets/js/core/microsoft/MicrosoftAuth', () => ({
    MicrosoftAuth: {
        getAccessToken: jest.fn(),
        getXBLToken: jest.fn(),
        getXSTSToken: jest.fn(),
        getMCAccessToken: jest.fn(),
        getMCProfile: jest.fn(),
    }
}));

jest.mock('@app/assets/js/langloader', () => ({
    queryJS: jest.fn((key) => key),
}));

jest.mock('@app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: jest.fn(() => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        }))
    }
}));

describe('AuthManager', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Mojang Account', () => {
        it('should add a Mojang account', async () => {
            const mockAccount = { uuid: 'offline-uuid', type: 'mojang' };
            ConfigManager.addMojangAuthAccount.mockReturnValue(mockAccount);

            const ret = await AuthManager.addMojangAccount('testuser', 'testpass');

            expect(ConfigManager.addMojangAuthAccount).toHaveBeenCalledWith(
                expect.any(String),
                'offline-access-token',
                'testuser',
                'testuser'
            );
            expect(ConfigManager.save).toHaveBeenCalled();
            expect(ret).toBe(mockAccount);
        });

        it('should remove a Mojang account', async () => {
            ConfigManager.removeAuthAccount.mockReturnValue(true);
            await AuthManager.removeMojangAccount('test-uuid');
            expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('test-uuid');
            expect(ConfigManager.save).toHaveBeenCalled();
        });

        it('should handle error when removing Mojang account fails', async () => {
            ConfigManager.removeAuthAccount.mockImplementation(() => { throw new Error('Failed'); });
            await expect(AuthManager.removeMojangAccount('test-uuid')).rejects.toThrow('Failed');
        });
    });

    describe('Microsoft Account', () => {
        const mockAuthData = {
            accessToken: { access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 },
            xbl: { Token: 'xbl-token' },
            xsts: { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'userhash' }] } },
            mcToken: { access_token: 'mc-access', expires_in: 86400 },
            mcProfile: { id: 'mc-uuid', name: 'mc-name' }
        };

        const setupMicrosoftAuthMocks = (success = true, errorCode = null) => {
            if (success) {
                MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: mockAuthData.accessToken });
                MicrosoftAuth.getXBLToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: mockAuthData.xbl });
                MicrosoftAuth.getXSTSToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: mockAuthData.xsts });
                MicrosoftAuth.getMCAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: mockAuthData.mcToken });
                MicrosoftAuth.getMCProfile.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: mockAuthData.mcProfile });
            } else {
                MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.ERROR, microsoftErrorCode: errorCode || MicrosoftErrorCode.UNKNOWN });
            }
        };

        it('should add a Microsoft account successfully', async () => {
            setupMicrosoftAuthMocks(true);
            const mockAccount = { uuid: 'mc-uuid', type: 'microsoft' };
            ConfigManager.addMicrosoftAuthAccount.mockReturnValue(mockAccount);

            const ret = await AuthManager.addMicrosoftAccount('auth-code');

            expect(MicrosoftAuth.getAccessToken).toHaveBeenCalledWith('auth-code', false, expect.any(String));
            expect(MicrosoftAuth.getXBLToken).toHaveBeenCalledWith('ms-access');
            expect(MicrosoftAuth.getXSTSToken).toHaveBeenCalledWith(mockAuthData.xbl);
            expect(MicrosoftAuth.getMCAccessToken).toHaveBeenCalledWith(mockAuthData.xsts);
            expect(MicrosoftAuth.getMCProfile).toHaveBeenCalledWith('mc-access');

            expect(ConfigManager.addMicrosoftAuthAccount).toHaveBeenCalledWith(
                'mc-uuid',
                'mc-access',
                'mc-name',
                expect.any(Number),
                'ms-access',
                'ms-refresh',
                expect.any(Number)
            );
            expect(ConfigManager.save).toHaveBeenCalled();
            expect(ret).toBe(mockAccount);
        });

        it('should fail to add Microsoft account if auth flow fails', async () => {
            setupMicrosoftAuthMocks(false, MicrosoftErrorCode.UNKNOWN);
            await expect(AuthManager.addMicrosoftAccount('auth-code')).rejects.toEqual(expect.objectContaining({ title: expect.stringContaining('unknownTitle') }));
        });

        it('should remove a Microsoft account', async () => {
             ConfigManager.removeAuthAccount.mockReturnValue(true);
             await AuthManager.removeMicrosoftAccount('test-uuid');
             expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('test-uuid');
             expect(ConfigManager.save).toHaveBeenCalled();
        });
    });

    describe('validateSelected', () => {
        it('should validate a Mojang account (always true)', async () => {
            ConfigManager.getSelectedAccount.mockReturnValue({ type: 'mojang', uuid: 'mojang-uuid' });
            const result = await AuthManager.validateSelected();
            expect(result).toBe(true);
        });

        it('should validate a Microsoft account (valid)', async () => {
            ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'ms-uuid',
                expiresAt: Date.now() + 100000,
                microsoft: { expires_at: Date.now() + 100000 }
            });
            const result = await AuthManager.validateSelected();
            expect(result).toBe(true);
        });

        it('should refresh MC token if expired but MS token is valid', async () => {
             ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'ms-uuid',
                expiresAt: Date.now() - 1000, // MC Expired
                microsoft: { expires_at: Date.now() + 100000, access_token: 'ms-access', refresh_token: 'ms-refresh' }
            });

             // Mock MC Refresh flow (skipping getAccessToken)
             MicrosoftAuth.getXBLToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: 'xbl' });
             MicrosoftAuth.getXSTSToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: 'xsts' });
             MicrosoftAuth.getMCAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: { access_token: 'new-mc-access', expires_in: 3600 } });
             MicrosoftAuth.getMCProfile.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: { id: 'mc-id' } });

             const result = await AuthManager.validateSelected();

             expect(result).toBe(true);
             expect(MicrosoftAuth.getAccessToken).not.toHaveBeenCalled(); // Should assume valid MS token
             expect(ConfigManager.updateMicrosoftAuthAccount).toHaveBeenCalled();
        });

         it('should refresh MS token if both expired', async () => {
             ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'ms-uuid',
                expiresAt: Date.now() - 1000, // MC Expired
                microsoft: { expires_at: Date.now() - 1000, access_token: 'ms-access', refresh_token: 'ms-refresh' }
            });

             // Mock Full Refresh flow
             MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: { access_token: 'new-ms-access', refresh_token: 'new-ms-refresh', expires_in: 3600 } });
             MicrosoftAuth.getXBLToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: 'xbl' });
             MicrosoftAuth.getXSTSToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: 'xsts' });
             MicrosoftAuth.getMCAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: { access_token: 'new-mc-access', expires_in: 3600 } });
             MicrosoftAuth.getMCProfile.mockResolvedValue({ responseStatus: RestResponseStatus.SUCCESS, data: { id: 'mc-id' } });

             const result = await AuthManager.validateSelected();

             expect(result).toBe(true);
             expect(MicrosoftAuth.getAccessToken).toHaveBeenCalledWith('ms-refresh', true, expect.any(String));
             expect(ConfigManager.updateMicrosoftAuthAccount).toHaveBeenCalled();
        });

         it('should fail validation if refresh fails', async () => {
             ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'ms-uuid',
                expiresAt: Date.now() - 1000,
                microsoft: { expires_at: Date.now() - 1000, refresh_token: 'ms-refresh' }
            });

             MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: RestResponseStatus.ERROR, microsoftErrorCode: MicrosoftErrorCode.UNKNOWN });

             const result = await AuthManager.validateSelected();
             expect(result).toBe(false);
         });
    });
});
