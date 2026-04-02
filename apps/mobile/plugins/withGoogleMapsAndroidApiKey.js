const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');
const { normalizeEnvText } = require('./normalizeEnv');

function upsertMetaDataItem(metaDataItems, name, value) {
  const existing = metaDataItems.find((item) => item?.$?.['android:name'] === name);
  if (existing) {
    existing.$['android:value'] = value;
    return;
  }

  metaDataItems.push({
    $: {
      'android:name': name,
      'android:value': value
    }
  });
}

module.exports = function withGoogleMapsAndroidApiKey(config) {
  const apiKey = normalizeEnvText(process.env.GOOGLE_MAPS_ANDROID_API_KEY);
  if (!apiKey) {
    return config;
  }

  return withAndroidManifest(config, (nextConfig) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(nextConfig.modResults);
    app['meta-data'] = app['meta-data'] || [];
    upsertMetaDataItem(app['meta-data'], 'com.google.android.geo.API_KEY', apiKey);
    return nextConfig;
  });
};
