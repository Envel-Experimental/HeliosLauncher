const fs = require('fs')
const path = require('path')
const toml = require('smol-toml')
const { deepMerge } = require('./util')


let lang

exports.loadLanguage = function (id) {
    let langPath
    if (process.type === 'renderer') {
        const base = window.HeliosAPI?.app?.getAppPath() || window.HeliosAPI?.system?.cwd() || ''
        langPath = path.join(base, 'app', 'assets', 'lang', `${id}.toml`)
    } else {
        const { app } = require('electron')
        langPath = path.join(app.getAppPath(), 'app', 'assets', 'lang', `${id}.toml`)
    }
    const fileContent = fs.readFileSync(langPath, 'utf-8')
    if (!fileContent) {
        console.warn(`[LangLoader] Language file not found or empty: ${langPath}`)
        return
    }
    // Load and merge strings
    try {
        lang = deepMerge(toml.parse(fileContent) || {}, lang || {})
    } catch (e) {
        console.error(`[LangLoader] Failed to parse TOML at ${langPath}:`, e)
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
