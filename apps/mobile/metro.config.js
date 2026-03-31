const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const launchDetailUiRoot = path.resolve(workspaceRoot, 'packages/launch-detail-ui');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...new Set([...(config.watchFolders || []), launchDetailUiRoot])];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  '@tminuszero/launch-detail-ui': launchDetailUiRoot
};

module.exports = config;
