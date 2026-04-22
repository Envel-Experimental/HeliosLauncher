const { ServerBoundPacket, ClientBoundPacket, ProtocolUtils } = require('../../../../../../../app/assets/js/core/mojang/Protocol')

describe('Protocol Utils', () => {
    
    describe('ServerBoundPacket', () => {
        it('should build a simple packet', () => {
            const packet = ServerBoundPacket.build()
            packet.writeBytes(0x01, 0x02)
            const buf = packet.toBuffer()
            // Length (VarInt 2) + Data (01 02)
            expect(buf).toEqual(Buffer.from([0x02, 0x01, 0x02]))
        })

        it('should write VarInt correctly', () => {
            const packet = ServerBoundPacket.build()
            packet.writeVarInt(128)
            const buf = packet.toBuffer()
            // Length (VarInt 2) + 128 (VarInt 80 01)
            expect(buf).toEqual(Buffer.from([0x02, 0x80, 0x01]))
        })

        it('should write String correctly', () => {
            const packet = ServerBoundPacket.build()
            packet.writeString('abc')
            const buf = packet.toBuffer()
            // Length (VarInt 4) + StringLength (VarInt 3) + Data (61 62 63)
            expect(buf).toEqual(Buffer.from([0x04, 0x03, 0x61, 0x62, 0x63]))
        })

        it('should write UnsignedShort correctly', () => {
            const packet = ServerBoundPacket.build()
            packet.writeUnsignedShort(255)
            const buf = packet.toBuffer()
            // Length (VarInt 2) + Data (00 FF)
            expect(buf).toEqual(Buffer.from([0x02, 0x00, 0xFF]))
        })
    })

    describe('ClientBoundPacket', () => {
        it('should read bytes correctly', () => {
            const packet = new ClientBoundPacket(Buffer.from([0x01, 0x02, 0x03]))
            expect(packet.readByte()).toBe(0x01)
            expect(packet.readBytes(2)).toEqual([0x02, 0x03])
        })

        it('should append buffer', () => {
            const packet = new ClientBoundPacket(Buffer.from([0x01]))
            packet.append(Buffer.from([0x02]))
            expect(packet.readBytes(2)).toEqual([0x01, 0x02])
        })

        it('should read VarInt correctly', () => {
            const packet = new ClientBoundPacket(Buffer.from([0x80, 0x01]))
            expect(packet.readVarInt()).toBe(128)
        })

        it('should throw if VarInt is too big', () => {
            const packet = new ClientBoundPacket(Buffer.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80]))
            expect(() => packet.readVarInt()).toThrow('VarInt is too big')
        })

        it('should read String correctly', () => {
            const packet = new ClientBoundPacket(Buffer.from([0x03, 0x61, 0x62, 0x63]))
            expect(packet.readString()).toBe('abc')
        })
    })

    describe('ProtocolUtils', () => {
        it('should calculate VarInt size correctly', () => {
            expect(ProtocolUtils.getVarIntSize(0)).toBe(1)
            expect(ProtocolUtils.getVarIntSize(127)).toBe(1)
            expect(ProtocolUtils.getVarIntSize(128)).toBe(2)
            expect(ProtocolUtils.getVarIntSize(255)).toBe(2)
        })
    })
})
