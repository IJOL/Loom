/// <reference types="vite/client" />

// Injected by vite.config.ts `define` from version.json (the source of truth).
// e.g. __APP_VERSION__ === "0.4", __APP_STAGE__ === "alpha", __APP_CODENAME__ === "Breakbeat".
declare const __APP_VERSION__: string;
declare const __APP_STAGE__: string;
declare const __APP_CODENAME__: string;
// `git rev-list --count HEAD` at config time (0 when git isn't available).
declare const __GIT_COMMITS__: number;
