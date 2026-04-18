const events = require('./events')

class Socket extends events.EventEmitter {
    constructor() {
        super()
        this.bufferSize = 0
        this.remoteAddress = '127.0.0.1'
    }
    connect() { return this }
    write() { return true }
    end() { return this }
    destroy() { return this }
    setTimeout() { return this }
    setNoDelay() { return this }
    setKeepAlive() { return this }
    pause() { return this }
    resume() { return this }
}

module.exports = {
    Socket,
    createConnection: () => new Socket(),
    connect: () => new Socket(),
    isIP: () => 4
}
