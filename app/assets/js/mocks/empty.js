/**
 * Safe Universal Mock (Inheritance & Property Friendly)
 */
function Mock() {}
Mock.prototype = {}

const handler = {
    get: (target, prop) => {
        if (prop in target) return target[prop]
        if (prop === 'toString') return () => '[object Mock]'
        if (prop === 'valueOf') return () => target
        if (typeof prop === 'symbol') return undefined
        if (prop === 'native') return undefined
        
        // Return the proxy itself for any missing property
        return proxy
    },
    apply: () => proxy,
    construct: () => ({})
}

const proxy = new Proxy(Mock, handler)

module.exports = proxy
