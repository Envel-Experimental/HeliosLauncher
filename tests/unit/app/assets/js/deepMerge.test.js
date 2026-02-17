const { deepMerge } = require('../../../../../app/assets/js/util')

describe('deepMerge', () => {
    it('should return the object if defaults is missing', () => {
        const obj = { a: 1 }
        expect(deepMerge(obj, null)).toBe(obj)
        expect(deepMerge(obj, undefined)).toBe(obj)
    })

    it('should return defaults if object is missing', () => {
        const defaults = { a: 1 }
        expect(deepMerge(null, defaults)).toBe(defaults)
        expect(deepMerge(undefined, defaults)).toBe(defaults)
    })

    it('should return object if strict types mismatch or arrays provided', () => {
        const obj = { a: 1 }
        const arr = [1, 2]
        expect(deepMerge(obj, arr)).toBe(obj)
        expect(deepMerge(arr, obj)).toBe(arr)
        expect(deepMerge(1, obj)).toBe(1)
    })

    it('should merge simple objects', () => {
        const obj = { a: 1 }
        const defaults = { b: 2 }
        const result = deepMerge(obj, defaults)
        expect(result).toEqual({ a: 1, b: 2 })
    })

    it('should override defaults with object values', () => {
        const obj = { a: 1 }
        const defaults = { a: 2 }
        const result = deepMerge(obj, defaults)
        expect(result).toEqual({ a: 1 })
    })

    it('should recursively merge objects', () => {
        const obj = { a: { x: 1 } }
        const defaults = { a: { y: 2 }, b: 3 }
        const result = deepMerge(obj, defaults)
        expect(result).toEqual({ a: { x: 1, y: 2 }, b: 3 })
    })

    it('should handle undefined values in obj', () => {
        const obj = { a: undefined }
        const defaults = { a: 1 }
        const result = deepMerge(obj, defaults)
        expect(result).toEqual({ a: 1 })
    })

    it('should not merge null values as objects', () => {
        const obj = { a: null }
        const defaults = { a: { x: 1 } }
        const result = deepMerge(obj, defaults)
        expect(result).toEqual({ a: null })
    })
})
