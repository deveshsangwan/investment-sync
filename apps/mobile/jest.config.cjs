module.exports = {
  preset: "jest-expo",
  testMatch: ["**/native-tests/**/*.spec.ts?(x)"],
  setupFilesAfterEnv: ["<rootDir>/native-tests/setup.ts"],
  clearMocks: true,
  testTimeout: 60000,
  transformIgnorePatterns: [
    "/node_modules/(?!(.pnpm|react-native|@react-native|expo|@expo|superjson|copy-anything|is-what))",
  ],
};
