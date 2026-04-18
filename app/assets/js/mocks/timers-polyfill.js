/**
 * Functional Timers Polyfill for the Renderer.
 */

module.exports = {
    setImmediate: (callback, ...args) => setTimeout(callback, 0, ...args),
    clearImmediate: (id) => clearTimeout(id)
}
