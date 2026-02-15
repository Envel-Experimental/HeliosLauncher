const fs = require('fs')
const path = require('path')
const toml = require('smol-toml')
const { defu } = require('defu')

let lang

exports.loadLanguage = function (id) {
    const fileContent = fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`), 'utf-8')
    // Load and merge strings

    lang = defu(toml.parse(fileContent) || {}, lang || {})
}

exports.query = function (id, placeHolders) {
    let query = id.split('.')
    let res = lang
    for (let q of query) {
        res = res[q]
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