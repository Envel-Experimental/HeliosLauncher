const { LoggerUtil } = require('../util/LoggerUtil')
const { RestResponseStatus, handleFetchError } = require('../common/RestResponse')
const { MOJANG_URLS } = require('../../config/constants')

class MojangRestAPI {
    static logger = LoggerUtil.getLogger('MojangRestAPI');

    static async status() {
        const urls = MOJANG_URLS.STATUS;
        let lastError;

        for (const url of urls) {
            try {
                const res = await fetch(url);
                const data = await res.json();
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return {
                    data: data,
                    responseStatus: RestResponseStatus.SUCCESS
                }
            } catch (error) {
                lastError = error;
                this.logger.warn(`Failed to fetch Mojang status from ${url}: ${error.message}`);
            }
        }
        return handleFetchError('Mojang Status', lastError || new Error('All mirrors failed'), this.logger);
    }

    static getDefaultStatuses() {
        return [
            { name: 'Minecraft', status: 'grey' },
            { name: 'Minecraft Multiplayer', status: 'grey' },
            { name: 'Mojang Accounts', status: 'grey' },
            { name: 'Textures', status: 'grey' },
            { name: 'Auth Service', status: 'grey' },
            { name: 'Sessions', status: 'grey' },
            { name: 'API', status: 'grey' }
        ]
    }

    static statusToHex(status) {
        switch (status) {
            case 'green': return '#a5c325';
            case 'yellow': return '#eac918';
            case 'red': return '#c32625';
            case 'grey':
            default: return '#888';
        }
    }
}

module.exports = { MojangRestAPI }
