/**
 * Path Polyfill for the Renderer process.
 * Basic implementation of Node.js 'path' module features.
 */

function normalize(path) {
    if (!path) return '.'
    const isAbsolute = path.startsWith('/') || /^[a-zA-Z]:/.test(path)
    const trailingSlash = path.endsWith('/')
    
    let parts = path.split(/[/\\]+/).filter(p => p.length > 0)
    let newParts = []
    
    for (let p of parts) {
        if (p === '.') continue
        if (p === '..') {
            if (newParts.length > 0 && newParts[newParts.length - 1] !== '..') {
                newParts.pop()
            } else if (!isAbsolute) {
                newParts.push('..')
            }
        } else {
            newParts.push(p)
        }
    }
    
    let res = newParts.join('/')
    if (isAbsolute && !res.startsWith('/') && !/^[a-zA-Z]:/.test(res)) {
        res = '/' + res
    }
    if (trailingSlash && !res.endsWith('/')) {
        res += '/'
    }
    return res || '.'
}

const path = {
    join: (...args) => {
        return normalize(args.filter(a => typeof a === 'string').join('/'))
    },
    dirname: (p) => {
        const parts = normalize(p).split('/')
        if (parts.length <= 1) return p.startsWith('/') ? '/' : '.'
        return parts.slice(0, -1).join('/')
    },
    basename: (p, ext) => {
        let base = normalize(p).split('/').pop()
        if (ext && base.endsWith(ext)) {
            base = base.slice(0, -ext.length)
        }
        return base
    },
    extname: (p) => {
        const base = normalize(p).split('/').pop()
        const idx = base.lastIndexOf('.')
        return idx < 0 ? '' : base.slice(idx)
    },
    resolve: (...args) => {
        // Simple resolve: join with CWD if not absolute
        const res = normalize(args.join('/'))
        return res
    },
    normalize: (p) => normalize(p),
    relative: (from, to) => {
        const fromParts = normalize(from).split('/').filter(p => p.length > 0)
        const toParts = normalize(to).split('/').filter(p => p.length > 0)
        
        let i = 0
        while (i < fromParts.length && i < toParts.length && fromParts[i].toLowerCase() === toParts[i].toLowerCase()) {
            i++
        }
        
        const up = fromParts.slice(i).map(() => '..')
        const down = toParts.slice(i)
        
        return up.concat(down).join('/') || '.'
    },
    sep: '/',
    delimiter: ';'
}

module.exports = path
