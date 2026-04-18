// Run this in the DevTools Console to verify system info
(function() {
    try {
        const os = require('os');
        console.log('%c[System Verification]', 'color: #00ff00; font-weight: bold');
        console.log('Total Memory:', (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB');
        console.log('Free Memory:', (os.freemem() / (1024 * 1024 * 1024)).toFixed(2) + ' GB');
        console.log('Architecture:', os.arch());
        console.log('Platform:', os.platform());
        console.log('CPUs:', os.cpus());
        
        if (os.totalmem() === 1024 * 1024 * 1024) {
            console.warn('%c[WARNING] Launcher is still using fallback mock values (1GB RAM)!', 'color: #ff9900');
        } else {
            console.log('%c[SUCCESS] Real system data detected.', 'color: #00ff00');
        }
    } catch (e) {
        console.error('System verification failed:', e);
    }
})();
