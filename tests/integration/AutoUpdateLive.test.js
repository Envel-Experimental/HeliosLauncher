const https = require('https')

async function getRealReleases() {
    const res = await fetch('https://api.github.com/repos/Envel-Experimental/Flauncher/releases?per_page=100', {
        headers: { 'User-Agent': 'Flauncher-Integration-Test' }
    });
    if (!res.ok) throw new Error(`GitHub Error: ${res.status}`);
    return res.json();
}

describe('AutoUpdate REAL-WORLD Audit', () => {

    it('should report the ACTUAL state of GitHub releases', async () => {
        const releases = await getRealReleases()

        console.log('\n==================================================')
        console.log('       LIVE GITHUB RELEASE AUDIT (NON-FAKE)       ')
        console.log('==================================================')

        const latestStable = releases.find(r => !r.prerelease && !r.draft)
        const latestFloating = releases.find(r =>
            r.prerelease &&
            !r.draft &&
            (r.name || '').toUpperCase().includes('STABLE')
        )

        console.log('STABLE CHANNEL:')
        if (latestStable) {
            console.log(`  Version: ${latestStable.tag_name}`)
            console.log(`  Commit/Branch: ${latestStable.target_commitish}`)
            console.log(`  Release ID: ${latestStable.id}`)
            console.log(`  Status: READY TO SERVE`)
        } else {
            console.log(`  Status: NO STABLE RELEASES FOUND (Users will stay on current version)`)
        }

        console.log('\nFLOATING CHANNEL:')
        if (latestFloating) {
            console.log(`  Version: ${latestFloating.tag_name}`)
            console.log(`  Commit/Branch: ${latestFloating.target_commitish}`)
            console.log(`  Title: ${latestFloating.name}`)
            console.log(`  Status: READY TO SERVE (STABLE keyword matched)`)
        } else {
            const lastAny = releases.find(r => r.prerelease)
            console.log(`  Status: NO VALID FLOATING RELEASES FOUND`)
            if (lastAny) {
                console.log(`  Note: Found ${lastAny.tag_name} but it lacks STABLE tag.`)
            }
        }
        console.log('==================================================\n')

        expect(Array.isArray(releases)).toBe(true)
    }, 60000)
})
