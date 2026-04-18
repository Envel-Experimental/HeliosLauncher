const events = require('./events')
const stream = require('./stream-polyfill')

// Simple functional mock for http(s) using fetch
// This allows Playwright to intercept requests made via require('http')

class IncomingMessage extends stream.Readable {
    constructor(response, buffer) {
        super()
        this.statusCode = response.status
        this.statusMessage = response.statusText
        this.headers = {}
        response.headers.forEach((v, k) => {
            this.headers[k.toLowerCase()] = v
        })
        this.rawHeaders = []
        response.headers.forEach((v, k) => {
            this.rawHeaders.push(k, v)
        })
        
        // Push data to stream
        if (buffer) {
            this.push(window.Buffer.from(buffer))
        }
        this.push(null)
    }
}

class ClientRequest extends events.EventEmitter {
    constructor(url, options = {}, cb) {
        super()
        this.url = url
        this.options = options
        this.cb = cb
        
        // Defer execution to allow event listeners to be attached
        setTimeout(() => this._perform(), 0)
    }

    async _perform() {
        try {
            const response = await fetch(this.url, {
                method: this.options.method || 'GET',
                headers: this.options.headers || {}
            })
            
            const buffer = await response.arrayBuffer()
            const incoming = new IncomingMessage(response, buffer)
            
            if (this.cb) this.cb(incoming)
            this.emit('response', incoming)
        } catch (err) {
            this.emit('error', err)
        }
    }

    end() { return this }
    write() { return this }
    abort() { /* no-op */ }
}

const mock = {
    request: (url, options, cb) => {
        if (typeof url === 'string') {
            return new ClientRequest(url, options, cb)
        } else {
            // node-style: options first
            const finalUrl = url.href || (url.protocol + '//' + url.host + url.path)
            return new ClientRequest(finalUrl, url, options)
        }
    },
    get: (url, options, cb) => {
        if (typeof options === 'function') {
            cb = options
            options = {}
        }
        const req = mock.request(url, { ...options, method: 'GET' }, cb)
        return req
    },
    Agent: class {},
    ClientRequest,
    IncomingMessage,
    METHODS: ['GET', 'POST', 'PUT', 'DELETE'],
    STATUS_CODES: { 200: 'OK', 404: 'Not Found' }
}

module.exports = mock
