const events = require('./events')

class Zlib extends events.EventEmitter {
    constructor() { super() }
    write() { return this }
    end() { return this }
    flush() { return this }
}

module.exports = {
    createGzip: () => new Zlib(),
    createGunzip: () => new Zlib(),
    createDeflate: () => new Zlib(),
    createInflate: () => new Zlib(),
    gzipSync: (v) => v,
    gunzipSync: (v) => v,
    inflateSync: (v) => v,
    deflateSync: (v) => v
}
