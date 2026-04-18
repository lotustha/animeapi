import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}", "tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}", "scripts/tests/**/*.vitest.test.ts"],

    },
});
