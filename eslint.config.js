import js from "@eslint/js";

export default [
    js.configs.recommended,
    {
        ignores: ["node_modules/", "app/dist/", "coverage/"],
    },
    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: "module",
            globals: {
                // Node
                __dirname: "readonly",
                process: "readonly",
                require: "readonly",
                module: "readonly",
                exports: "readonly",
                console: "readonly",
                Buffer: "readonly",
                // Browser/Electron Renderer
                window: "readonly",
                document: "readonly",
                setTimeout: "readonly",
                setInterval: "readonly",
                clearTimeout: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                // App globals
                HeliosAPI: "readonly",
                ipcRenderer: "readonly",
                appVersion: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error",
            "no-empty": "warn"
        }
    }
];
