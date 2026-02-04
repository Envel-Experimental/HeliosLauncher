const P2PEngine = require('./network/P2PEngine');
const ResourceMonitor = require('./network/ResourceMonitor');
const constants = require('./network/constants');

console.log(`[Test] Constants: MIN=${constants.MIN_PARALLEL_DOWNLOADS}, MAX=${constants.MAX_PARALLEL_DOWNLOADS}`);

// Mock ResourceMonitor.getCPUUsage
const originalGetCPU = ResourceMonitor.getCPUUsage;
let mockCpu = 0;
ResourceMonitor.getCPUUsage = () => mockCpu;

// Mock Peers
P2PEngine.peers = new Array(10).fill({}); // 10 peers should allow up to 80 threads normally (capped at 32)
console.log(`[Test] Simulating ${P2PEngine.peers.length} peers.`);

function check(cpu, expectedMax) {
    mockCpu = cpu;
    const concurrency = P2PEngine.getOptimalConcurrency(32);
    const status = concurrency <= expectedMax ? 'PASS' : 'FAIL';
    console.log(`CPU: ${cpu}%, Expected Max: ${expectedMax}, Got: ${concurrency} -> ${status}`);
}

console.log('--- Testing CPU Throttling ---');
check(10, 32); // Low CPU -> Max allowed (32)
check(40, 32); // Moderate CPU -> Max allowed (32)
check(60, 24); // >50% CPU -> Throttled to 24
check(80, 16); // >70% CPU -> Throttled to 16
check(95, 8);  // >90% CPU -> Throttled to 8 (Min)

// Test Networking Overload
console.log('--- Testing Network Overload ---');
mockCpu = 10; // Reset CPU
P2PEngine.peers = new Array(10).fill({});
const originalGetLoad = P2PEngine.getLoadStatus;
P2PEngine.getLoadStatus = () => 'overloaded';

const overloadedConcurrency = P2PEngine.getOptimalConcurrency(32);
console.log(`Status: Overloaded, Got: ${overloadedConcurrency} (Expected <= 12) -> ${overloadedConcurrency <= 12 ? 'PASS' : 'FAIL'}`);

console.log('--- Done ---');
process.exit(0);
