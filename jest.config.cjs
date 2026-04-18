/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: [
        "**/src/**/__tests__/**/*.[jt]s?(x)",
        "**/src/**/?(*.)+(spec|test).[jt]s?(x)",
        "!**/*.vitest.test.ts",
        "**/scripts/tests/**/*.jest.test.[jt]s"
    ],


    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: 'tsconfig.json',
        }],
    },
};
