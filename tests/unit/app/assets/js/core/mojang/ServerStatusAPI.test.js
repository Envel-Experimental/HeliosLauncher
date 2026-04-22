const { connect } = require('net');

// Mock DNS
const mockResolveSrv = jest.fn();
jest.mock('dns/promises', () => ({
    resolveSrv: mockResolveSrv,
}));

// Mock net.connect
const mockSocket = {
    write: jest.fn(),
    setTimeout: jest.fn(),
    destroy: jest.fn(),
    end: jest.fn(),
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
};
const mockConnect = jest.fn().mockReturnValue(mockSocket);
jest.mock('net', () => ({
    connect: mockConnect,
}));

// Mock Logger
jest.mock('../../../../../../../app/assets/js/core/util/LoggerUtil', () => ({
    LoggerUtil: {
        getLogger: () => ({
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        }),
    },
}));

// Mock Protocol
jest.mock('../../../../../../../app/assets/js/core/mojang/Protocol', () => {
    const mockBuild = {
        writeVarInt: jest.fn().mockReturnThis(),
        writeString: jest.fn().mockReturnThis(),
        writeUnsignedShort: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockReturnValue(Buffer.from([0x01])),
    };
    return {
        ServerBoundPacket: {
            build: jest.fn().mockReturnValue(mockBuild),
        },
        ClientBoundPacket: jest.fn().mockImplementation((data) => ({
            readVarInt: jest.fn()
                .mockReturnValueOnce(data.length - 1) // First call: Packet Length
                .mockReturnValueOnce(0x00),           // Second call: Packet Type
            readString: jest.fn().mockReturnValue(JSON.stringify({ 
                description: 'A Minecraft Server', 
                version: { name: '1.19' } 
            })),
            append: jest.fn(),
        })),
        ProtocolUtils: {
            getVarIntSize: jest.fn().mockReturnValue(1),
        }
    };
});

const { getServerStatus } = require('../../../../../../../app/assets/js/core/mojang/ServerStatusAPI');

describe('ServerStatusAPI', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.type;
    });

    it('should resolve status via SRV record', async () => {
        mockResolveSrv.mockResolvedValue([{ name: 'mc.example.com', port: 25565 }]);
        
        const statusPromise = getServerStatus(758, 'example.com');
        
        // Wait for async checkSrv to finish
        await new Promise(resolve => setImmediate(resolve));

        // Trigger connect callback
        expect(mockConnect).toHaveBeenCalled();
        const connectCallback = mockConnect.mock.calls[0][2];
        connectCallback();

        // Trigger 'once' data event
        const dataHandler = mockSocket.once.mock.calls.find(c => c[0] === 'data')[1];
        dataHandler(Buffer.from([0x05, 0x00, 0x01, 0x02, 0x03])); // Mocked packet data

        const result = await statusPromise;
        expect(result.description.text).toBe('A Minecraft Server');
    });

    it('should handle timeout', async () => {
        mockResolveSrv.mockResolvedValue([]);
        
        const statusPromise = getServerStatus(758, 'example.com');
        
        // Wait for async checkSrv to finish
        await new Promise(resolve => setImmediate(resolve));

        // Trigger timeout callback
        const timeoutHandler = mockSocket.setTimeout.mock.calls[0][1];
        timeoutHandler();

        await expect(statusPromise).rejects.toThrow('Server Status Socket timed out');
    });
});
