module.exports = {
  preset: '@react-native/jest-preset',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Sibling git worktrees live under .worktrees/ (git-ignored). Their tests
  // and node_modules must not be crawled or run from this checkout.
  modulePathIgnorePatterns: ['<rootDir>/.worktrees/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.worktrees/'],
  // These packages ship untranspiled ESM; the react-native preset only
  // transforms react-native itself.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|expo(nent)?(-.*)?|@expo(nent)?/.*|@dangerousthings|react-native-.*)/)',
  ],
};
