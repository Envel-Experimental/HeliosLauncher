/**
 * Safe event binding utility to prevent TypeError when elements are missing from the DOM.
 * 
 * @param {string} id The ID of the element to bind to.
 * @param {string} event The event type (e.g., 'click').
 * @param {Function} handler The event handler function.
 */
export function safeBind(id, event, handler) {
    const el = document.getElementById(id)
    if (el) {
        el.addEventListener(event, handler)
        return true
    }
    return false
}

/**
 * Safe onclick assignment.
 * @param {string} id 
 * @param {Function} handler 
 */
export function safeSetOnClick(id, handler) {
    const el = document.getElementById(id)
    if (el) {
        el.onclick = handler
        return true
    }
    return false
}
