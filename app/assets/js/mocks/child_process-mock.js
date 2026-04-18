const events = require('./events')

class ChildProcess extends events.EventEmitter {
    constructor() {
        super()
        this.stdin = new events.EventEmitter()
        this.stdout = new events.EventEmitter()
        this.stderr = new events.EventEmitter()
        this.pid = 1234
    }
    kill() { return true }
    send() { return true }
}

module.exports = {
    spawn: () => new ChildProcess(),
    exec: (cmd, cb) => {
        if (cb) cb(null, '', '')
        return new ChildProcess()
    },
    execFile: (file, args, cb) => {
        if (cb) cb(null, '', '')
        return new ChildProcess()
    },
    fork: () => new ChildProcess(),
    execSync: () => Buffer.alloc(0),
    spawnSync: () => ({ status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) })
}
