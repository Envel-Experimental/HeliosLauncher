/**
 * Lightweight Buffer polyfill for the renderer.
 * Focuses on what the distribution engine needs.
 */

class BufferPolyfill {
    constructor(uint8Array) {
        this._arr = uint8Array
        this.length = uint8Array.length
    }

    static from(data, encoding) {
        if (data instanceof ArrayBuffer) {
            return new BufferPolyfill(new Uint8Array(data))
        }
        if (data instanceof Uint8Array) {
            return new BufferPolyfill(data)
        }
        if (typeof data === 'string') {
            if (encoding === 'hex') {
                const arr = new Uint8Array(data.match(/.{1,2}/g).map(byte => parseInt(byte, 16)))
                return new BufferPolyfill(arr)
            }
            return new BufferPolyfill(new TextEncoder().encode(data))
        }
        return new BufferPolyfill(new Uint8Array(0))
    }

    static concat(list, totalLength) {
        if (!Array.isArray(list)) return BufferPolyfill.from([])
        if (totalLength === undefined) {
            totalLength = list.reduce((acc, curr) => acc + curr.length, 0)
        }
        const result = new Uint8Array(totalLength)
        let offset = 0
        for (const buf of list) {
            result.set(buf._arr || buf, offset)
            offset += (buf.length || buf.byteLength)
        }
        return new BufferPolyfill(result)
    }

    static isBuffer(obj) {
        return obj instanceof BufferPolyfill
    }

    static alloc(size, fill = 0) {
        const arr = new Uint8Array(size).fill(fill)
        return new BufferPolyfill(arr)
    }

    // Instance method for hex string
    toString(encoding) {
        if (encoding === 'hex') {
            return Array.from(this._arr).map(b => b.toString(16).padStart(2, '0')).join('')
        }
        if (encoding === 'utf-8' || encoding === 'utf8' || !encoding) {
            return new TextDecoder().decode(this._arr)
        }
        return ''
    }

    slice(start, end) {
        return new BufferPolyfill(this._arr.slice(start, end))
    }
}

module.exports = BufferPolyfill
module.exports.Buffer = BufferPolyfill
