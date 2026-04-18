describe('deepMerge', () => {
    let util

    beforeEach(() => {
        jest.resetModules()
        // Correct path: tests/unit/app/assets/js/deepMerge.test.js -> core/util
        util = require('../../../../../app/assets/js/core/util')
    })

    it('should return the object if defaults is missing', () => {
        const obj = { a: 1 }
        expect(util.deepMerge(obj, null)).toBe(obj)
        expect(util.deepMerge(obj, undefined)).toBe(obj)
    })

    it('should merge simple objects', () => {
        const obj = { a: 1 }
        const defaults = { b: 2 }
        const result = util.deepMerge(obj, defaults)
        expect(result).toEqual({ a: 1, b: 2 })
    })

    it('should override defaults with object values', () => {
        const obj = { a: 1 }
        const defaults = { a: 2 }
        const result = util.deepMerge(obj, defaults)
        expect(result).toEqual({ a: 1 })
    })

    it('should recursively merge objects', () => {
        const obj = { a: { b: 1 } }
        const defaults = { a: { c: 2 }, d: 3 }
        const result = util.deepMerge(obj, defaults)
        expect(result).toEqual({ a: { b: 1, c: 2 }, d: 3 })
    })
})
