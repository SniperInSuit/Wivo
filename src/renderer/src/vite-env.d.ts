/// <reference types="vite/client" />

// Compile-time constant injected by electron.vite.config.ts (`renderer.define`)
// from package.json. Declared here rather than in a root-level d.ts because
// tsconfig.web.json only includes src/renderer/src/**/*.
declare const __APP_VERSION__: string
