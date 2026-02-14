/**
 * DOM Utility Functions to replace jQuery
 */

/**
 * Fade in an element.
 * @param {HTMLElement} el The element to fade in.
 * @param {number} [duration=400] Duration in ms. 
 * @param {Function} [callback] Callback after animation.
 */
exports.fadeIn = function (el, duration = 400, callback) {
    if (!el) return;
    if (typeof duration === 'function') {
        callback = duration;
        duration = 400;
    }

    // Reset display if it's none
    if (getComputedStyle(el).display === 'none') {
        el.style.display = ''; // Try checking stylesheet
        if (getComputedStyle(el).display === 'none') {
            el.style.display = el.dataset.display || 'block'; // Fallback
        }
    }
    el.style.opacity = 0;

    const animation = el.animate([
        { opacity: 0 },
        { opacity: 1 }
    ], {
        duration: duration,
        easing: 'linear',
        fill: 'forwards'
    });

    animation.onfinish = () => {
        el.style.opacity = 1;
        if (callback) callback();
    };
};

/**
 * Fade out an element.
 * @param {HTMLElement} el The element to fade out.
 * @param {number} [duration=400] Duration in ms.
 * @param {Function} [callback] Callback after animation.
 */
exports.fadeOut = function (el, duration = 400, callback) {
    if (!el) return;
    if (typeof duration === 'function') {
        callback = duration;
        duration = 400;
    }

    // Save current display style to restore later if needed
    if (el.style.display !== 'none' && getComputedStyle(el).display !== 'none') {
        el.dataset.display = getComputedStyle(el).display;
    }

    const animation = el.animate([
        { opacity: 1 },
        { opacity: 0 }
    ], {
        duration: duration,
        easing: 'linear',
        fill: 'forwards'
    });

    animation.onfinish = () => {
        el.style.display = 'none';
        el.style.opacity = ''; // Reset opacity
        if (callback) callback();
    };
};

/**
 * Show an element (display: block/flex/etc).
 * @param {HTMLElement} el 
 */
exports.show = function (el) {
    if (!el) return;
    if (getComputedStyle(el).display === 'none') {
        el.style.display = ''; // Try checking stylesheet
        if (getComputedStyle(el).display === 'none') {
            el.style.display = el.dataset.display || 'block'; // Fallback
        }
    }
    el.style.opacity = 1;
};

/**
 * Hide an element (display: none).
 * @param {HTMLElement} el 
 */
exports.hide = function (el) {
    if (!el) return;
    if (el.style.display !== 'none' && getComputedStyle(el).display !== 'none') {
        el.dataset.display = getComputedStyle(el).display;
    }
    el.style.display = 'none';
};

/**
 * Toggle an element's visibility.
 * @param {HTMLElement} el 
 * @param {boolean} [show] Force state
 */
exports.toggle = function (el, show) {
    if (!el) return;
    const isVisible = getComputedStyle(el).display !== 'none';
    const shouldShow = show !== undefined ? show : !isVisible;

    if (shouldShow) {
        exports.show(el);
    } else {
        exports.hide(el);
    }
};

/**
 * Toggle a class on an element.
 * @param {HTMLElement} el 
 * @param {string} className 
 */
exports.toggleClass = function (el, className) {
    if (!el) return;
    el.classList.toggle(className);
}

/**
 * Remove an attribute.
 * @param {HTMLElement} el 
 * @param {string} attr 
 */
exports.removeAttr = function (el, attr) {
    if (!el) return;
    el.removeAttribute(attr);
}
