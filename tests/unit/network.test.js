const NodeAdapter = require('../../network/NodeAdapter')
const HashVerifierStream = require('../../network/HashVerifierStream')
const crypto = require('crypto')
const { Readable } = require('stream')

describe('Network Layer', () => {

    test('NodeAdapter detects profile', () => {
        const profile = NodeAdapter.getProfile()
        expect(profile).toBeDefined()
        expect(profile.name).toMatch(/LOW|MID|HIGH/)
        expect(profile.maxPeers).toBeGreaterThan(0)
    })

    test('HashVerifierStream verifies correct hash', (done) => {
        const data = 'hello world'
        const hash = crypto.createHash('sha1').update(data).digest('hex')

        const stream = new HashVerifierStream('sha1', hash)
        const input = Readable.from([data])

        input.pipe(stream)

        stream.on('data', () => {})
        stream.on('end', () => {
            done()
        })
        stream.on('error', (err) => {
            done(err)
        })
    })

    test('HashVerifierStream detects mismatch', (done) => {
        const data = 'hello world'
        const hash = '0000000000000000000000000000000000000000' // Wrong hash

        const stream = new HashVerifierStream('sha1', hash)
        const input = Readable.from([data])

        input.pipe(stream)

        stream.on('data', () => {})
        stream.on('end', () => {
            done(new Error('Should have failed'))
        })
        stream.on('error', (err) => {
            expect(err.code).toBe('HASH_MISMATCH')
            done()
        })
    })

})
