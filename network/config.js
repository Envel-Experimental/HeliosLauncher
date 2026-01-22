module.exports = {
    // Sovereign Infrastructure Config

    // Array of host:port strings for private RF-based VPS fleet
    BOOTSTRAP_NODES: [
        { host: '195.201.148.171', port: 49737, publicKey: '535c2283731986026127f7a9f220e2606779fbaf99bc2ceb869bcdc1b00245e8' },
        { host: '89.23.113.35', port: 49737, publicKey: 'd29747a47fd8a67bcebdd2b0c6668700f41eb4ff809676346551e17512642439' }
    ],



    // Discovery settings
    DISCOVERY: {
        MDNS: true,      // Crucial for zero-latency LAN P2P
        DHT: true,       // Enable Distributed Hash Table
        PUBLIC_DHT: true // Attempt to use public DHT if private fails
    },

    // P2P Protocol Constants
    PROTOCOL: {
        VERSION: 1,
        TIMEOUT: 5000,   // 5s timeout for requests
        MAX_RETRIES: 3
    }
}
