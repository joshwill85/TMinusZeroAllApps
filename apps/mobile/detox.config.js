const fs = require('node:fs');
const path = require('node:path');

function findFirstWithSuffix(dirPath, suffix) {
  if (!fs.existsSync(dirPath)) {
    return null;
  }

  const entry = fs.readdirSync(dirPath).find((value) => value.endsWith(suffix));
  return entry ? path.join(dirPath, entry) : null;
}

const iosDir = path.join(__dirname, 'ios');
const androidDir = path.join(__dirname, 'android');
const iosWorkspace = findFirstWithSuffix(iosDir, '.xcworkspace');
const iosScheme = iosWorkspace ? path.basename(iosWorkspace, '.xcworkspace') : 'tminuszero-mobile';

module.exports = {
  testRunner: {
    args: {
      $0: 'jest',
      config: path.join(__dirname, 'e2e', 'jest.config.js')
    },
    jest: {
      setupTimeout: 120000
    }
  },
  apps: {
    'ios.sim.debug': {
      type: 'ios.app',
      binaryPath: path.join(iosDir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', `${iosScheme}.app`),
      build: iosWorkspace
        ? `cd ios && xcodebuild -workspace ${path.basename(iosWorkspace)} -scheme ${iosScheme} -configuration Debug -sdk iphonesimulator -derivedDataPath build`
        : 'echo "Run expo prebuild --platform ios before Detox." && exit 1'
    },
    'android.emu.debug': {
      type: 'android.apk',
      binaryPath: path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
      testBinaryPath: path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'androidTest', 'debug', 'app-debug-androidTest.apk'),
      build: fs.existsSync(androidDir)
        ? 'cd android && ./gradlew assembleDebug assembleAndroidTest -DtestBuildType=debug'
        : 'echo "Run expo prebuild --platform android before Detox." && exit 1'
    }
  },
  devices: {
    simulator: {
      type: 'ios.simulator',
      device: {
        type: process.env.DETOX_IOS_DEVICE || 'iPhone 16'
      }
    },
    emulator: {
      type: 'android.emulator',
      device: {
        avdName: process.env.DETOX_AVD_NAME || 'Pixel_8_API_35'
      }
    }
  },
  configurations: {
    'ios.sim.debug': {
      device: 'simulator',
      app: 'ios.sim.debug'
    },
    'android.emu.debug': {
      device: 'emulator',
      app: 'android.emu.debug'
    }
  }
};
