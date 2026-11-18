const fs = require("node:fs");
const path = require("node:path");

function phoneModuleRoots(projectRoot) {
  const lexical = path.resolve(projectRoot, "node_modules");
  const real = fs.existsSync(lexical) ? fs.realpathSync(lexical) : lexical;
  return [...new Set([lexical, real])];
}

function nestedModuleFolders(originModulePath, roots) {
  const root = roots.find((candidate) => originModulePath.startsWith(candidate + path.sep));
  if (!root) return [];
  const folders = [];
  for (let dir = path.dirname(originModulePath); dir.length > root.length; dir = path.dirname(dir)) {
    if (path.basename(dir) !== "node_modules") folders.push(path.join(dir, "node_modules"));
  }
  return folders;
}

function withNestedPhoneModules(config, projectRoot) {
  const roots = phoneModuleRoots(projectRoot);
  const upstreamResolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const nested = nestedModuleFolders(context.originModulePath, roots);
    const scoped = nested.length ? { ...context, nodeModulesPaths: [...nested, ...(context.nodeModulesPaths ?? [])] } : context;
    return upstreamResolve ? upstreamResolve(scoped, moduleName, platform) : scoped.resolveRequest(scoped, moduleName, platform);
  };
  return config;
}

module.exports = { nestedModuleFolders, phoneModuleRoots, withNestedPhoneModules };
