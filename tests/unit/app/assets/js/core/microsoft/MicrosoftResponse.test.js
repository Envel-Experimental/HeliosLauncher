const { MicrosoftErrorCode, decipherErrorCode } = require('../../../../../../../app/assets/js/core/microsoft/MicrosoftResponse')

describe('MicrosoftResponse', () => {
    describe('decipherErrorCode', () => {
        it('should return NO_XBOX_ACCOUNT for code 2148916233', () => {
            expect(decipherErrorCode({ XErr: 2148916233 })).toBe(MicrosoftErrorCode.NO_XBOX_ACCOUNT)
        })

        it('should return XBL_BANNED for code 2148916235', () => {
            expect(decipherErrorCode({ XErr: 2148916235 })).toBe(MicrosoftErrorCode.XBL_BANNED)
        })

        it('should return UNDER_18 for code 2148916238', () => {
            expect(decipherErrorCode({ XErr: 2148916238 })).toBe(MicrosoftErrorCode.UNDER_18)
        })

        it('should return UNKNOWN for unknown code', () => {
            expect(decipherErrorCode({ XErr: 999 })).toBe(MicrosoftErrorCode.UNKNOWN)
        })

        it('should return UNKNOWN for empty body', () => {
            expect(decipherErrorCode(null)).toBe(MicrosoftErrorCode.UNKNOWN)
            expect(decipherErrorCode({})).toBe(MicrosoftErrorCode.UNKNOWN)
        })
    })
})
