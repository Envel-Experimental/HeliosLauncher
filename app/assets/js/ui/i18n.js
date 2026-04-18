import Lang from '@core/langloader'

export function applyTranslations() {
    console.log('[i18n] Applying translations...');
    // Basic elements
    const elements = document.querySelectorAll('[data-lang]')
    console.log(`[i18n] Found ${elements.length} elements with [data-lang]`);
    elements.forEach(el => {
        const key = el.getAttribute('data-lang')
        if (key) {
            let translated = Lang.queryJS(key)
            
            if (typeof translated !== 'string' || translated === '') {
                translated = Lang.query('ejs.' + key)
            }

            if (typeof translated === 'string' && translated !== '') {
                if (typeof translated === 'string') {
                    let appName = Lang.queryJS('app.title')
                    if (typeof appName !== 'string') {
                        appName = Lang.query('ejs.app.title')
                    }
                    if (typeof appName !== 'string') {
                        appName = 'Helios'
                    }
                    translated = translated.replace(/{appName}/g, appName)
                    
                    // Handle pathSuffix for Java path
                    if (translated.includes('{pathSuffix}')) {
                        const isWin = process.platform === 'win32'
                        const suffix = isWin ? 'bin\\javaw.exe' : 'bin/java'
                        translated = translated.replace(/{pathSuffix}/g, suffix)
                    }
                    
                    // Handle major for Java version
                    if (translated.includes('{major}')) {
                        translated = translated.replace(/{major}/g, '8') // Default fallback
                    }
                }
                el.innerHTML = translated
            } else {
                console.warn(`[i18n] Translation NOT FOUND for key: ${key}`);
            }
        }
    })

    // Attributes
    const attrsToCheck = ['placeholder', 'title', 'value', 'dialogTitle', 'href']
    attrsToCheck.forEach(attr => {
        const attrElements = document.querySelectorAll(`[data-lang-${attr}]`)
        attrElements.forEach(el => {
            const key = el.getAttribute(`data-lang-${attr}`)
            if (key) {
                let translated = Lang.queryJS(key)
                if (typeof translated !== 'string' || translated === '') {
                    translated = Lang.query('ejs.' + key)
                }

                if (typeof translated === 'string' && translated !== '') {
                    el.setAttribute(attr, translated)
                    if (attr === 'value' && el.tagName === 'INPUT') {
                        el.value = translated
                    }
                }
            }
        })
    })
    console.log('[i18n] Translations applied.');
}
