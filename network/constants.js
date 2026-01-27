module.exports = {
    MSG_REQUEST: 0,                   // Client requests a file from seeder
    MSG_DATA: 1,                      // Seeder sends a data chunk to client
    MSG_ERROR: 2,                     // Error occurs during transfer (Busy, Not Found, etc)
    MSG_END: 3,                       // Transfer completed successfully
    MSG_HELLO: 4,                     // Initial handshake message
    MSG_PING: 5,                      // Keep-alive heartbeat
    MSG_PONG: 6,                      // Heartbeat response
    MSG_BATCH_REQUEST: 7,             // Request for multiple hashes at once

    SWARM_TOPIC_SEED: 'zombie-launcher-assets-v2', // Seed string used to generate DHT topic hash

    MAX_CONCURRENT_UPLOADS: 20,       // Max simultaneous outgoing transfers (slots)
    BATCH_SIZE_LIMIT: 50,             // Max files in a single batch request

    // Fair Usage (Soft Ban) Constants
    MAX_CREDITS_PER_IP: 5000,         // Token bucket size: Max 5GB burst (Units: MB)
    CREDIT_REGEN_RATE: 2.0,           // Regeneration speed: 2MB per second recovery (~120MB/min)
    COST_PER_MB: 1.0,                 // Spending rate: 1MB of transfer costs 1 Credit
    MIN_CREDITS_TO_START: 100,        // Minimum 100MB buffer required to allow a new upload

    // Dynamic Concurrency (Client-side) Constants
    MIN_PARALLEL_DOWNLOADS: 10,       // Never drop below 10 parallel P2P requests
    MAX_PARALLEL_DOWNLOADS: 150,      // Never exceed 150 parallel P2P requests across all peers
    PEER_CONCURRENCY_FACTOR: 8        // Multiply peer count by 8 to determine parallel slots
}
