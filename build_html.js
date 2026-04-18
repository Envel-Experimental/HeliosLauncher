const fs = require('fs')
const path = require('path')

const appDir = path.join(__dirname, 'app')

function processTemplate(filename) {
    let content = fs.readFileSync(path.join(appDir, filename), 'utf8')

    // 1. Resolve includes
    content = content.replace(/<%- include\('([^']+)'\) %>/g, (match, p1) => {
        return processTemplate(p1 + '.ejs')
    })

    return content
}

let finalHtml = processTemplate('app.ejs')

// 2. Replace lang tags with data-lang attributes
// Regex for <%- lang('some.key') %>
finalHtml = finalHtml.replace(/<%- lang\('([^']+)'\) %>/g, '<span data-lang="$1"></span>')
finalHtml = finalHtml.replace(/<%= lang\('([^']+)'\) %>/g, '<span data-lang="$1"></span>')

// 3. For attributes like placeholder="<%- lang('key') %>"
// Let's find any data-lang injected into attributes and move them to data-lang-[attr]
// Using a slightly more complex regex for basic cases like placeholder, title, value
const attrsToCheck = ['placeholder', 'title', 'value', 'dialogTitle']
for (let attr of attrsToCheck) {
    const attrRegex = new RegExp(`${attr}="<span data-lang="([^"]+)"><\\/span>"`, 'g')
    finalHtml = finalHtml.replace(attrRegex, `data-lang-${attr}="$1" ${attr}=""`)
}

// 4. Clean up other specific EJS values
finalHtml = finalHtml.replace(/<%=bkid%>/g, '') // Background ID handled dynamically
finalHtml = finalHtml.replace(/<%= bundlePath %>/g, 'dist/renderer.bundle.js')

fs.writeFileSync(path.join(appDir, 'index.html'), finalHtml)
console.log('Compiled app.ejs to index.html successfully!')
