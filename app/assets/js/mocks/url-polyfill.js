/**
 * URL Polyfill for the renderer.
 * Exports native browser URL if available, otherwise a placeholder.
 */
const GlobalURL = typeof window !== 'undefined' ? window.URL : global.URL
const GlobalURLSearchParams = typeof window !== 'undefined' ? window.URLSearchParams : global.URLSearchParams

module.exports = {
    URL: GlobalURL,
    URLSearchParams: GlobalURLSearchParams
}
