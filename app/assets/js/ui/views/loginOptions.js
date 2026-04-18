const { MSFT_OPCODE } = require('../../core/ipcconstants')

export const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
export const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
export const loginOptionMojang = document.getElementById('loginOptionMojang')
export const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

export let loginOptionsCancellable = false

export function loginOptionsCancelEnabled(val) {
    if (val) {
        show(loginOptionsCancelContainer)
    } else {
        hide(loginOptionsCancelContainer)
    }
}


loginOptionMicrosoft.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(
            MSFT_OPCODE.OPEN_LOGIN,
            window.loginOptionsViewOnLoginSuccess,
            window.loginOptionsViewOnLoginCancel
        )
    })
}

loginOptionMojang.onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        window.loginViewOnSuccess = window.loginOptionsViewOnLoginSuccess
        window.loginViewOnCancel = window.loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
    })
}

loginOptionsCancelButton.onclick = (e) => {
    switchView(getCurrentView(), window.loginOptionsViewOnCancel, 500, 500, () => {
        // Clear login values (Mojang login)
        // No cleanup needed for Microsoft.
        loginUsername.value = ''
        loginPassword.value = ''
        if (window.loginOptionsViewCancelHandler != null) {
            window.loginOptionsViewCancelHandler()
            window.loginOptionsViewCancelHandler = null
        }
    })
}
