if (p2pAgreementEnableButton) {
    p2pAgreementEnableButton.addEventListener('click', (e) => {
        ConfigManager.setLocalOptimization(true)
        ConfigManager.setGlobalOptimization(true)
        ConfigManager.setP2PUploadEnabled(true)
        ConfigManager.acceptP2PLegalAgreement()
        
        if (ConfigManager.isFirstLaunch()) {
            ConfigManager.markFirstLaunchCompleted()
        }
        
        // Run heavy tasks in background without blocking UI
        ConfigManager.save()
        ipcRenderer.invoke('p2p:configUpdate')
        
        // Transition UI immediately
        finishOnboarding()
    })
}

if (p2pAgreementDisableButton) {
    p2pAgreementDisableButton.addEventListener('click', (e) => {
        ConfigManager.setLocalOptimization(false)
        ConfigManager.setGlobalOptimization(false)
        ConfigManager.setP2PUploadEnabled(false)
        ConfigManager.acceptP2PLegalAgreement()

        if (ConfigManager.isFirstLaunch()) {
            ConfigManager.markFirstLaunchCompleted()
        }

        // Run heavy tasks in background without blocking UI
        ConfigManager.save()
        ipcRenderer.invoke('p2p:configUpdate')

        // Transition UI immediately
        finishOnboarding()
    })
}
