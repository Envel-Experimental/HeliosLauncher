module.exports = function(v, msg) {
    if (!v) throw new Error(msg || 'Assertion failed')
}
module.exports.ok = module.exports
module.exports.equal = (a, b, m) => { if (a != b) throw new Error(m) }
module.exports.strictEqual = (a, b, m) => { if (a !== b) throw new Error(m) }
module.exports.deepEqual = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(m) }
