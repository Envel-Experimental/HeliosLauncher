/**
 * DOM Utility functions to replace jQuery.
 */

/**
 * Fades in an element.
 * @param {HTMLElement} element The element to fade in.
 * @param {number} duration The duration in milliseconds.
 * @param {function} callback Callback function after animation.
 */
exports.fadeIn = function(element, duration = 400, callback) {
    if (!element) return
    element.style.opacity = 0
    element.style.display = '' // Reset display to default (block/flex/etc) or check getComputedStyle?
    // If element was 'none', we need to set it to visible.
    // However, we don't know the original display.
    // A safe bet is usually to unset 'display' if it was inline style 'none'.
    // Or set to block/flex if defined in CSS.
    // For now, let's assume clearing inline display works if CSS handles it.
    if (getComputedStyle(element).display === 'none') {
        element.style.display = 'block' // Fallback
    }

    const animation = element.animate([
        { opacity: 0 },
        { opacity: 1 }
    ], {
        duration: duration,
        fill: 'forwards',
        easing: 'ease'
    })

    animation.onfinish = () => {
        element.style.opacity = 1
        if (callback) callback()
    }
}

/**
 * Fades out an element.
 * @param {HTMLElement} element The element to fade out.
 * @param {number} duration The duration in milliseconds.
 * @param {function} callback Callback function after animation.
 */
exports.fadeOut = function(element, duration = 400, callback) {
    if (!element) return
    const animation = element.animate([
        { opacity: 1 },
        { opacity: 0 }
    ], {
        duration: duration,
        fill: 'forwards',
        easing: 'ease'
    })

    animation.onfinish = () => {
        element.style.opacity = 0
        element.style.display = 'none'
        if (callback) callback()
    }
}

exports.show = function(element) {
    if (element) element.style.display = ''
    // If still none (because of CSS), force block?
    // jQuery .show() restores the default display property.
    // This is complex in vanilla without cache.
    // For now, simple removal of 'none' is often enough if classes handle it.
    // If not, we might need 'block' or 'flex'.
    if (element && getComputedStyle(element).display === 'none') {
        element.style.display = 'block'
    }
}

exports.hide = function(element) {
    if (element) element.style.display = 'none'
}

exports.toggle = function(element) {
    if (!element) return
    if (getComputedStyle(element).display === 'none') {
        exports.show(element)
    } else {
        exports.hide(element)
    }
}
