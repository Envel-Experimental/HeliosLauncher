/**
 * Functional Util Polyfill for the Renderer.
 */

const util = {
    inherits: function(ctor, superCtor) {
        if (superCtor) {
            ctor.super_ = superCtor
            ctor.prototype = Object.create(superCtor.prototype, {
                constructor: {
                    value: ctor,
                    enumerable: false,
                    writable: true,
                    configurable: true
                }
            })
        }
    },
    promisify: function(original) {
        if (typeof original !== 'function') {
            throw new TypeError('The "original" argument must be of type Function')
        }
        return function(...args) {
            return new Promise((resolve, reject) => {
                original.call(this, ...args, (err, ...values) => {
                    if (err) return reject(err)
                    resolve(values.length > 1 ? values : values[0])
                })
            })
        }
    },
    format: function(fmt, ...args) {
        let i = 0
        return fmt.replace(/%[sdj%]/g, (x) => {
            if (x === '%%') return '%'
            if (i >= args.length) return x
            switch (x) {
                case '%s': return String(args[i++])
                case '%d': return Number(args[i++])
                case '%j': return JSON.stringify(args[i++])
                default: return x
            }
        })
    },
    deprecate: (fn, msg) => {
        let warned = false
        return function(...args) {
            if (!warned) {
                console.warn(msg)
                warned = true
            }
            return fn.apply(this, args)
        }
    },
    isObject: (arg) => typeof arg === 'object' && arg !== null,
    isFunction: (arg) => typeof arg === 'function',
    isString: (arg) => typeof arg === 'string',
    isNumber: (arg) => typeof arg === 'number',
    isBoolean: (arg) => typeof arg === 'boolean',
    isUndefined: (arg) => typeof arg === 'undefined'
}

module.exports = util
