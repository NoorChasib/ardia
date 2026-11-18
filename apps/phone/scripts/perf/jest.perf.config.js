const base = require("../../jest.config.js");

const only = process.env.PERF_PLATFORM;

module.exports = {
  projects: base.projects
    .filter((project) => !only || project.displayName === only)
    .map((project) => ({
      ...project,
      rootDir: `${__dirname}/../..`,
      testMatch: ["<rootDir>/scripts/perf/**/*.perf.tsx"],
      setupFiles: [...project.setupFiles, "<rootDir>/scripts/perf/fiberCounter.ts"],
    })),
};
