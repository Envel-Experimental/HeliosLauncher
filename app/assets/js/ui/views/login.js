/**
 * Script for login.ejs
 */
// Validation Regexes.
export const validUsername = /^[a-zA-Z0-9_]{4,16}$/
export const basicEmail = /^\S+@\S+\.\S+$/

// Login Elements
export const loginCancelContainer = document.getElementById('loginCancelContainer')
export const loginCancelButton = document.getElementById('loginCancelButton')
export const loginEmailError = document.getElementById('loginEmailError')
export const loginUsername = document.getElementById('loginUsername')
export const checkmarkContainer = document.getElementById('checkmarkContainer')
export const loginRememberOption = document.getElementById('loginRememberOption')
export const loginButton = document.getElementById('loginButton')
export const loginForm = document.getElementById('loginForm')

// Control variables.
export let lu = false

/**
 * Show a login error.
 *
 * @param {HTMLElement} element The element on which to display the error.
 * @param {string} value The error text.
 */
export function showError(element, value) {
    element.innerHTML = value
    element.style.opacity = 1
}

/**
 * Shake a login error to add emphasis.
 *
 * @param {HTMLElement} element The element to shake.
 */
export function shakeError(element) {
    if (element.style.opacity == 1) {
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

/**
 * Validate input for username or email.
 *
 * @param {string} value The value to validate.
 */
export function validateInput(value) {
    if (value) {
        if (!basicEmail.test(value) && !validUsername.test(value)) {
            showError(loginEmailError, Lang.queryJS('login.error.invalidValue'))
            loginDisabled(true)
            lu = false
        } else {
            loginEmailError.style.opacity = 0
            lu = true
            loginDisabled(false)
        }
    } else {
        lu = false
        showError(loginEmailError, Lang.queryJS('login.error.requiredValue'))
        loginDisabled(true)
    }
}

// Emphasize errors with shake when focus is lost.
loginUsername.addEventListener('focusout', (e) => {
    validateInput(e.target.value)
    shakeError(loginEmailError)
})

// Validate input on each keystroke.
loginUsername.addEventListener('input', (e) => {
    validateInput(e.target.value)
})

/**
 * Enable or disable the login button.
 *
 * @param {boolean} v True to enable, false to disable.
 */
export function loginDisabled(v) {
    if (loginButton.disabled !== v) {
        loginButton.disabled = v
    }
}

/**
 * Enable or disable loading elements.
 *
 * @param {boolean} v True to enable, false to disable.
 */
export function loginLoading(v) {
    if (v) {
        loginButton.setAttribute('loading', v)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.login'), Lang.queryJS('login.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.login'))
    }
}

/**
 * Enable or disable login form.
 *
 * @param {boolean} v True to enable, false to disable.
 */
export function formDisabled(v) {
    loginDisabled(v)
    loginCancelButton.disabled = v
    loginUsername.disabled = v
    if (v) {
        checkmarkContainer.setAttribute('disabled', v)
    } else {
        checkmarkContainer.removeAttribute('disabled')
    }
    loginRememberOption.disabled = v
}

export function loginCancelEnabled(val) {
    if (val) {
        show(loginCancelContainer)
    } else {
        hide(loginCancelContainer)
    }
}


loginCancelButton.onclick = (e) => {
    switchView(getCurrentView(), window.loginViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        loginCancelEnabled(false)
        if (window.loginViewCancelHandler != null) {
            window.loginViewCancelHandler()
            window.loginViewCancelHandler = null
        }
    })
}

// Disable default form behavior.
loginForm.onsubmit = () => { return false }

// Bind login button behavior.
loginButton.addEventListener('click', () => {
    console.log('[LoginUI] Login button clicked');
    // Disable form.
    formDisabled(true)

    // Show loading animation.
    loginLoading(true)

    // Attempt login with empty password.
    AuthManager.addMojangAccount(loginUsername.value, '').then((value) => {
        console.log('[LoginUI] addMojangAccount resolved successfully');
        updateSelectedAccount(value)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'))
        document.querySelectorAll('.circle-loader').forEach(el => toggleClass(el, 'load-complete'))
        document.querySelectorAll('.checkmark').forEach(el => toggle(el))
        setTimeout(() => {
            console.log('[LoginUI] Calling switchView');
            switchView(VIEWS.login, window.loginViewOnSuccess, 500, 500, async () => {
                console.log('[LoginUI] switchView callback executing');
                if (window.loginViewOnSuccess === VIEWS.settings) {
                    await prepareSettings()
                }
                window.loginViewOnSuccess = VIEWS.landing
                loginCancelEnabled(false)
                window.loginViewCancelHandler = null
                loginUsername.value = ''
                document.querySelectorAll('.circle-loader').forEach(el => toggleClass(el, 'load-complete'))
                document.querySelectorAll('.checkmark').forEach(el => toggle(el))
                loginLoading(false)
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'))
                formDisabled(false)

                if (ConfigManager.isFirstLaunch()) {
                    toggleServerSelection(true)
                }
                console.log('[LoginUI] switchView callback finished');
            })
        }, 1000)
    }).catch((displayableError) => {
        console.log('[LoginUI] addMojangAccount rejected:', displayableError);
        loginLoading(false)

        let actualDisplayableError = isDisplayableError(displayableError)
            ? displayableError
            : Lang.queryJS('login.error.unknown')

        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
        setOverlayHandler(() => {
            formDisabled(false)
            toggleOverlay(false)
        })
        toggleOverlay(true)
    })
})
