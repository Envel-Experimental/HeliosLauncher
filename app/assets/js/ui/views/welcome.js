/**
 * Script for welcome.ejs
 */
const welcomeButton = document.getElementById('welcomeButton')
if (welcomeButton) {
    welcomeButton.addEventListener('click', e => {
        loginCancelEnabled(false) // False by default on welcome screen
        window.loginViewOnSuccess = VIEWS.landing
        window.loginViewOnCancel = VIEWS.welcome
        switchView(VIEWS.welcome, VIEWS.login)
    })
}
