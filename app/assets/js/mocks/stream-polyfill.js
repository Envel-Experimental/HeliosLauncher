const { EventEmitter } = require('events')

class Readable extends EventEmitter {
    constructor(options) {
        super()
        this._options = options || {}
        if (this._options.read) this._read = this._options.read
        this._readableState = { ended: false, reading: false, paused: false }
    }

    _read() { }

    push(chunk) {
        if (this._readableState.ended) return false
        if (chunk === null) {
            this._readableState.ended = true
            this.emit('end')
            return false
        }
        this.emit('data', chunk)
        return true
    }

    pipe(dest, options) {
        const onData = (chunk) => {
            const canWrite = dest.write(chunk)
            if (!canWrite && this.pause) {
                this.pause()
                dest.once('drain', () => this.resume())
            }
        }
        this.on('data', onData)
        
        const onEnd = () => {
            if (!options || options.end !== false) {
                if (dest.end) dest.end()
            }
        }
        this.on('end', onEnd)
        
        return dest
    }

    pause() { this._readableState.paused = true }
    resume() { 
        this._readableState.paused = false 
        this._read()
    }
    
    destroy(err) {
        if (err) this.emit('error', err)
        this.emit('close')
    }

    static fromWeb(webStream) {
        const readable = new Readable()
        const reader = webStream.getReader()
        
        const pump = async () => {
            try {
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                        readable.push(null)
                        break
                    }
                    readable.push(Buffer.from(value))
                }
            } catch (err) {
                readable.emit('error', err)
            }
        }
        
        pump()
        return readable
    }
}

class Writable extends EventEmitter {
    constructor(options) {
        super()
        this._options = options || {}
        if (this._options.write) this._write = this._options.write
        if (this._options.final) this._final = this._options.final
        this._finished = false
    }

    _write(chunk, encoding, callback) { 
        if (typeof callback === 'function') callback() 
    }
    
    _final(callback) { 
        if (typeof callback === 'function') callback() 
    }

    write(chunk, encoding, callback) {
        if (typeof encoding === 'function') {
            callback = encoding
            encoding = 'utf-8'
        }
        // Safety: ensure callback is always a function if passed, or undefined
        const cb = typeof callback === 'function' ? callback : undefined
        
        try {
            this._write(chunk, encoding, (err) => {
                if (cb) cb(err)
            })
        } catch (e) {
            if (cb) cb(e)
            else this.emit('error', e)
        }
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
        
        const cb = typeof callback === 'function' ? callback : undefined
        
        if (chunk) this.write(chunk, encoding)
        
        this._final((err) => {
            this._finished = true
            if (cb) cb(err)
            this.emit('finish')
        })
    }
}

class Duplex extends Readable {
    constructor(options) {
        super(options)
        this._writableState = { finished: false }
        if (options && options.write) this._write = options.write
        if (options && options.final) this._final = options.final
    }

    _write(chunk, encoding, callback) { 
        if (typeof callback === 'function') callback() 
    }
    
    _final(callback) { 
        if (typeof callback === 'function') callback() 
    }

    write(chunk, encoding, callback) {
        return Writable.prototype.write.call(this, chunk, encoding, callback)
    }

    end(chunk, encoding, callback) {
        return Writable.prototype.end.call(this, chunk, encoding, (err) => {
            this.push(null)
            if (typeof callback === 'function') callback(err)
        })
    }
}

class Transform extends Duplex {
    constructor(options) {
        super(options)
        if (options && options.transform) this._transform = options.transform
        if (options && options.flush) this._flush = options.flush
    }

    _transform(chunk, encoding, callback) {
        if (typeof callback === 'function') callback(null, chunk)
    }

    _flush(callback) {
        if (typeof callback === 'function') callback()
    }

    _write(chunk, encoding, callback) {
        const cb = typeof callback === 'function' ? callback : (() => {})
        this._transform(chunk, encoding, (err, data) => {
            if (err) return cb(err)
            if (data !== undefined && data !== null) this.push(data)
            cb()
        })
    }
    
    _final(callback) {
        const cb = typeof callback === 'function' ? callback : (() => {})
        this._flush((err) => {
            cb(err)
        })
    }
}

async function pipeline(...streams) {
    return new Promise((resolve, reject) => {
        if (streams.length < 2) return reject(new Error('Pipeline requires at least two streams'))
        
        let errorEmitted = false
        const onError = (err) => {
            if (errorEmitted) return
            errorEmitted = true
            reject(err)
            streams.forEach(s => { 
                if (s.destroy) s.destroy(err) 
                else if (s.emit) s.emit('error', err)
            })
        }

        for (let i = 0; i < streams.length - 1; i++) {
            const current = streams[i]
            const next = streams[i + 1]
            current.on('error', onError)
            current.pipe(next)
        }

        const last = streams[streams.length - 1]
        last.on('error', onError)
        
        const onFinish = () => {
            if (!errorEmitted) resolve()
        }

        // Handle both 'finish' (Writable) and 'end' (Readable)
        if (last instanceof Writable || last instanceof Duplex || typeof last.write === 'function') {
            last.on('finish', onFinish)
            // Safety for streams that might already be finished
            if (last._finished) resolve()
        } else {
            last.on('end', onFinish)
        }

        // Start the flow
        const first = streams[0]
        if (first instanceof Readable && first._read) {
            setTimeout(() => {
                if (!first._readableState.ended) first._read()
            }, 0)
        }
    })
}

// Support for stream/promises
const promises = { pipeline }

module.exports = {
    Readable,
    Writable,
    Duplex,
    Transform,
    pipeline,
    promises
}
