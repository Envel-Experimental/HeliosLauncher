/**
 * Script for agreement view
 */
const agreementButton = document.getElementById('agreementButton')
const agreementCheckbox = document.getElementById('agreementCheckbox')

if (agreementCheckbox) {
    agreementCheckbox.addEventListener('change', (e) => {
        agreementButton.disabled = !e.target.checked
    })
}

if (agreementButton) {
    agreementButton.addEventListener('click', async (e) => {
        agreementButton.disabled = true
        
        // Record agreement
        await ConfigManager.acceptAgreement()
        
        // Decide where to go next
        const isLoggedIn = Object.keys(ConfigManager.getAuthAccounts()).length > 0
        
        if (ConfigManager.isFirstLaunch()) {
            loginCancelEnabled(false)
            window.loginViewOnSuccess = VIEWS.landing
            window.loginViewOnCancel = VIEWS.loginOptions
            switchView(VIEWS.agreement, VIEWS.login)
        } else {
            if (isLoggedIn) {
                switchView(VIEWS.agreement, VIEWS.landing)
            } else {
                loginOptionsCancelEnabled(false)
                window.loginOptionsViewOnLoginSuccess = VIEWS.landing
                window.loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(VIEWS.agreement, VIEWS.loginOptions)
            }
        }
    })
}

// Handle external links opening in browser
document.querySelectorAll('.agreementLink').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault()
        const url = e.currentTarget.getAttribute('href')
        if (window.HeliosAPI && window.HeliosAPI.shell) {
            window.HeliosAPI.shell.openExternal(url)
        } else {
            // Fallback for dev environment or if API is different
            window.open(url, '_blank')
        }
    })
})
