const fs = require('fs');
const path = require('path');
const coreDir = path.resolve('app/');

function walk(dir) {
    let results = [];
    let list = fs.readdirSync(dir);
    list.forEach(function(file) {
        file = path.join(dir, file);
        let stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else if (file.endsWith('.js')) {
            results.push(file);
        }
    });
    return results;
}

const files = walk(coreDir);
files.push(path.resolve('index.js'))
files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let original = content;
    
    // Replace require('@common/...')
    content = content.replace(/require\(['"]@common\/([^'"]+)['"]\)/g, (match, p1) => {
        let relative = path.relative(path.dirname(file), path.resolve('app/assets/js/core/common'));
        let replacement = relative + '/' + p1;
        replacement = replacement.replace(/\\/g, '/');
        if (!replacement.startsWith('.')) replacement = './' + replacement;
        return `require('${replacement}')`;
    });

    // Replace require('@network/...')
    content = content.replace(/require\(['"]@network\/([^'"]+)['"]\)/g, (match, p1) => {
        let relative = path.relative(path.dirname(file), path.resolve('network'));
        let replacement = relative + '/' + p1;
        replacement = replacement.replace(/\\/g, '/');
        if (!replacement.startsWith('.')) replacement = './' + replacement;
        return `require('${replacement}')`;
    });
    
    if (content !== original) {
        fs.writeFileSync(file, content);
        console.log('Fixed', file);
    }
});
