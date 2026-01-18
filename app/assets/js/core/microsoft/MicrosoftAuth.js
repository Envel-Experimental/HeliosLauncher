const { LoggerUtil } = require('../util/LoggerUtil')
const { RestResponseStatus, handleFetchError } = require('../common/RestResponse')
const { MicrosoftErrorCode, decipherErrorCode } = require('./MicrosoftResponse')
const { MICROSOFT_URLS } = require('../../config/constants')

class MicrosoftAuth {
    static logger = LoggerUtil.getLogger('MicrosoftAuth');

    static async getAccessToken(code, refresh, clientId) {
        try {
            const body = new URLSearchParams({
                client_id: clientId,
                scope: 'XboxLive.signin',
                redirect_uri: MICROSOFT_URLS.REDIRECT_URI,
                [refresh ? 'refresh_token' : 'code']: code,
                grant_type: refresh ? 'refresh_token' : 'authorization_code'
            });

            const res = await fetch(MICROSOFT_URLS.TOKEN, {
                method: 'POST',
                body: body,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            const data = await res.json();
             if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS
            };
        } catch (error) {
            return handleFetchError(`Get ${refresh ? 'Refresh' : 'Auth'} Token`, error, this.logger);
        }
    }

    static async getXBLToken(accessToken) {
        try {
            const res = await fetch(MICROSOFT_URLS.XBL_AUTH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    Properties: {
                        AuthMethod: 'RPS',
                        SiteName: 'user.auth.xboxlive.com',
                        RpsTicket: `d=${accessToken}`
                    },
                    RelyingParty: MICROSOFT_URLS.RELYING_PARTY_XBOX,
                    TokenType: 'JWT'
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS
            };
        } catch (error) {
            return handleFetchError('Get XBL Token', error, this.logger);
        }
    }

    static async getXSTSToken(xblResponse) {
        try {
            const res = await fetch(MICROSOFT_URLS.XSTS_AUTH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    Properties: {
                        SandboxId: 'RETAIL',
                        UserTokens: [xblResponse.Token]
                    },
                    RelyingParty: MICROSOFT_URLS.RELYING_PARTY_MC,
                    TokenType: 'JWT'
                })
            });
            const data = await res.json();
            if (!res.ok) {
                // Handle specific error codes
                const error = new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
                error.response = { body: data }; // For decipherErrorCode
                throw error;
            }

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS
            };
        } catch (error) {
            const response = await handleFetchError('Get XSTS Token', error, this.logger);
            if(error.response && error.response.body) {
                response.microsoftErrorCode = decipherErrorCode(error.response.body);
            } else {
                response.microsoftErrorCode = MicrosoftErrorCode.UNKNOWN;
            }
            return response;
        }
    }

    static async getMCAccessToken(xstsResponse) {
        try {
            const res = await fetch(MICROSOFT_URLS.MC_AUTH, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({
                    identityToken: `XBL3.0 x=${xstsResponse.DisplayClaims.xui[0].uhs};${xstsResponse.Token}`
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS
            };
        } catch (error) {
            return handleFetchError('Get MC Access Token', error, this.logger);
        }
    }

    static async getMCProfile(mcAccessToken) {
        try {
            const res = await fetch(MICROSOFT_URLS.MC_PROFILE, {
                headers: {
                    Authorization: `Bearer ${mcAccessToken}`
                }
            });
            const data = await res.json();
            if (!res.ok) {
                 if(res.status === 404) {
                     const r = { responseStatus: RestResponseStatus.ERROR, error: new Error('No Profile') };
                     r.microsoftErrorCode = MicrosoftErrorCode.NO_PROFILE;
                     return r;
                 }
                 throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
            }

            return {
                data: data,
                responseStatus: RestResponseStatus.SUCCESS
            };
        } catch (error) {
            return handleFetchError('Get MC Profile', error, this.logger);
        }
    }
}

module.exports = { MicrosoftAuth }
