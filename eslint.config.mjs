import js from "@eslint/js";
import globals from "globals";

export default [
    js.configs.recommended,
    {
        ignores: ["node_modules/", "app/dist/", "coverage/", "app/assets/js/libs/"],
    },
    {
        // Core Logic and Main Process Files
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                ...globals.node,
                ...globals.browser,
                // App Specific Renderer Globals (Electron / Helios)
                HeliosAPI: "readonly",
                ipcRenderer: "readonly",
                appVersion: "readonly",
                shell: "readonly",
                currentWindow: "readonly",
                // UI View / Controller Globals (Commonly injected or attached to window)
                toggleOverlay: "readonly",
                setOverlayContent: "readonly",
                setOverlayHandler: "readonly",
                setMiddleButtonHandler: "readonly",
                setDismissHandler: "readonly",
                switchView: "readonly",
                getCurrentView: "readonly",
                VIEWS: "readonly",
                Lang: "readonly",
                ConfigManager: "readonly",
                DistroAPI: "readonly",
                Type: "readonly",
                isOverlayVisible: "readonly",
                toggleServerSelection: "readonly",
                fadeOut: "readonly",
                fadeIn: "readonly",
                safeSetOnClick: "readonly",
                loginCancelEnabled: "readonly",
                Analytics: "readonly",
                AuthManager: "readonly",
                // Testing Globals
                jest: "readonly",
                describe: "readonly",
                test: "readonly",
                it: "readonly",
                expect: "readonly",
                beforeEach: "readonly",
                afterEach: "readonly",
                beforeAll: "readonly",
                afterAll: "readonly",
                page: "readonly",
                browser: "readonly",
                context: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "off", 
            "no-undef": "error",
            "no-empty": "warn",
            "no-constant-condition": "warn",
            "no-useless-escape": "off",
            "no-async-promise-executor": "warn",
            "no-useless-catch": "off",
            "no-useless-assignment": "off",
            "no-control-regex": "off",
            "no-redeclare": "warn",
            "preserve-caught-error": "off" // New in ESLint 10, disabling to avoid large refactoring
        }
    },
    {
        // UI Files - Special handling for legacy global-heavy scripts
        files: ["app/assets/js/ui/**/*.js"],
        rules: {
            "no-undef": "off" 
        }
  }
];
