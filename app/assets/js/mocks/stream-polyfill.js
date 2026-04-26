/**
 * Functional Stream Polyfill for the Renderer.
 */

const EventEmitter = require('events')

class Stream extends EventEmitter {
    constructor() {
        super()
    }
    pipe(dest, options) {
        this.on('data', (chunk) => dest.write(chunk))
        this.on('end', () => dest.end())
        return dest
    }
}

class Readable extends Stream {
    constructor(options) {
        super()
        if (options && options.read) this._read = options.read
    }
    _read() {}
    read() { this._read() }
    pause() { return this }
    resume() { return this }

    static fromWeb(webStream) {
        const reader = webStream.getReader()
        const stream = new Readable()
        async function pump() {
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                        stream.emit('end')
                        break
                    }
                    stream.emit('data', Buffer.from(value))
                }
            } catch (err) {
                stream.emit('error', err)
            }
        }
        pump()
        return stream
    }
}

class Writable extends Stream {
    constructor(options) {
        super()
        if (options && options.write) this._write = options.write
        if (options && options.final) this._final = options.final
    }
    _write(chunk, encoding, callback) { callback() }
    _final(callback) { callback() }
    
    write(chunk, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding
            encoding = 'utf-8'
        }
        this._write(chunk, encoding, callback || (() => {}))
        return true
    }
    end(chunk, encoding, callback) {
        if (typeof chunk === 'function') {
            callback = chunk
            chunk = null
        } else if (typeof encoding === 'function') {
            callback = encoding
            encoding = 'utf-8'
        }
        if (chunk) this.write(chunk, encoding)
        this._final(() => {
            if (callback) callback()
            this.emit('finish')
        })
    }
}

class Duplex extends Readable {}
// Mixin Writable methods into Duplex
Object.assign(Duplex.prototype, Writable.prototype)

class Transform extends Duplex {
    constructor(options) {
        super(options)
        if (options && options.transform) this._transform = options.transform
    }
    _transform(chunk, encoding, callback) {
        callback(null, chunk)
    }
    write(chunk, encoding, callback) {
        this._transform(chunk, encoding, (err, data) => {
            if (data) this.emit('data', data)
            if (callback) callback(err)
        })
        return true
    }
}

class PassThrough extends Transform {}

async function pipeline(...streams) {
    return new Promise((resolve, reject) => {
        for (let i = 0; i < streams.length - 1; i++) {
            streams[i].pipe(streams[i + 1])
            streams[i].on('error', reject)
        }
        const last = streams[streams.length - 1]
        last.on('finish', resolve)
        last.on('error', reject)
    })
}

module.exports = {
    Stream,
    Readable,
    Writable,
    Duplex,
    Transform,
    PassThrough,
    pipeline
}
