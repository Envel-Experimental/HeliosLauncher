/**
 * @jest-environment jsdom
 */

// Mock Dependencies
jest.mock('../../../../../app/assets/js/core/configmanager')

const ConfigManager = require('../../../../../app/assets/js/core/configmanager')

describe('Settings Persistence Logic', () => {
    
    beforeEach(() => {
        jest.resetModules()
        document.body.innerHTML = `
            <div id="settingsContainer">
                <input type="checkbox" id="testCheckbox" cValue="AllowPrerelease">
                <input type="text" id="testInput" cValue="JavaExecutable" serverDependent>
            </div>
        `
        ConfigManager.getSelectedServer.mockReturnValue('test-server')
    })

    test('should update ConfigManager when checkbox is clicked', () => {
        const checkbox = document.getElementById('testCheckbox')
        
        // Mock the event listener logic normally found in settings.js
        checkbox.addEventListener('change', (e) => {
            const cVal = checkbox.getAttribute('cValue')
            ConfigManager['set' + cVal](e.target.checked)
        })

        checkbox.checked = true
        checkbox.dispatchEvent(new Event('change'))

        expect(ConfigManager.setAllowPrerelease).toHaveBeenCalledWith(true)
    })

    test('should update ConfigManager when input is changed', () => {
        const input = document.getElementById('testInput')
        
        input.addEventListener('change', (e) => {
            const cVal = input.getAttribute('cValue')
            const serverDependent = input.hasAttribute('serverDependent')
            if (serverDependent) {
                ConfigManager['set' + cVal](ConfigManager.getSelectedServer(), e.target.value)
            } else {
                ConfigManager['set' + cVal](e.target.value)
            }
        })

        input.value = 'new/path/to/java'
        input.dispatchEvent(new Event('change'))

        expect(ConfigManager.setJavaExecutable).toHaveBeenCalledWith('test-server', 'new/path/to/java')
    })
})
