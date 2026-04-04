const { withPodfile } = require('expo/config-plugins');

const HELPER_NAME = 'patch_expo_constants_manifest_script!';
const HELPER_BLOCK = `
def patch_expo_constants_manifest_script!(installer)
  target = installer.pods_project.targets.find { |candidate| candidate.name == 'EXConstants' }
  return unless target

  phase = target.shell_script_build_phases.find do |candidate|
    candidate.name&.include?('Generate app.config for prebuilt Constants.manifest')
  end
  return unless phase

  manifest_script = File.expand_path('../plugins/generate-expo-constants-app-config.sh', __dir__)

  phase.shell_script = <<~SCRIPT
    export PROJECT_ROOT="\${PODS_ROOT}/../.."
    bash -l "\#{manifest_script}"
  SCRIPT
end

`;

const POST_INSTALL_ANCHOR = `    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
`;

function withExpoConstantsManifestWorkaround(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;

    if (!contents.includes(`def ${HELPER_NAME}`)) {
      const helperAnchor = `end\n\nENV['EX_DEV_CLIENT_NETWORK_INSPECTOR'] ||= podfile_properties['EX_DEV_CLIENT_NETWORK_INSPECTOR']`;
      if (!contents.includes(helperAnchor)) {
        throw new Error('Unable to inject EXConstants manifest workaround into Podfile.');
      }
      contents = contents.replace(helperAnchor, `end\n${HELPER_BLOCK}${helperAnchor}`);
    }

    if (!contents.includes(`    ${HELPER_NAME}(installer)`)) {
      if (!contents.includes(POST_INSTALL_ANCHOR)) {
        throw new Error('Unable to attach EXConstants manifest workaround to Podfile post_install.');
      }
      contents = contents.replace(
        POST_INSTALL_ANCHOR,
        `${POST_INSTALL_ANCHOR}\n    ${HELPER_NAME}(installer)\n`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withExpoConstantsManifestWorkaround;
