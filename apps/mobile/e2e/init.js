const detox = require('detox');
const config = require('../detox.config');

beforeAll(async () => {
  await detox.init(config);
});

beforeEach(async () => {
  await device.launchApp({
    delete: true,
    permissions: {
      notifications: 'YES'
    }
  });
});

afterAll(async () => {
  await detox.cleanup();
});
