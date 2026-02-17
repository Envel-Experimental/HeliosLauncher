const os = require('os')
const semver = require('semver')
const fs = require('fs')
const sysPath = require('path')

const DropinModUtil = require('./assets/js/dropinmodutil')

const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')
var { validateSelectedJvm, ensureJavaDirIsRoot } = require('./assets/js/core/java/JavaGuard')

const settingsState = {
    invalid: new Set()
}

function formatSpeed(bytesPerSec) {
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s'
    const k = 1024
    const sizes = ['KB/s', 'MB/s', 'GB/s']
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k)) - 1
    return parseFloat((bytesPerSec / Math.pow(k, i + 1)).toFixed(2)) + ' ' + sizes[i]
}

function bindSettingsSelect() {
    for (let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]

        selectedDiv.onclick = (e) => {
            e.stopPropagation()
            closeSettingsSelect(e.target)
            e.target.nextElementSibling.toggleAttribute('hidden')
            e.target.classList.toggle('select-arrow-active')
        }
    }
}

function closeSettingsSelect(el) {
    for (let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]
        const optionsDiv = ele.getElementsByClassName('settingsSelectOptions')[0]

        if (!(selectedDiv === el)) {
            selectedDiv.classList.remove('select-arrow-active')
            optionsDiv.setAttribute('hidden', '')
        }
    }
}

/* If the user clicks anywhere outside the select box,
then close all select boxes: */
document.addEventListener('click', closeSettingsSelect)

bindSettingsSelect()


function bindFileSelectors() {
    for (let ele of document.getElementsByClassName('settingsFileSelButton')) {

        ele.onclick = async e => {
            const isJavaExecSel = ele.id === 'settingsJavaExecSel'
            const directoryDialog = ele.hasAttribute('dialogDirectory') && ele.getAttribute('dialogDirectory') == 'true'
            const properties = directoryDialog ? ['openDirectory', 'createDirectory'] : ['openFile']

            const options = {
                properties
            }

            if (ele.hasAttribute('dialogTitle')) {
                options.title = ele.getAttribute('dialogTitle')
            }

            if (isJavaExecSel && process.platform === 'win32') {
                options.filters = [
                    { name: Lang.queryJS('settings.fileSelectors.executables'), extensions: ['exe'] },
                    { name: Lang.queryJS('settings.fileSelectors.allFiles'), extensions: ['*'] }
                ]
            }

            const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), options)
            if (!res.canceled) {
                ele.previousElementSibling.value = res.filePaths[0]
                if (isJavaExecSel) {
                    await populateJavaExecDetails(ele.previousElementSibling.value)
                }
            }
        }
    }
}

bindFileSelectors()


/**
 * General Settings Functions
 */

/**
  * Bind value validators to the settings UI elements. These will
  * validate against the criteria defined in the ConfigManager (if
  * any). If the value is invalid, the UI will reflect this and saving
  * will be disabled until the value is corrected. This is an automated
  * process. More complex UI may need to be bound separately.
  */
function initSettingsValidators() {
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const vFn = ConfigManager['validate' + v.getAttribute('cValue')]
        if (typeof vFn === 'function') {
            if (v.tagName === 'INPUT') {
                if (v.type === 'number' || v.type === 'text') {
                    v.addEventListener('keyup', (e) => {
                        const v = e.target
                        if (!vFn(v.value)) {
                            settingsState.invalid.add(v.id)
                            v.setAttribute('error', '')
                            settingsSaveDisabled(true)
                        } else {
                            if (v.hasAttribute('error')) {
                                v.removeAttribute('error')
                                settingsState.invalid.delete(v.id)
                                if (settingsState.invalid.size === 0) {
                                    settingsSaveDisabled(false)
                                }
                            }
                        }
                    })
                }
            }
        }

    })
}

/**
 * Load configuration values onto the UI. This is an automated process.
 */
async function initSettingsValues() {
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')

    for (const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const gFn = ConfigManager['get' + cVal]
        const gFnOpts = []
        if (serverDependent) {
            gFnOpts.push(ConfigManager.getSelectedServer())
        }
        if (typeof gFn === 'function') {
            if (v.tagName === 'INPUT') {
                if (v.type === 'number' || v.type === 'text') {
                    // Special Conditions
                    if (cVal === 'JavaExecutable') {
                        v.value = gFn.apply(null, gFnOpts)
                        await populateJavaExecDetails(v.value)
                    } else if (cVal === 'DataDirectory') {
                        v.value = gFn.apply(null, gFnOpts)
                    } else if (cVal === 'JVMOptions') {
                        v.value = gFn.apply(null, gFnOpts).join(' ')
                    } else {
                        v.value = gFn.apply(null, gFnOpts)
                    }
                } else if (v.type === 'checkbox') {
                    v.checked = gFn.apply(null, gFnOpts)
                }
            } else if (v.tagName === 'DIV') {
                if (v.classList.contains('rangeSlider')) {
                    // Special Conditions
                    if (cVal === 'MinRAM' || cVal === 'MaxRAM') {
                        let val = gFn.apply(null, gFnOpts)
                        if (val.endsWith('M')) {
                            val = Number(val.substring(0, val.length - 1)) / 1024
                        } else {
                            val = Number.parseFloat(val)
                        }

                        v.setAttribute('value', val)
                    } else if (cVal === 'P2PUploadLimit') {
                        const val = gFn.apply(null, gFnOpts)
                        v.setAttribute('value', val)
                        document.getElementById('settingsP2PUploadLabel').innerHTML = val + ' Mbit/s'
                    } else {
                        v.setAttribute('value', Number.parseFloat(gFn.apply(null, gFnOpts)))
                    }
                }
            }
        }
    }

    // Update P2P Profile Label
    try {
        const p2pInfo = await ipcRenderer.invoke('p2p:getInfo')
        const profileEl = document.getElementById('settingsP2PProfileLabel')
        if (profileEl && p2pInfo && p2pInfo.profile) {
            const profiles = {
                'LOW': 'Экономный (Пассивный)',
                'MID': 'Сбалансированный',
                'HIGH': 'Высокопроизводительный'
            }
            profileEl.innerHTML = profiles[p2pInfo.profile] || p2pInfo.profile
        }
    } catch (e) { /* ignore */ }
}

function bindP2PSlider() {
    const slider = document.getElementById('settingsP2PUploadRange')
    const label = document.getElementById('settingsP2PUploadLabel')

    // Observer for value change
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'value') {
                label.innerHTML = slider.getAttribute('value') + ' Mbit/s'
            }
        })
    })
    observer.observe(slider, { attributes: true })
}
bindP2PSlider()


const getP2PStatsMarkup = (info) => {
    const spinner = '<span class="p2p-status-spinner"></span>'
    let statusText = 'Отключен'
    let statusColor = '#ff4444'
    if (info.listening && ConfigManager.getLocalOptimization()) {
        if (ConfigManager.getP2PUploadEnabled()) {
            statusText = 'Активен'
            statusColor = '#7dbb00'
        } else {
            statusText = 'Активен (Только скачивание)'
            statusColor = '#ffbb00'
        }
    }



    let globalStatusText = 'Отключен'
    let globalStatusColor = '#ff4444'
    if (info.running) {
        globalStatusText = 'Активен'
        globalStatusColor = '#7dbb00'
        if (info.mode && info.mode.includes('Passive')) {
            globalStatusText = 'Активен (Режим экономии)'
            globalStatusColor = '#ffbb00'
        }
    }

    return `
        <style>
            @keyframes p2p-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .p2p-stats-wrapper {
                display: flex;
                gap: 15px;
                background: rgba(20, 20, 20, 0.85);
                padding: 20px;
                border-radius: 18px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                box-shadow: 0 12px 45px rgba(0,0,0,0.45);
                width: 100%;
                max-width: 740px;
                max-height: 65vh;
                overflow-y: auto;
                overflow-x: hidden;
                box-sizing: border-box;
                font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            .p2p-stats-wrapper::-webkit-scrollbar {
                width: 4px;
            }
            .p2p-stats-wrapper::-webkit-scrollbar-track {
                background: rgba(255, 255, 255, 0.05);
                border-radius: 10px;
            }
            .p2p-stats-wrapper::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 10px;
            }
            .p2p-column {
                flex: 1;
                display: flex;
                flex-direction: column;
                gap: 8px;
                min-width: 280px;
            }
            .p2p-divider {
                width: 1px;
                background: linear-gradient(to bottom, transparent, rgba(255,255,255,0.12), transparent);
                flex-shrink: 0;
            }
            .p2p-title {
                font-size: 11px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 1.5px;
                color: #888;
                margin-bottom: 2px;
            }
            .p2p-data-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 0;
                border-bottom: 1px solid rgba(255,255,255,0.05);
            }
            .p2p-data-label {
                font-size: 13.5px;
                color: #aaa;
            }
            .p2p-data-value {
                font-size: 14.5px;
                font-weight: 600;
                color: #fff;
                display: flex;
                align-items: center;
            }
            .p2p-status-spinner {
                display: inline-block;
                width: 12px;
                height: 12px;
                border: 2px solid rgba(255,255,255,0.1);
                border-top: 2px solid #7dbb00;
                border-radius: 50%;
                animation: p2p-spin 1s linear infinite;
                margin-left: 8px;
            }
            .p2p-topic-tag {
                font-family: monospace;
                background: rgba(255,255,255,0.05);
                padding: 2px 6px;
                border-radius: 4px;
                color: #999;
            }
        </style>
        <div id="p2pInfoStats" class="p2p-stats-wrapper">
            <div class="p2p-column">
                <div class="p2p-title">Локальная сеть (LAN)</div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Статус</span>
                    <span id="p2p-local-status" class="p2p-data-value" style="color: ${statusColor}">
                        ${statusText} ${info.listening ? spinner : ''}
                    </span>
                </div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Локальные пиры</span>
                    <span id="p2p-local-peers" class="p2p-data-value">${info.localPeers || 0}</span>
                </div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Скорость (Загр/Отд)</span>
                    <span class="p2p-data-value">
                        <span id="p2p-local-dl-speed" style="color: #7dbb00;">${formatSpeed(info.downloadSpeedLocal || 0)}</span>
                        <span style="margin: 0 4px; color: #444;">/</span>
                        <span id="p2p-local-ul-speed" style="color: #0088ff;">${formatSpeed(info.uploadSpeedLocal || 0)}</span>
                    </span>
                </div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Отдано</span>
                    <span id="p2p-local-uploaded" class="p2p-data-value">${((info.uploadedLocal || 0) / 1024 / 1024).toFixed(2)} MB</span>
                </div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Принято</span>
                    <span id="p2p-local-downloaded" class="p2p-data-value">${((info.downloadedLocal || 0) / 1024 / 1024).toFixed(2)} MB</span>
                </div>
            </div>

            <div class="p2p-divider"></div>

            <div id="p2p-global-container" class="p2p-column">
                <div class="p2p-title">Глобальная сеть (WAN)</div>
                <div class="p2p-data-row">
                    <span class="p2p-data-label">Статус</span>
                    <span id="p2p-global-status" class="p2p-data-value" style="color: ${globalStatusColor}">
                        ${globalStatusText} ${info.running ? spinner : ''}
                    </span>
                </div>
                
                <div id="p2p-global-details" style="display: ${info.running ? 'block' : 'none'}">
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Топик</span>
                        <span class="p2p-data-value"><span id="p2p-global-topic" class="p2p-topic-tag">${info.topic}</span></span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">DHT Узлы</span>
                        <span id="p2p-global-dht" class="p2p-data-value" style="color: ${info.dhtNodes > 0 ? '#7dbb00' : '#ff4444'}">
                            ${info.dhtNodes || 0} <span style="color: ${info.bootstrapped ? '#7dbb00' : '#666'}; margin-left: 4px; font-weight: normal;">(${info.bootstrapNodes})</span>
                        </span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Глобальные пиры</span>
                        <span id="p2p-global-peers" class="p2p-data-value">${info.globalPeers || 0}</span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Скорость (Загр/Отд)</span>
                        <span class="p2p-data-value">
                            <span id="p2p-global-dl-speed" style="color: #7dbb00;">${formatSpeed(info.downloadSpeed || 0)}</span>
                            <span style="margin: 0 4px; color: #444;">/</span>
                            <span id="p2p-global-ul-speed" style="color: #0088ff;">${formatSpeed(info.uploadSpeed || 0)}</span>
                        </span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Активные сессии</span>
                        <span id="p2p-global-sessions" class="p2p-data-value">
                            ${info.uploads} <span style="color: #666; font-size: 11px; margin-left: 4px;">(Upload)</span>
                            ${info.uploads > 0 ? spinner : ''}
                        </span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Сетевой статус</span>
                        <span id="p2p-global-mode" class="p2p-data-value" style="color: ${info.mode && info.mode.includes('Active') ? '#7dbb00' : '#ffbb00'}">
                            ${info.mode && info.mode.includes('Active') ? 'Активный (Полный)' : 'Ограниченный (Загрузка)'}
                        </span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Отдано</span>
                        <span id="p2p-global-uploaded" class="p2p-data-value">${((info.uploadedGlobal || 0) / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <div class="p2p-data-row">
                        <span class="p2p-data-label">Принято</span>
                        <span id="p2p-global-downloaded" class="p2p-data-value">${((info.downloadedGlobal || 0) / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                </div>
                <div id="p2p-global-disabled" style="display: ${info.running ? 'none' : 'flex'}; flex: 1; align-items: center; justify-content: center; color: #555; font-style: italic; font-size: 13px; text-align: center;">
                    Глобальная оптимизация<br>отключена в настройках
                </div>
            </div>
        </div>
    `
}

const updateP2PStatsUI = (info) => {
    const el = id => document.getElementById(id)
    if (!el('p2pInfoStats')) return false

    const spinner = '<span class="p2p-status-spinner"></span>'

    // Local
    let statusText = 'Отключен', statusColor = '#ff4444'
    if (info.listening && ConfigManager.getLocalOptimization()) {
        if (ConfigManager.getP2PUploadEnabled()) {
            statusText = 'Активен', statusColor = '#7dbb00'
        } else {
            statusText = 'Активен (Только скачивание)', statusColor = '#ffbb00'
        }
    }
    const lStatus = el('p2p-local-status')
    if (lStatus) {
        lStatus.innerHTML = `${statusText} ${info.listening ? spinner : ''}`
        lStatus.style.color = statusColor
    }
    if (el('p2p-local-peers')) el('p2p-local-peers').innerText = info.localPeers || 0
    if (el('p2p-local-dl-speed')) el('p2p-local-dl-speed').innerText = formatSpeed(info.downloadSpeedLocal || 0)
    if (el('p2p-local-ul-speed')) el('p2p-local-ul-speed').innerText = formatSpeed(info.uploadSpeedLocal || 0)
    if (el('p2p-local-uploaded')) el('p2p-local-uploaded').innerText = `${((info.uploadedLocal || 0) / 1024 / 1024).toFixed(2)} MB`
    if (el('p2p-local-downloaded')) el('p2p-local-downloaded').innerText = `${((info.downloadedLocal || 0) / 1024 / 1024).toFixed(2)} MB`

    // Global
    let globalStatusText = 'Отключен', globalStatusColor = '#ff4444'
    if (info.running) {
        globalStatusText = 'Активен', globalStatusColor = '#7dbb00'
        if (info.mode && info.mode.includes('Passive')) {
            globalStatusText = 'Активен (Режим экономии)', globalStatusColor = '#ffbb00'
        }
    }
    const gStatus = el('p2p-global-status')
    if (gStatus) {
        gStatus.innerHTML = `${globalStatusText} ${info.running ? spinner : ''}`
        gStatus.style.color = globalStatusColor
    }

    const details = el('p2p-global-details')
    const disabled = el('p2p-global-disabled')
    if (details && disabled) {
        details.style.display = info.running ? 'block' : 'none'
        disabled.style.display = info.running ? 'none' : 'flex'
    }



    if (info.running) {
        if (el('p2p-global-topic')) el('p2p-global-topic').innerText = info.topic
        if (el('p2p-global-dl-speed')) el('p2p-global-dl-speed').innerText = formatSpeed(info.downloadSpeed || 0)
        if (el('p2p-global-ul-speed')) el('p2p-global-ul-speed').innerText = formatSpeed(info.uploadSpeed || 0)
        const gDht = el('p2p-global-dht')
        if (gDht) {
            gDht.innerHTML = `${info.dhtNodes || 0} <span style="color: ${info.bootstrapped ? '#7dbb00' : '#666'}; margin-left: 4px; font-weight: normal;">(${info.bootstrapNodes})</span>`
            gDht.style.color = info.dhtNodes > 0 ? '#7dbb00' : '#ff4444'
        }
        if (el('p2p-global-peers')) el('p2p-global-peers').innerText = info.globalPeers || 0
        const gSessions = el('p2p-global-sessions')
        if (gSessions) {
            gSessions.innerHTML = `${info.uploads} <span style="color: #666; font-size: 11px; margin-left: 4px;">(Upload)</span> ${info.uploads > 0 ? spinner : ''}`
        }
        const gMode = el('p2p-global-mode')
        if (gMode) {
            gMode.innerText = info.mode && info.mode.includes('Active') ? 'Активный (Полный)' : 'Ограниченный (Загрузка)'
            gMode.style.color = info.mode && info.mode.includes('Active') ? '#7dbb00' : '#ffbb00'
        }
        if (el('p2p-global-uploaded')) el('p2p-global-uploaded').innerText = `${((info.uploadedGlobal || 0) / 1024 / 1024).toFixed(2)} MB`
        if (el('p2p-global-downloaded')) el('p2p-global-downloaded').innerText = `${((info.downloadedGlobal || 0) / 1024 / 1024).toFixed(2)} MB`
    }
    return true
}

// Bind P2P Info Button
function bindP2PInfoButton() {
    const p2pInfoBtn = document.getElementById('settingsP2PInfoButton')
    if (p2pInfoBtn) {
        // Clone to remove existing listeners if any, then re-add
        const newBtn = p2pInfoBtn.cloneNode(true)
        p2pInfoBtn.parentNode.replaceChild(newBtn, p2pInfoBtn)

        newBtn.onclick = async () => {
            let intervalId = null
            try {
                // Initial fetch
                let info = {
                    connected: false,
                    connections: 0,
                    downloaded: 0,
                    uploaded: 0,
                    downloadSpeed: 0,
                    uploadSpeed: 0,
                    mode: 'Unknown'
                }

                try {
                    info = await ipcRenderer.invoke('p2p:getInfo')
                } catch (e) {
                    console.error('Failed to get initial P2P info', e)
                }

                const closeOverlay = () => {
                    if (intervalId) clearInterval(intervalId)
                    toggleOverlay(false)
                }

                setOverlayContent(
                    'Статистика P2P Сети',
                    '',
                    'Закрыть'
                )
                document.getElementById('overlayDesc').innerHTML = getP2PStatsMarkup(info)

                setOverlayHandler(closeOverlay)
                setDismissHandler(closeOverlay)

                // Button handler for 'Update' (Middle button) if we wanted one, 
                // but here we used 'Закрыть' as the primary action.
                // The overlay function signature is (title, html, dismissText, [confirmText])
                // We'll just rely on the interval for updates.

                toggleOverlay(true)

                // Update loop
                intervalId = setInterval(async () => {
                    // Check if overlay is still open
                    if (!document.getElementById('p2pInfoStats') || !isOverlayVisible()) {
                        clearInterval(intervalId)
                        return
                    }
                    try {
                        const newInfo = await ipcRenderer.invoke('p2p:getInfo')
                        updateP2PStatsUI(newInfo)
                    } catch (e) {
                        console.error('Failed to update P2P stats', e)
                    }
                }, 1000)

            } catch (err) {
                console.error('Info Error', err)
                setOverlayContent('Ошибка', 'Не удалось загрузить статистику P2P.', 'Закрыть')
                setOverlayHandler(() => toggleOverlay(false))
                toggleOverlay(true)
            }
        }
    } else {
        console.error('bindP2PInfoButton: Button not found!')
    }
}

/**
 * Save the settings values.
 */
async function saveSettingsValues() {
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent') // Means the first argument is the server id.
        const sFn = ConfigManager['set' + cVal]
        const sFnOpts = []
        if (serverDependent) {
            sFnOpts.push(ConfigManager.getSelectedServer())
        }
        if (typeof sFn === 'function') {
            if (v.tagName === 'INPUT') {
                if (v.type === 'number' || v.type === 'text') {
                    // Special Conditions
                    if (cVal === 'JVMOptions') {
                        if (!v.value.trim()) {
                            sFnOpts.push([])
                            sFn.apply(null, sFnOpts)
                        } else {
                            sFnOpts.push(v.value.trim().split(/\s+/))
                            sFn.apply(null, sFnOpts)
                        }
                    } else {
                        sFnOpts.push(v.value)
                        sFn.apply(null, sFnOpts)
                    }
                } else if (v.type === 'checkbox') {
                    sFnOpts.push(v.checked)
                    sFn.apply(null, sFnOpts)
                    // Special Conditions
                    if (cVal === 'AllowPrerelease') {
                        changeAllowPrerelease(v.checked)
                    }
                }
            } else if (v.tagName === 'DIV') {
                if (v.classList.contains('rangeSlider')) {
                    // Special Conditions
                    if (cVal === 'MinRAM' || cVal === 'MaxRAM') {
                        let val = Number(v.getAttribute('value'))
                        if (val % 1 > 0) {
                            val = val * 1024 + 'M'
                        } else {
                            val = val + 'G'
                        }

                        sFnOpts.push(val)
                        sFn.apply(null, sFnOpts)
                    } else {
                        sFnOpts.push(v.getAttribute('value'))
                        sFn.apply(null, sFnOpts)
                    }
                }
            }
        }
    })

    await ConfigManager.save()

    // Apply P2P Settings immediately


    // Notify Main Process to update P2P Engine
    ipcRenderer.invoke('p2p:configUpdate')
}

let selectedSettingsTab = 'settingsTabAccount'

async function populateMirrorStatus() {
    const container = document.getElementById('settingsMirrorStatusContainer')
    if (!container) return

    try {
        const mirrors = await ipcRenderer.invoke('mirrors:getStatus')
        if (!mirrors || mirrors.length === 0) {
            container.innerHTML = '<div style="text-align: center; color: #888; padding: 10px;">Зеркала не настроены или отключены.</div>'
            return
        }

        let html = ''
        mirrors.forEach(m => {
            let statusColor = '#888'
            let statusText = 'Неизвестно'
            if (m.status === 'active') { statusColor = '#7dbb00'; statusText = 'Активно' }
            else if (m.status === 'slow') { statusColor = '#ffbb00'; statusText = 'Медленно' }
            else if (m.status === 'down') { statusColor = '#ff4444'; statusText = 'Недоступно' }

            html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                <div style="font-weight: 600; color: #eee;">${m.name}</div>
                <div style="display: flex; gap: 15px; align-items: center;">
                    <span style="color: #aaa; font-size: 13px;">${m.latency >= 0 ? m.latency + ' ms' : '--'}</span>
                    <span style="color: ${statusColor}; font-size: 13px; font-weight: bold;">${statusText}</span>
                </div>
            </div>`
        })
        container.innerHTML = html
    } catch (e) {
        console.error('Failed to load mirror status', e)
        container.innerHTML = '<div style="text-align: center; color: #ff4444; padding: 10px;">Ошибка загрузки статуса зеркал.</div>'
    }
}

/**
 * Modify the settings container UI when the scroll threshold reaches
 * a certain poin.
 *
 * @param {UIEvent} e The scroll event.
 */
function settingsTabScrollListener(e) {
    if (e.target.scrollTop > Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)) {
        document.getElementById('settingsContainer').setAttribute('scrolled', '')
    } else {
        document.getElementById('settingsContainer').removeAttribute('scrolled')
    }
}

/**
 * Bind functionality for the settings navigation items.
 */
function setupSettingsTabs() {
    Array.from(document.getElementsByClassName('settingsNavItem')).map((val) => {
        if (val.hasAttribute('rSc')) {
            val.onclick = () => {
                settingsNavItemListener(val)
            }
        }
    })
}

/**
 * Settings nav item onclick lisener. Function is exposed so that
 * other UI elements can quickly toggle to a certain tab from other views.
 *
 * @param {Element} ele The nav item which has been clicked.
 * @param {boolean} fade Optional. True to fade transition.
 */
function settingsNavItemListener(ele, fade = true) {
    const nextTab = ele.getAttribute('rSc')
    if (ele.hasAttribute('selected')) {
        // If already selected, just ensure it's visible.
        const tab = document.getElementById(nextTab)
        if (tab && (tab.style.display === 'none' || getComputedStyle(tab).display === 'none')) {
            if (fade) {
                fadeIn(tab, 250, () => {
                    settingsTabScrollListener({ target: tab })
                })
            } else {
                show(tab)
                settingsTabScrollListener({ target: tab })
            }
        }
        return
    }
    const navItems = document.getElementsByClassName('settingsNavItem')
    for (let i = 0; i < navItems.length; i++) {
        if (navItems[i].hasAttribute('selected')) {
            navItems[i].removeAttribute('selected')
        }
    }
    ele.setAttribute('selected', '')
    let prevTab = selectedSettingsTab
    selectedSettingsTab = nextTab

    if (selectedSettingsTab === 'settingsTabDelivery') {
        populateMirrorStatus()
    } else if (selectedSettingsTab === 'settingsTabAccount') {
        prepareAccountsTab()
    }

    if (prevTab && document.getElementById(prevTab)) {
        document.getElementById(prevTab).onscroll = null
    }
    document.getElementById(selectedSettingsTab).onscroll = settingsTabScrollListener

    if (fade) {
        if (prevTab && document.getElementById(prevTab)) {
            fadeOut(document.getElementById(prevTab), 250, () => {
                fadeIn(document.getElementById(selectedSettingsTab), 250, () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                })
            })
        } else {
            fadeIn(document.getElementById(selectedSettingsTab), 250, () => {
                settingsTabScrollListener({
                    target: document.getElementById(selectedSettingsTab)
                })
            })
        }
    } else {
        if (prevTab && document.getElementById(prevTab)) {
            hide(document.getElementById(prevTab))
        }
        show(document.getElementById(selectedSettingsTab))
        settingsTabScrollListener({
            target: document.getElementById(selectedSettingsTab)
        })
    }
}

const settingsNavDone = document.getElementById('settingsNavDone')

/**
 * Set if the settings save (done) button is disabled.
 *
 * @param {boolean} v True to disable, false to enable.
 */
function settingsSaveDisabled(v) {
    settingsNavDone.disabled = v
}

function fullSettingsSave() {
    saveSettingsValues()
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
    saveShaderpackSettings()
    ipcRenderer.invoke('p2p:configUpdate')
}

/* Closes the settings view and saves all data. */
settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/**
 * Account Management Tab
 */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

// Bind the add mojang account button.
document.getElementById('settingsAddMojangAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnCancel = VIEWS.settings
        loginViewOnSuccess = VIEWS.settings
        loginCancelEnabled(true)
    })
}

// Bind the add microsoft account button.
document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings)
    })
}

// Bind reply for Microsoft Login.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {

        const viewOnClose = arguments_[2]
        console.log(arguments_)
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {

            if (arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLoginLogger.info('Login cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]

        // Error from request to Microsoft.
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                // TODO Dont know what these errors are. Just show them I guess.
                // This is probably if you messed up the app registration with Azure.
                let error = queryMap.error // Error might be 'access_denied' ?
                let errorDesc = queryMap.error_description
                console.log('Error getting authCode, is Azure application registered correctly?')
                console.log(error)
                console.log(errorDesc)
                console.log('Full query map: ', queryMap)
                setOverlayContent(
                    error,
                    errorDesc,
                    Lang.queryJS('settings.msftLogin.okButton')
                )
                setOverlayHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true)

            })
        } else {

            msftLoginLogger.info('Acquired authCode, proceeding with authentication.')

            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            })
                .catch((displayableError) => {

                    let actualDisplayableError
                    if (isDisplayableError(displayableError)) {
                        msftLoginLogger.error('Error while logging in.', displayableError)
                        actualDisplayableError = displayableError
                    } else {
                        // Uh oh.
                        msftLoginLogger.error('Unhandled error during login.', displayableError)
                        actualDisplayableError = Lang.queryJS('login.error.unknown')
                    }

                    switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                        setOverlayHandler(() => {
                            toggleOverlay(false)
                        })
                        toggleOverlay(true)
                    })
                })
        }
    }
})

/**
 * Bind functionality for the account selection buttons. If another account
 * is selected, the UI of the previously selected account will be updated.
 */
function bindAuthAccountSelect() {
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if (val.hasAttribute('selected')) {
                return
            }
            const selectBtns = document.getElementsByClassName('settingsAuthAccountSelect')
            for (let i = 0; i < selectBtns.length; i++) {
                if (selectBtns[i].hasAttribute('selected')) {
                    selectBtns[i].removeAttribute('selected')
                    selectBtns[i].innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
                }
            }
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

/**
 * Bind functionality for the log out button. If the logged out account was
 * the selected account, another account will be selected and the UI will
 * be updated accordingly.
 */
function bindAuthAccountLogOut() {
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if (Object.keys(ConfigManager.getAuthAccounts()).length === 1) {
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false)
                })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }

        }
    })
}

let msAccDomElementCache
/**
 * Process a log out.
 *
 * @param {Element} val The log out button element.
 * @param {boolean} isLastAccount If this logout is on the last added account.
 */
function processLogOut(val, isLastAccount) {
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    if (targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        AuthManager.removeMojangAccount(uuid).then(() => {
            if (!isLastAccount && uuid === prevSelAcc.uuid) {
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if (isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        fadeOut(parent, 250, () => {
            parent.remove()
        })
    }
}

// Bind reply for Microsoft Logout.
ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {

            if (arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) {
                // User cancelled.
                msftLogoutLogger.info('Logout cancelled by user.')
                return
            }

            // Unexpected error.
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        })
    } else if (arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {

        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()

        msftLogoutLogger.info('Logout Successful. uuid:', uuid)

        AuthManager.removeMicrosoftAccount(uuid)
            .then(() => {
                if (!isLastAccount && uuid === prevSelAcc.uuid) {
                    const selAcc = ConfigManager.getSelectedAccount()
                    refreshAuthAccountSelected(selAcc.uuid)
                    updateSelectedAccount(selAcc)
                    validateSelectedAccount()
                }
                if (isLastAccount) {
                    loginOptionsCancelEnabled(false)
                    loginOptionsViewOnLoginSuccess = VIEWS.settings
                    loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                    switchView(getCurrentView(), VIEWS.loginOptions)
                }
                if (msAccDomElementCache) {
                    msAccDomElementCache.remove()
                    msAccDomElementCache = null
                }
            })
            .finally(() => {
                if (!isLastAccount) {
                    switchView(getCurrentView(), VIEWS.settings, 500, 500)
                }
            })

    }
})

/**
 * Refreshes the status of the selected account on the auth account
 * elements.
 *
 * @param {string} uuid The UUID of the new selected account.
 */
function refreshAuthAccountSelected(uuid) {
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if (uuid === val.getAttribute('uuid')) {
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            if (selBtn.hasAttribute('selected')) {
                selBtn.removeAttribute('selected')
            }
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')
const settingsCurrentMojangAccounts = document.getElementById('settingsCurrentMojangAccounts')

/**
 * Add auth account elements for each one stored in the authentication database.
 */
function populateAuthAccounts() {
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if (authKeys.length === 0) {
        return
    }
    const selectedUUID = ConfigManager.getSelectedAccount().uuid

    let microsoftAuthAccountStr = ''
    let mojangAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]

        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/body/${acc.uuid}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.username')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.uuid')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
                    </div>
                </div>
            </div>
        </div>`

        if (acc.type === 'microsoft') {
            microsoftAuthAccountStr += accHtml
        } else {
            mojangAuthAccountStr += accHtml
        }

    })

    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
    settingsCurrentMojangAccounts.innerHTML = mojangAuthAccountStr
}

/**
 * Prepare the accounts tab for display.
 */
function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

/**
 * Minecraft Tab
 */

/**
  * Disable decimals, negative signs, and scientific notation.
  */
document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => {
    if (/^[-.eE]$/.test(e.key)) {
        e.preventDefault()
    }
})
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => {
    if (/^[-.eE]$/.test(e.key)) {
        e.preventDefault()
    }
})

/**
 * Mods Tab
 */

const settingsModsContainer = document.getElementById('settingsModsContainer')

/**
 * Resolve and update the mods on the UI.
 */
async function resolveModsForUI() {
    const serv = ConfigManager.getSelectedServer()

    const distro = await DistroAPI.getDistribution()
    const servConf = ConfigManager.getModConfiguration(serv)

    const modStr = parseModulesForUI(distro.getServerById(serv).modules, false, servConf.mods)

    document.getElementById('settingsReqModsContent').innerHTML = modStr.reqMods
    document.getElementById('settingsOptModsContent').innerHTML = modStr.optMods
}

/**
 * Recursively build the mod UI elements.
 *
 * @param {Object[]} mdls An array of modules to parse.
 * @param {boolean} submodules Whether or not we are parsing submodules.
 * @param {Object} servConf The server configuration object for this module level.
 */
function parseModulesForUI(mdls, submodules, servConf) {

    let reqMods = ''
    let optMods = ''

    for (const mdl of mdls) {

        if (mdl.rawModule.type === Type.ForgeMod || mdl.rawModule.type === Type.LiteMod || mdl.rawModule.type === Type.LiteLoader || mdl.rawModule.type === Type.FabricMod) {

            if (mdl.getRequired().value) {

                reqMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" enabled>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch" reqmod>
                            <input type="checkbox" checked>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, servConf[mdl.getVersionlessMavenIdentifier()])).join('')}
                    </div>` : ''}
                </div>`

            } else {

                const conf = servConf[mdl.getVersionlessMavenIdentifier()]
                const val = typeof conf === 'object' ? conf.value : conf

                optMods += `<div id="${mdl.getVersionlessMavenIdentifier()}" class="settingsBaseMod settings${submodules ? 'Sub' : ''}Mod" ${val ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${mdl.rawModule.name}</span>
                                <span class="settingsModVersion">v${mdl.mavenComponents.version}</span>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${mdl.getVersionlessMavenIdentifier()}" ${val ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                    ${mdl.subModules.length > 0 ? `<div class="settingsSubModContainer">
                        ${Object.values(parseModulesForUI(mdl.subModules, true, conf.mods)).join('')}
                    </div>` : ''}
                </div>`

            }
        }
    }

    return {
        reqMods,
        optMods
    }

}

/**
 * Bind functionality to mod config toggle switches. Switching the value
 * will also switch the status color on the left of the mod UI.
 */
function bindModsToggleSwitch() {
    const sEls = settingsModsContainer.querySelectorAll('[formod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onchange = () => {
            if (v.checked) {
                document.getElementById(v.getAttribute('formod')).setAttribute('enabled', '')
            } else {
                document.getElementById(v.getAttribute('formod')).removeAttribute('enabled')
            }
        }
    })
}


/**
 * Save the mod configuration based on the UI values.
 */
function saveModConfiguration() {
    const serv = ConfigManager.getSelectedServer()
    const modConf = ConfigManager.getModConfiguration(serv)
    modConf.mods = _saveModConfiguration(modConf.mods)
    ConfigManager.setModConfiguration(serv, modConf)
}

/**
 * Recursively save mod config with submods.
 *
 * @param {Object} modConf Mod config object to save.
 */
function _saveModConfiguration(modConf) {
    for (let m of Object.entries(modConf)) {
        const tSwitch = settingsModsContainer.querySelectorAll(`[formod='${m[0]}']`)

        if (tSwitch.length > 0) {
            if (tSwitch[0].hasAttribute('dropin')) {
                continue
            }
            if (typeof m[1] === 'boolean') {
                modConf[m[0]] = tSwitch[0].checked
            } else if (m[1] != null) {
                modConf[m[0]].value = tSwitch[0].checked
                if (m[1].mods) {
                    modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods)
                }
            }
        } else {
            if (typeof m[1] === 'object' && m[1] != null && m[1].mods) {
                modConf[m[0]].mods = _saveModConfiguration(modConf[m[0]].mods)
            }
        }
    }
    return modConf
}

// Drop-in mod elements.

let CACHE_SETTINGS_MODS_DIR
let CACHE_DROPIN_MODS

/**
 * Resolve any located drop-in mods for this server and
 * populate the results onto the UI.
 */
async function resolveDropinModsForUI() {
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_MODS_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id, 'mods')
    CACHE_DROPIN_MODS = DropinModUtil.scanForDropinMods(CACHE_SETTINGS_MODS_DIR, serv.rawServer.minecraftVersion)

    let dropinMods = ''

    for (dropin of CACHE_DROPIN_MODS) {
        dropinMods += `<div id="${dropin.fullName}" class="settingsBaseMod settingsDropinMod" ${!dropin.disabled ? 'enabled' : ''}>
                    <div class="settingsModContent">
                        <div class="settingsModMainWrapper">
                            <div class="settingsModStatus"></div>
                            <div class="settingsModDetails">
                                <span class="settingsModName">${dropin.name}</span>
                                <div class="settingsDropinRemoveWrapper">
                                    <button class="settingsDropinRemoveButton" remmod="${dropin.fullName}">${Lang.queryJS('settings.dropinMods.removeButton')}</button>
                                </div>
                            </div>
                        </div>
                        <label class="toggleSwitch">
                            <input type="checkbox" formod="${dropin.fullName}" dropin ${!dropin.disabled ? 'checked' : ''}>
                            <span class="toggleSwitchSlider"></span>
                        </label>
                    </div>
                </div>`
    }

    document.getElementById('settingsDropinModsContent').innerHTML = dropinMods
}

/**
 * Bind the remove button for each loaded drop-in mod.
 */
function bindDropinModsRemoveButton() {
    const sEls = settingsModsContainer.querySelectorAll('[remmod]')
    Array.from(sEls).map((v, index, arr) => {
        v.onclick = async () => {
            const fullName = v.getAttribute('remmod')
            const res = await DropinModUtil.deleteDropinMod(CACHE_SETTINGS_MODS_DIR, fullName)
            if (res) {
                document.getElementById(fullName).remove()
            } else {
                setOverlayContent(
                    Lang.queryJS('settings.dropinMods.deleteFailedTitle', { fullName }),
                    Lang.queryJS('settings.dropinMods.deleteFailedMessage'),
                    Lang.queryJS('settings.dropinMods.okButton')
                )
                setOverlayHandler(null)
                toggleOverlay(true)
            }
        }
    })
}

/**
 * Bind functionality to the file system button for the selected
 * server configuration.
 */
function bindDropinModFileSystemButton() {
    const fsBtn = document.getElementById('settingsDropinFileSystemButton')
    fsBtn.onclick = () => {
        DropinModUtil.validateDir(CACHE_SETTINGS_MODS_DIR)
        shell.openPath(CACHE_SETTINGS_MODS_DIR)
    }
    fsBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        fsBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    fsBtn.ondragover = e => {
        e.preventDefault()
    }
    fsBtn.ondragleave = e => {
        fsBtn.removeAttribute('drag')
    }

    fsBtn.ondrop = async e => {
        fsBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addDropinMods(e.dataTransfer.files, CACHE_SETTINGS_MODS_DIR)
        await reloadDropinMods()
    }
}

/**
 * Save drop-in mod states. Enabling and disabling is just a matter
 * of adding/removing the .disabled extension.
 */
function saveDropinModConfiguration() {
    if (!CACHE_DROPIN_MODS) return;
    for (dropin of CACHE_DROPIN_MODS) {
        const dropinUI = document.getElementById(dropin.fullName)
        if (dropinUI != null) {
            const dropinUIEnabled = dropinUI.hasAttribute('enabled')
            if (DropinModUtil.isDropinModEnabled(dropin.fullName) != dropinUIEnabled) {
                DropinModUtil.toggleDropinMod(CACHE_SETTINGS_MODS_DIR, dropin.fullName, dropinUIEnabled).catch(err => {
                    if (!isOverlayVisible()) {
                        setOverlayContent(
                            Lang.queryJS('settings.dropinMods.failedToggleTitle'),
                            err.message,
                            Lang.queryJS('settings.dropinMods.okButton')
                        )
                        setOverlayHandler(null)
                        toggleOverlay(true)
                    }
                })
            }
        }
    }
}

// Refresh the drop-in mods when F5 is pressed.
// Only active on the mods tab.
document.addEventListener('keydown', async (e) => {
    if (getCurrentView() === VIEWS.settings && selectedSettingsTab === 'settingsTabMods') {
        if (e.key === 'F5') {
            await reloadDropinMods()
            saveShaderpackSettings()
            await resolveShaderpacksForUI()
        }
    }
})

async function reloadDropinMods() {
    await resolveDropinModsForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindModsToggleSwitch()
}

// Shaderpack

let CACHE_SETTINGS_INSTANCE_DIR
let CACHE_SHADERPACKS
let CACHE_SELECTED_SHADERPACK

/**
 * Load shaderpack information.
 */
async function resolveShaderpacksForUI() {
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(CACHE_SETTINGS_INSTANCE_DIR)
    CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR)

    setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK)
}

function setShadersOptions(arr, selected) {
    const cont = document.getElementById('settingsShadersOptions')
    cont.innerHTML = ''
    for (let opt of arr) {
        const d = document.createElement('DIV')
        d.innerHTML = opt.name
        d.setAttribute('value', opt.fullName)
        if (opt.fullName === selected) {
            d.setAttribute('selected', '')
            document.getElementById('settingsShadersSelected').innerHTML = opt.name
        }
        d.addEventListener('click', function (e) {
            this.parentNode.previousElementSibling.innerHTML = this.innerHTML
            for (let sib of this.parentNode.children) {
                sib.removeAttribute('selected')
            }
            this.setAttribute('selected', '')
            closeSettingsSelect()
        })
        cont.appendChild(d)
    }
}

function saveShaderpackSettings() {
    let sel = 'OFF'
    for (let opt of document.getElementById('settingsShadersOptions').childNodes) {
        if (opt.hasAttribute('selected')) {
            sel = opt.getAttribute('value')
        }
    }
    DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel)
}

function bindShaderpackButton() {
    const spBtn = document.getElementById('settingsShaderpackButton')
    spBtn.onclick = () => {
        const p = path.join(CACHE_SETTINGS_INSTANCE_DIR, 'shaderpacks')
        DropinModUtil.validateDir(p)
        shell.openPath(p)
    }
    spBtn.ondragenter = e => {
        e.dataTransfer.dropEffect = 'move'
        spBtn.setAttribute('drag', '')
        e.preventDefault()
    }
    spBtn.ondragover = e => {
        e.preventDefault()
    }
    spBtn.ondragleave = e => {
        spBtn.removeAttribute('drag')
    }

    spBtn.ondrop = async e => {
        spBtn.removeAttribute('drag')
        e.preventDefault()

        DropinModUtil.addShaderpacks(e.dataTransfer.files, CACHE_SETTINGS_INSTANCE_DIR)
        saveShaderpackSettings()
        await resolveShaderpacksForUI()
    }
}

// Server status bar functions.

/**
 * Load the currently selected server information onto the mods tab.
 */
async function loadSelectedServerOnModsTab() {
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    for (const el of document.getElementsByClassName('settingsSelServContent')) {
        el.innerHTML = `
            <img class="serverListingImg" src="${serv.rawServer.icon}"/>
            <div class="serverListingDetails">
                <span class="serverListingName">${serv.rawServer.name}</span>
                <span class="serverListingDescription">${serv.rawServer.description}</span>
                <div class="serverListingInfo">
                    <div class="serverListingVersion">${serv.rawServer.minecraftVersion}</div>
                    <div class="serverListingRevision">${serv.rawServer.version}</div>
                    ${serv.rawServer.mainServer ? `<div class="serverListingStarWrapper">
                        <svg id="Layer_1" viewBox="0 0 107.45 104.74" width="20px" height="20px">
                            <defs>
                                <style>.cls-1{fill:#fff;}.cls-2{fill:none;stroke:#fff;stroke-miterlimit:10;}</style>
                            </defs>
                            <path class="cls-1" d="M100.93,65.54C89,62,68.18,55.65,63.54,52.13c2.7-5.23,18.8-19.2,28-27.55C81.36,31.74,63.74,43.87,58.09,45.3c-2.41-5.37-3.61-26.52-4.37-39-.77,12.46-2,33.64-4.36,39-5.7-1.46-23.3-13.57-33.49-20.72,9.26,8.37,25.39,22.36,28,27.55C39.21,55.68,18.47,62,6.52,65.55c12.32-2,33.63-6.06,39.34-4.9-.16,5.87-8.41,26.16-13.11,37.69,6.1-10.89,16.52-30.16,21-33.9,4.5,3.79,14.93,23.09,21,34C70,86.84,61.73,66.48,61.59,60.65,67.36,59.49,88.64,63.52,100.93,65.54Z"/>
                            <circle class="cls-2" cx="53.73" cy="53.9" r="38"/>
                        </svg>
                        <span class="serverListingStarTooltip">${Lang.queryJS('settings.serverListing.mainServer')}</span>
                    </div>` : ''}
                </div>
            </div>
        `
    }
}

// Bind functionality to the server switch button.
Array.from(document.getElementsByClassName('settingsSwitchServerButton')).forEach(el => {
    el.addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
})

/**
 * Save mod configuration for the current selected server.
 */
function saveAllModConfigurations() {
    saveModConfiguration()
    ConfigManager.save()
    saveDropinModConfiguration()
}

/**
 * Function to refresh the current tab whenever the selected
 * server is changed.
 */
function animateSettingsTabRefresh() {
    fadeOut(document.getElementById(selectedSettingsTab), 500, async () => {
        await prepareSettings()
        fadeIn(document.getElementById(selectedSettingsTab), 500)
    })
}

/**
 * Prepare the Mods tab for display.
 */
async function prepareModsTab(first) {
    await resolveModsForUI()
    await resolveDropinModsForUI()
    await resolveShaderpacksForUI()
    bindDropinModsRemoveButton()
    bindDropinModFileSystemButton()
    bindShaderpackButton()
    bindModsToggleSwitch()
    await loadSelectedServerOnModsTab()
}

/**
 * Java Tab
 */

// DOM Cache
const settingsMaxRAMRange = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail = document.getElementById('settingsMemoryAvail')
const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink = document.getElementById('settingsJvmOptsLink')

// Bind on change event for min memory container.
settingsMinRAMRange.onchange = (e) => {

    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem() / 1073741824

    // Change range bar color based on the selected value.
    if (sMinV >= max / 2) {
        bar.style.background = '#e86060'
    } else if (sMinV >= max / 4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Increase maximum memory if the minimum exceeds its value.
    if (sMaxV < sMinV) {
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV,
            ((sMinV - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
    }

    // Update label
    settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
}

// Bind on change event for max memory container.
settingsMaxRAMRange.onchange = (e) => {
    // Current range values
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))

    // Get reference to range bar.
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    // Calculate effective total memory.
    const max = os.totalmem() / 1073741824

    // Change range bar color based on the selected value.
    if (sMaxV >= max / 2) {
        bar.style.background = '#e86060'
    } else if (sMaxV >= max / 4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }

    // Decrease the minimum memory if the maximum value is less.
    if (sMaxV < sMinV) {
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV,
            ((sMaxV - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
    }
    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
}

/**
 * Calculate common values for a ranged slider.
 *
 * @param {Element} v The range slider to calculate against.
 * @returns {Object} An object with meta values for the provided ranged slider.
 */
function calculateRangeSliderMeta(v) {
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max - val.min) / val.step
    val.inc = 100 / val.ticks
    return val
}

/**
 * Binds functionality to the ranged sliders. They're more than
 * just divs now :').
 */
function bindRangeSlider() {
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {

        // Reference the track (thumb).
        const track = v.getElementsByClassName('rangeSliderTrack')[0]

        // Set the initial slider value.
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)

        updateRangedSlider(v, value, ((value - sliderMeta.min) / sliderMeta.step) * sliderMeta.inc)

        // The magic happens when we click on the track.
        track.onmousedown = (e) => {

            // Stop moving the track on mouse up.
            document.onmouseup = (e) => {
                document.onmousemove = null
                document.onmouseup = null
            }

            // Move slider according to the mouse position.
            document.onmousemove = (e) => {

                // Distance from the beginning of the bar in pixels.
                const diff = e.pageX - v.offsetLeft - track.offsetWidth / 2

                // Don't move the track off the bar.
                if (diff >= 0 && diff <= v.offsetWidth - track.offsetWidth / 2) {

                    // Convert the difference to a percentage.
                    const perc = (diff / v.offsetWidth) * 100
                    // Calculate the percentage of the closest notch.
                    const notch = Number(perc / sliderMeta.inc).toFixed(0) * sliderMeta.inc

                    // If we're close to that notch, stick to it.
                    if (Math.abs(perc - notch) < sliderMeta.inc / 2) {
                        updateRangedSlider(v, sliderMeta.min + (sliderMeta.step * (notch / sliderMeta.inc)), notch)
                    }
                }
            }
        }
    })
}

/**
 * Update a ranged slider's value and position.
 *
 * @param {Element} element The ranged slider to update.
 * @param {string | number} value The new value for the ranged slider.
 * @param {number} notch The notch that the slider should now be at.
 */
function updateRangedSlider(element, value, notch) {
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]

    element.setAttribute('value', value)

    if (notch < 0) {
        notch = 0
    } else if (notch > 100) {
        notch = 100
    }

    const event = new MouseEvent('change', {
        target: element,
        type: 'change',
        bubbles: false,
        cancelable: true
    })

    let cancelled = !element.dispatchEvent(event)

    if (!cancelled) {
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
    } else {
        element.setAttribute('value', oldVal)
    }
}

/**
 * Display the total and available RAM.
 */
function populateMemoryStatus() {
    settingsMemoryTotal.innerHTML = Number((os.totalmem() - 1073741824) / 1073741824).toFixed(1) + 'G'
    settingsMemoryAvail.innerHTML = Number(os.freemem() / 1073741824).toFixed(1) + 'G'
}

/**
 * Validate the provided executable path and display the data on
 * the UI.
 *
 * @param {string} execPath The executable path to populate against.
 */
async function populateJavaExecDetails(execPath) {
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())

    const details = await validateSelectedJvm(ensureJavaDirIsRoot(execPath), server.effectiveJavaOptions.supported)

    if (details != null) {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.selectedJava', { version: details.semverStr, vendor: details.vendor })
    } else {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
    }
}

function populateJavaReqDesc(server) {
    settingsJavaReqDesc.innerHTML = Lang.queryJS('settings.java.requiresJava', { major: server.effectiveJavaOptions.suggestedMajor })
}

function populateJvmOptsLink(server) {
    const major = server.effectiveJavaOptions.suggestedMajor
    settingsJvmOptsLink.innerHTML = Lang.queryJS('settings.java.availableOptions', { major: major })
    if (major >= 12) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/en/java/javase/${major}/docs/specs/man/java.html#extra-options-for-java`
    }
    else if (major >= 11) {
        settingsJvmOptsLink.href = 'https://docs.oracle.com/en/java/javase/11/tools/java.html#GUID-3B1CE181-CD30-4178-9602-230B800D4FAE'
    }
    else if (major >= 9) {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/tools/java.htm`
    }
    else {
        settingsJvmOptsLink.href = `https://docs.oracle.com/javase/${major}/docs/technotes/tools/${process.platform === 'win32' ? 'windows' : 'unix'}/java.html`
    }
}

function bindMinMaxRam(server) {
    // Store maximum memory values.
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)

    // Set the max and min values for the ranged sliders.
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

/**
 * Prepare the Java tab for display.
 */
async function prepareJavaTab() {
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
}

/**
 * About Tab
 */

const settingsTabAbout = document.getElementById('settingsTabAbout')
const settingsAboutChangelogTitle = settingsTabAbout.getElementsByClassName('settingsChangelogTitle')[0]
const settingsAboutChangelogText = settingsTabAbout.getElementsByClassName('settingsChangelogText')[0]
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName('settingsChangelogButton')[0]

// Bind the devtools toggle button.
document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

/**
 * Return whether or not the provided version is a prerelease.
 *
 * @param {string} version The semver version to test.
 * @returns {boolean} True if the version is a prerelease, otherwise false.
 */
function isPrerelease(version) {
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

/**
 * Utility method to display version information on the
 * About and Update settings tabs.
 *
 * @param {string} version The semver version to display.
 * @param {Element} valueElement The value element.
 * @param {Element} titleElement The title element.
 * @param {Element} checkElement The check mark element.
 */
function populateVersionInformation(version, valueElement, titleElement, checkElement) {
    valueElement.innerHTML = version
    if (isPrerelease(version)) {
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

/**
 * Retrieve the version information and display it on the UI.
 */
function populateAboutVersionInformation() {
    populateVersionInformation(remote.app.getVersion(), document.getElementById('settingsAboutCurrentVersionValue'), document.getElementById('settingsAboutCurrentVersionTitle'), document.getElementById('settingsAboutCurrentVersionCheck'))
}

/**
 * Fetches the GitHub atom release feed and parses it for the release notes
 * of the current version. This value is displayed on the UI.
 */
function populateReleaseNotes() {
    fetch('https://github.com/Envel-Experimental/HeliosLauncher/releases.atom')
        .then(response => response.text())
        .then(data => {
            const version = 'v' + remote.app.getVersion()
            const parser = new DOMParser()
            const xmlDoc = parser.parseFromString(data, 'text/xml')
            const entries = xmlDoc.getElementsByTagName('entry')

            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i]
                let id = entry.getElementsByTagName('id')[0].textContent
                id = id.substring(id.lastIndexOf('/') + 1)

                if (id === version) {
                    settingsAboutChangelogTitle.innerHTML = entry.getElementsByTagName('title')[0].textContent
                    settingsAboutChangelogText.innerHTML = entry.getElementsByTagName('content')[0].textContent
                    settingsAboutChangelogButton.href = entry.getElementsByTagName('link')[0].getAttribute('href')
                }
            }

        })
        .catch(err => {
            console.error('Failed to fetch release notes', err)
            settingsAboutChangelogText.innerHTML = Lang.queryJS('settings.about.releaseNotesFailed')
        })
}


/**
 * Prepare account tab for display.
 */
function prepareAboutTab() {
    populateAboutVersionInformation()
    populateReleaseNotes()
}

/**
 * Update Tab
 */

const settingsTabUpdate = document.getElementById('settingsTabUpdate')
const settingsUpdateTitle = document.getElementById('settingsUpdateTitle')
const settingsUpdateVersionCheck = document.getElementById('settingsUpdateVersionCheck')
const settingsUpdateVersionTitle = document.getElementById('settingsUpdateVersionTitle')
const settingsUpdateVersionValue = document.getElementById('settingsUpdateVersionValue')
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName('settingsChangelogTitle')[0]
const settingsUpdateChangelogText = settingsTabUpdate.getElementsByClassName('settingsChangelogText')[0]
const settingsUpdateChangelogCont = settingsTabUpdate.getElementsByClassName('settingsChangelogContainer')[0]
const settingsUpdateActionButton = document.getElementById('settingsUpdateActionButton')

/**
 * Update the properties of the update action button.
 *
 * @param {string} text The new button text.
 * @param {boolean} disabled Optional. Disable or enable the button
 * @param {function} handler Optional. New button event handler.
 */
function settingsUpdateButtonStatus(text, disabled = false, handler = null) {
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if (handler != null) {
        settingsUpdateActionButton.onclick = handler
    }
}

/**
 * Populate the update tab with relevant information.
 *
 * @param {Object} data The update data.
 */
function populateSettingsUpdateInformation(data) {
    if (data != null) {
        settingsUpdateTitle.innerHTML = isPrerelease(data.version) ? Lang.queryJS('settings.updates.newPreReleaseTitle') : Lang.queryJS('settings.updates.newReleaseTitle')
        settingsUpdateChangelogCont.style.display = null
        settingsUpdateChangelogTitle.innerHTML = data.releaseName
        settingsUpdateChangelogText.innerHTML = data.releaseNotes
        populateVersionInformation(data.version, settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)

        if (process.platform === 'darwin') {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadButton'), false, () => {
                shell.openExternal(data.darwindownload)
            })
        } else {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadingButton'), true)
        }
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateChangelogCont.style.display = 'none'
        populateVersionInformation(remote.app.getVersion(), settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if (!isDev) {
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
}

/**
 * Prepare update tab for display.
 *
 * @param {Object} data The update data.
 */
function prepareUpdateTab(data = null) {
    populateSettingsUpdateInformation(data)
}

/**
 * Settings preparation functions.
 */

/**
  * Prepare the entire settings UI.
  *
  * @param {boolean} first Whether or not it is the first load.
  */
async function prepareSettings(first = false) {
    if (first) {
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
    } else {
        await prepareModsTab()
    }
    await initSettingsValues()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
    bindP2PInfoButton()
}

/**
 * Bind Factory Reset Buttons
 */
function bindFactoryReset() {
    const btn = document.getElementById('settingsFactoryResetButton')
    if (btn) {
        btn.onclick = () => {
            setOverlayContent(
                Lang.query('ejs.settings.factoryReset.confirmTitle'),
                Lang.query('ejs.settings.factoryReset.confirmDesc'),
                Lang.query('ejs.settings.factoryReset.confirmButton'),
                Lang.query('ejs.settings.factoryReset.cancelButton')
            )
            setOverlayHandler(() => {
                toggleOverlay(false)
                factoryReset()
            })
            setMiddleButtonHandler(() => {
                toggleOverlay(false)
            })
            toggleOverlay(true)
        }
    }
}

bindFactoryReset()

async function factoryReset() {
    const dataDir = ConfigManager.getDataDirectory()

    // Whitelist of files/folders to KEEP.
    // Everything else will be deleted.
    const whitelist = [
        'options.txt',
        'optionsof.txt',
        'servers.dat',
        'servers.dat_old',
        'usercache.json',
        'launcher_profiles.json',
        'saves',
        'screenshots',
        'resourcepacks',
        'shaderpacks',
        'logs',
        'schematics'
    ]

    try {
        const files = await fs.readdir(dataDir)

        // Show loading
        setOverlayContent(
            Lang.query('ejs.settings.factoryReset.title'),
            'Processing...',
            ''
        )
        toggleOverlay(true)

        for (const file of files) {
            if (whitelist.includes(file)) {
                continue
            }

            const fullPath = sysPath.join(dataDir, file)
            try {
                await fs.remove(fullPath)
                console.log('Factory Reset: Deleted', fullPath)
            } catch (err) {
                console.warn('Factory Reset: Failed to delete', fullPath, err)
            }
        }

        // Success & Restart
        setOverlayContent(
            Lang.query('ejs.settings.factoryReset.title'),
            Lang.query('ejs.settings.factoryReset.success'),
            Lang.queryJS('uicore.update.updateButton') // Reuse 'Update' button style/text or simple OK
        )
        // Force restart
        setTimeout(() => {
            remote.app.relaunch()
            remote.app.exit(0)
        }, 1500)

    } catch (err) {
        console.error('Factory Reset Error', err)
        setOverlayContent(
            Lang.query('ejs.settings.factoryReset.title'),
            Lang.query('ejs.settings.factoryReset.failed', { error: err.message }),
            Lang.queryJS('settings.msftLogin.okButton')
        )
        setOverlayHandler(() => {
            toggleOverlay(false)
        })
    }
}

// Prepare the settings UI on startup.
//prepareSettings(true)

// FIX: Ensure accounts are populated if settings.js loads after uibinder's init
if (document.readyState === 'interactive' || document.readyState === 'complete') {
    if (typeof prepareAccountsTab === 'function') {
        prepareAccountsTab()
    }
}
