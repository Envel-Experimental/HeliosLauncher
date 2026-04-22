describe('AuthManager Detailed Tests', () => {
    let AuthManager
    let ConfigManager
    let MicrosoftAuth
    let RestResponseStatus
    let MicrosoftErrorCode

    beforeEach(() => {
        jest.resetModules()

        // Mock Dependencies
        jest.doMock('@core/configmanager', () => ({
            addMojangAuthAccount: jest.fn().mockReturnValue({ uuid: 'mojang-uuid' }),
            addMicrosoftAuthAccount: jest.fn().mockReturnValue({ uuid: 'microsoft-uuid' }),
            removeAuthAccount: jest.fn(),
            save: jest.fn().mockResolvedValue(),
            getSelectedAccount: jest.fn(),
            updateMicrosoftAuthAccount: jest.fn()
        }))

        const mockMicrosoftAuth = {
            getAccessToken: jest.fn(),
            getXBLToken: jest.fn(),
            getXSTSToken: jest.fn(),
            getMCAccessToken: jest.fn(),
            getMCProfile: jest.fn()
        }
        jest.doMock('@core/microsoft/MicrosoftAuth', () => ({
            MicrosoftAuth: mockMicrosoftAuth
        }))

        jest.doMock('@core/common/RestResponse', () => ({
            RestResponseStatus: { SUCCESS: 'SUCCESS', ERROR: 'ERROR' }
        }))

        jest.doMock('@core/microsoft/MicrosoftResponse', () => ({
            MicrosoftErrorCode: {
                UNKNOWN: 'UNKNOWN',
                NO_PROFILE: 'NO_PROFILE',
                NO_XBOX_ACCOUNT: 'NO_XBOX_ACCOUNT',
                XBL_BANNED: 'XBL_BANNED',
                UNDER_18: 'UNDER_18'
            }
        }))

        jest.doMock('@core/ipcconstants', () => ({
            AZURE_CLIENT_ID: 'mock-client-id'
        }))

        jest.doMock('@core/langloader', () => ({
            queryJS: jest.fn((key) => key)
        }))

        jest.doMock('@core/util', () => ({
            retry: jest.fn((fn) => fn())
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

        AuthManager = require('@core/authmanager')
        ConfigManager = require('@core/configmanager')
        MicrosoftAuth = require('@core/microsoft/MicrosoftAuth').MicrosoftAuth
        RestResponseStatus = require('@core/common/RestResponse').RestResponseStatus
        MicrosoftErrorCode = require('@core/microsoft/MicrosoftResponse').MicrosoftErrorCode
    })

    describe('Mojang Account', () => {
        test('addMojangAccount should save and return account', async () => {
            const res = await AuthManager.addMojangAccount('Player', 'pass')
            expect(res.uuid).toBe('mojang-uuid')
            expect(ConfigManager.save).toHaveBeenCalled()
        })

        test('removeMojangAccount should remove and save', async () => {
            await AuthManager.removeMojangAccount('uuid')
            expect(ConfigManager.removeAuthAccount).toHaveBeenCalledWith('uuid')
            expect(ConfigManager.save).toHaveBeenCalled()
        })
    })

    describe('Microsoft Account', () => {
        const mockAuthFlow = () => {
            MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: 'SUCCESS', data: { access_token: 'at', expires_in: 3600, refresh_token: 'rt' } })
            MicrosoftAuth.getXBLToken.mockResolvedValue({ responseStatus: 'SUCCESS', data: 'xbl' })
            MicrosoftAuth.getXSTSToken.mockResolvedValue({ responseStatus: 'SUCCESS', data: 'xsts' })
            MicrosoftAuth.getMCAccessToken.mockResolvedValue({ responseStatus: 'SUCCESS', data: { access_token: 'mc_at', expires_in: 3600 } })
            MicrosoftAuth.getMCProfile.mockResolvedValue({ responseStatus: 'SUCCESS', data: { id: 'uuid', name: 'Player' } })
        }

        test('addMicrosoftAccount should handle NO_PROFILE by using Gamertag', async () => {
            mockAuthFlow()
            MicrosoftAuth.getXSTSToken.mockResolvedValue({
                responseStatus: 'SUCCESS',
                data: { DisplayClaims: { xui: [{ gtg: 'Gamertag' }] } }
            })
            MicrosoftAuth.getMCProfile.mockResolvedValue({
                responseStatus: 'ERROR',
                microsoftErrorCode: 'NO_PROFILE'
            })

            await AuthManager.addMicrosoftAccount('code')

            expect(ConfigManager.addMicrosoftAuthAccount).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                'Gamertag',
                expect.any(Number),
                expect.any(String),
                expect.any(String),
                expect.any(Number)
            )
        })

        test('validateSelected should refresh MS token if MS expired', async () => {
            const now = Date.now()
            ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'uuid',
                expiresAt: now - 1000,
                microsoft: {
                    expires_at: now - 1000, // MS Expired
                    refresh_token: 'rt'
                }
            })

            mockAuthFlow()
            const res = await AuthManager.validateSelected()
            expect(res).toBe(true)
            expect(MicrosoftAuth.getAccessToken).toHaveBeenCalledWith('rt', true, 'mock-client-id')
        })

        test('addMicrosoftAccount should throw for BANNED user', async () => {
            mockAuthFlow()
            MicrosoftAuth.getXSTSToken.mockResolvedValue({
                responseStatus: 'ERROR',
                microsoftErrorCode: 'XBL_BANNED'
            })

            await expect(AuthManager.addMicrosoftAccount('code'))
                .rejects.toMatchObject({ title: 'auth.microsoft.error.xblBannedTitle' })
        })

        test('addMicrosoftAccount should throw for UNDER_18 user', async () => {
            mockAuthFlow()
            MicrosoftAuth.getXSTSToken.mockResolvedValue({
                responseStatus: 'ERROR',
                microsoftErrorCode: 'UNDER_18'
            })

            await expect(AuthManager.addMicrosoftAccount('code'))
                .rejects.toMatchObject({ title: 'auth.microsoft.error.under18Title' })
        })

        test('validateSelected should return false if MS refresh fails', async () => {
            const now = Date.now()
            ConfigManager.getSelectedAccount.mockReturnValue({
                type: 'microsoft',
                uuid: 'uuid',
                expiresAt: now - 1000,
                microsoft: {
                    expires_at: now - 1000,
                    refresh_token: 'rt'
                }
            })

            mockAuthFlow()
            MicrosoftAuth.getAccessToken.mockResolvedValue({ responseStatus: 'ERROR' })

            const res = await AuthManager.validateSelected()
            expect(res).toBe(false)
        })
    })
})
