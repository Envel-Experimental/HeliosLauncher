module.exports = {
    lookup: (hostname, options, callback) => {
        if (typeof options === 'function') { callback = options }
        callback(null, '127.0.0.1', 4)
    },
    promises: {
        lookup: async () => ({ address: '127.0.0.1', family: 4 })
    }
}
