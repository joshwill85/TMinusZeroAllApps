const { withXcodeProject } = require('expo/config-plugins');

function withIosUserScriptSandboxDisabled(config) {
  return withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();

    for (const [key, value] of Object.entries(configurations)) {
      if (key.endsWith('_comment')) {
        continue;
      }

      if (!value || typeof value !== 'object' || !value.buildSettings) {
        continue;
      }

      // Xcode 26 blocks React Native bundle script writes unless this is disabled.
      value.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
    }

    return config;
  });
}

module.exports = withIosUserScriptSandboxDisabled;
