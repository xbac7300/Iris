module.exports = {
  testEnvironment: 'node', testMatch: ['<rootDir>/apps/**/*.spec.ts', '<rootDir>/packages/**/*.spec.ts', '<rootDir>/tests/*-rules.test.ts'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.base.json' }] },
  collectCoverageFrom: ['apps/api/src/auth/password.ts', 'apps/api/src/learning/rules.ts', 'packages/contracts/src/**/*.ts', 'packages/api-client/src/session.ts', 'packages/api-client/src/progress.ts'],
  coverageThreshold: { global: { statements: 60, branches: 60, functions: 60, lines: 60 } },
};
