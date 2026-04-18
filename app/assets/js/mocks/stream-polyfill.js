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
    }
    read() {}
    pause() { return this }
    resume() { return this }
}

class Writable extends Stream {
    constructor(options) {
        super()
    }
    write(chunk, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding
            encoding = 'utf-8'
        }
        if (callback) callback()
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
        if (callback) callback()
        this.emit('finish')
    }
}

class Duplex extends Readable {}
// Mixin Writable methods into Duplex
Object.assign(Duplex.prototype, Writable.prototype)

class Transform extends Duplex {
    constructor(options) {
        super(options)
    }
    _transform(chunk, encoding, callback) {
        callback(null, chunk)
    }
}

class PassThrough extends Transform {}

module.exports = {
    Stream,
    Readable,
    Writable,
    Duplex,
    Transform,
    PassThrough
}
