/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '\\.(e2e-)?spec\\.ts$',
  // Les scénarios navigateur (Playwright, dossier e2e/) ne sont pas des tests Jest
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/frontend/', '/dist/'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 60000,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json', diagnostics: false }] },
};
