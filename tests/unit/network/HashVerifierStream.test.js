'use strict'

const crypto = require('crypto')
const { PassThrough } = require('stream')

/**
 * Wraps a stream in a Promise that resolves when the stream ends (all data
 * collected) and rejects on the first error event.
 */
function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = []
        stream.on('data', c => chunks.push(c))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
        stream.on('close', () => {
            // In case 'end' is never emitted after an error
        })
    })
}

/**
 * Writes chunks to a HashVerifierStream and awaits completion.
 * Returns the concatenated output buffer.
 * Rejects with the 'error' event payload.
 */
function pushAndFlush(stream, ...chunks) {
    const p = streamToBuffer(stream)
    for (const c of chunks) stream.write(Buffer.from(c))
    stream.end()
    return p
}

describe('HashVerifierStream', () => {
    let HashVerifierStream

    beforeEach(() => {
        jest.resetModules()
        HashVerifierStream = require('../../../network/HashVerifierStream')
    })

    // ─── Correct verification ─────────────────────────────────────────────────

    it('passes data through and resolves when hash matches (sha1)', async () => {
        const data = 'hello p2p world'
        const hash = crypto.createHash('sha1').update(data).digest('hex')

        const stream = new HashVerifierStream('sha1', hash)
        const out = await pushAndFlush(stream, data)
        expect(out.toString()).toBe(data)
    })

    it('passes data through and resolves when hash matches (sha256)', async () => {
        const data = 'sha256 test data'
        const hash = crypto.createHash('sha256').update(data).digest('hex')

        const stream = new HashVerifierStream('sha256', hash)
        const out = await pushAndFlush(stream, data)
        expect(out.toString()).toBe(data)
    })

    it('works with SHA-256 alias (hyphen normalisation)', async () => {
        const data = 'normalise this'
        const hash = crypto.createHash('sha256').update(data).digest('hex')

        const stream = new HashVerifierStream('SHA-256', hash)
        await expect(pushAndFlush(stream, data)).resolves.not.toThrow()
    })

    // ─── Hash mismatch ────────────────────────────────────────────────────────

    it('emits HASH_MISMATCH error when content is corrupted', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const correctHash = crypto.createHash('sha1').update('original content').digest('hex')
        const stream = new HashVerifierStream('sha1', correctHash)

        await expect(pushAndFlush(stream, 'corrupted content!')).rejects.toMatchObject({
            code: 'HASH_MISMATCH',
            expected: correctHash
        })
    })

    it('error carries .expected and .actual fields', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const hash = 'a'.repeat(40) // fake sha1
        const stream = new HashVerifierStream('sha1', hash)

        const err = await pushAndFlush(stream, 'anything').catch(e => e)
        expect(err.code).toBe('HASH_MISMATCH')
        expect(err.expected).toBeDefined()
        expect(err.actual).toBeDefined()
        expect(err.expected).not.toBe(err.actual)
    })

    // ─── Multi-chunk correctness ───────────────────────────────────────────────

    it('accumulates hash across multiple chunks correctly', async () => {
        const parts = ['chunk1', 'chunk2', 'chunk3']
        const combined = parts.join('')
        const hash = crypto.createHash('sha1').update(combined).digest('hex')

        const stream = new HashVerifierStream('sha1', hash)
        const p = streamToBuffer(stream)
        for (const part of parts) stream.write(Buffer.from(part))
        stream.end()

        const out = await p
        expect(out.toString()).toBe(combined)
    })

    // ─── Invalid algorithm ────────────────────────────────────────────────────

    it('emits error on invalid algorithm in _flush', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const stream = new HashVerifierStream('not-a-real-algo', 'abc')

        const err = await pushAndFlush(stream, 'data').catch(e => e)
        expect(err.message).toMatch(/Invalid algorithm/)
    })

    // ─── setImmediate: event loop is not blocked in _flush ────────────────────

    it('_flush defers via setImmediate — error is NOT emitted synchronously from end()', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {})
        const hash = 'z'.repeat(40) // intentionally wrong
        const stream = new HashVerifierStream('sha1', hash)
        stream.on('data', () => {})

        let errorEmitted = false
        stream.on('error', () => { errorEmitted = true })

        stream.write(Buffer.from('test'))
        stream.end() // triggers _flush

        // Synchronously after end(), the error must NOT have fired yet
        // (it should be deferred to next event loop tick via setImmediate)
        expect(errorEmitted).toBe(false)

        // Now allow the event loop to process the setImmediate callback
        await new Promise(resolve => setImmediate(resolve))
        await new Promise(resolve => setImmediate(resolve))

        // After yielding, the error should have been emitted
        expect(errorEmitted).toBe(true)
    })

    // ─── Piping ───────────────────────────────────────────────────────────────

    it('can be piped from a PassThrough source', async () => {
        const data = 'piped data'
        const hash = crypto.createHash('sha1').update(data).digest('hex')

        const source = new PassThrough()
        const verifier = new HashVerifierStream('sha1', hash)
        const p = streamToBuffer(verifier)

        source.pipe(verifier)
        source.write(Buffer.from(data))
        source.end()

        const out = await p
        expect(out.toString()).toBe(data)
    })
})
