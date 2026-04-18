/**
 * Script for welcome.ejs
 */
const welcomeButton = document.getElementById('welcomeButton')
if (welcomeButton) {
    welcomeButton.addEventListener('click', e => {
        loginOptionsCancelEnabled(false) // False by default, be explicit.
        loginOptionsViewOnLoginSuccess = VIEWS.landing
        loginOptionsViewOnLoginCancel = VIEWS.loginOptions
        switchView(VIEWS.welcome, VIEWS.loginOptions)
    })
}
