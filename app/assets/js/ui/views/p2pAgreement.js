if (p2pAgreementEnableButton) {
    p2pAgreementEnableButton.addEventListener('click', async (e) => {
        ConfigManager.setLocalOptimization(true)
        ConfigManager.setGlobalOptimization(true)
        ConfigManager.setP2PUploadEnabled(true)
        ConfigManager.acceptP2PLegalAgreement()
        
        if (ConfigManager.isFirstLaunch()) {
            ConfigManager.markFirstLaunchCompleted()
        }
        
        // Wait for tasks to complete before transitioning
        await ConfigManager.save()
        await ipcRenderer.invoke('p2p:configUpdate')
        
        // Transition UI
        finishOnboarding()
    })
}

if (p2pAgreementDisableButton) {
    p2pAgreementDisableButton.addEventListener('click', async (e) => {
        ConfigManager.setLocalOptimization(false)
        ConfigManager.setGlobalOptimization(false)
        ConfigManager.setP2PUploadEnabled(false)
        ConfigManager.acceptP2PLegalAgreement()

        if (ConfigManager.isFirstLaunch()) {
            ConfigManager.markFirstLaunchCompleted()
        }

        // Wait for tasks to complete before transitioning
        await ConfigManager.save()
        await ipcRenderer.invoke('p2p:configUpdate')

        // Transition UI
        finishOnboarding()
    })
}
