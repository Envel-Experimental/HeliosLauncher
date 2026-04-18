const engine = require('../network/P2PEngine')
console.log('Engine loaded:', !!engine)
if (engine) {
    console.log('Engine start type:', typeof engine.start)
}
