const fs = require('fs')
const path = require('path')
const toml = require('smol-toml')
const { deepMerge } = require('./util')


let lang

exports.loadLanguage = function (id) {
    let langPath
    try {
        console.log('[LangLoader] Trace 1: id=', id)
        const isRenderer = (process.type === 'renderer' || typeof window !== 'undefined')
        
        if (isRenderer) {
            const base = window.HeliosAPI?.app?.getAppPath() || window.HeliosAPI?.system?.cwd() || ''
            langPath = path.join(base, 'app', 'assets', 'lang', `${id}.toml`)
        } else {
            const { app } = require('electron')
            langPath = path.join(app.getAppPath(), 'app', 'assets', 'lang', `${id}.toml`)
        }
        console.log('[LangLoader] Trace 2: langPath=', langPath)

        if (typeof fs.existsSync === 'function' && !fs.existsSync(langPath)) {
            console.warn(`[LangLoader] Language file does not exist: ${langPath}`)
            return
        }

        console.log('[LangLoader] Trace 3: Reading file...')
        let fileContent = fs.readFileSync(langPath, 'utf-8')
        if (!fileContent) {
            console.warn(`[LangLoader] Language file is empty or missing: ${langPath}`)
            return
        }

        // Strip BOM
        if (typeof fileContent === 'string') {
            fileContent = fileContent.replace(/^\uFEFF/, '')
        }
        console.log('[LangLoader] Trace 4: Content length=', fileContent?.length)

        console.log('[LangLoader] Trace 5: Parsing TOML...')
        const parsed = toml.parse(fileContent)
        console.log('[LangLoader] Trace 6: Parsed keys=', parsed ? Object.keys(parsed).length : 'null')
        
        lang = deepMerge(parsed || {}, lang || {})
        console.log('[LangLoader] Trace 7: Merge complete')
    } catch (err) {
        console.error(`[LangLoader] Failed to load language file ${id}:`, err)
        console.error(err.stack || 'No stack trace available')
    }
}

exports.query = function (id, placeHolders) {
    let query = id.split('.')
    let res = lang
    for (let q of query) {
        if (res && typeof res === 'object') {
            res = res[q]
        } else {
            res = undefined
            break
        }
    }
    let text = res === lang ? '' : res
    if (placeHolders) {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, value)
        })
    }
    return text
}

exports.queryJS = function (id, placeHolders) {
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function (id, placeHolders) {
    return exports.query(`ejs.${id}`, placeHolders)
}

exports.setupLanguage = function () {
    // Load Language Files
    exports.loadLanguage('en_US')
    // Uncomment this when translations are ready
    //exports.loadLanguage('xx_XX')

    // Load Custom Language File for Launcher Customizer
    exports.loadLanguage('_custom')
}
