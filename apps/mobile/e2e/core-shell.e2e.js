const fixtureEmail = process.env.TMZ_MOBILE_E2E_EMAIL || 'acceptance-premium@tminuszero.local';
const fixturePassword = process.env.TMZ_MOBILE_E2E_PASSWORD || 'AcceptancePass!2026';
const hasAuthFixture = Boolean(
  process.env.EXPO_PUBLIC_API_BASE_URL &&
    process.env.EXPO_PUBLIC_SUPABASE_URL &&
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);
const authenticatedIt = hasAuthFixture ? it : it.skip;

async function signInWithFixture() {
  await device.launchApp({
    newInstance: true,
    url: 'tminuszero://sign-in',
    permissions: {
      notifications: 'YES'
    }
  });

  await element(by.id('sign-in-email')).replaceText(fixtureEmail);
  await element(by.id('sign-in-password')).replaceText(fixturePassword);
  await element(by.id('sign-in-submit')).tap();

  await waitFor(element(by.id('sign-out-submit'))).toBeVisible().withTimeout(30000);
}

describe('mobile core shell', () => {
  it('opens the feed tab shell', async () => {
    await expect(element(by.id('feed-screen'))).toBeVisible();
  });

  it('accepts search input through the routed query screen', async () => {
    await element(by.id('tab-search')).tap();
    await expect(element(by.id('search-screen'))).toBeVisible();
    await element(by.id('search-input')).replaceText('starlink');
    await element(by.id('search-submit')).tap();
    await expect(element(by.id('search-screen'))).toBeVisible();
  });

  it('opens launch detail via deep link routing', async () => {
    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://launches/11111111-1111-4111-8111-111111111111'
    });
    await expect(element(by.id('launch-detail-screen'))).toBeVisible();
  });

  it('opens the saved, preferences, and profile tabs', async () => {
    await element(by.id('dock-manifest-toggle')).tap();
    await waitFor(element(by.id('dock-manifest'))).toBeVisible().withTimeout(5000);
    await element(by.id('tab-saved')).tap();
    await expect(element(by.id('saved-screen'))).toBeVisible();

    await element(by.id('dock-manifest-toggle')).tap();
    await waitFor(element(by.id('dock-manifest'))).toBeVisible().withTimeout(5000);
    await element(by.id('tab-preferences')).tap();
    await expect(element(by.id('preferences-screen'))).toBeVisible();
    await expect(element(by.id('preferences-enable-push'))).toBeVisible();
    await expect(element(by.id('preferences-send-push-test'))).toBeVisible();

    await element(by.id('tab-profile')).tap();
    await expect(element(by.id('profile-screen'))).toBeVisible();
  });

  it('opens the sign-in route via deep link', async () => {
    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://sign-in'
    });
    await expect(element(by.id('sign-in-email'))).toBeVisible();
    await expect(element(by.id('sign-in-submit'))).toBeVisible();
  });

  it('opens auth callback and reset routes via deep link', async () => {
    await device.launchApp({
      newInstance: true,
      url: 'https://www.tminuszero.app/auth/callback?error_description=Denied'
    });
    await expect(element(by.id('auth-callback-screen'))).toBeVisible();

    await device.launchApp({
      newInstance: true,
      url: 'https://www.tminuszero.app/auth/reset-password?error_description=Expired'
    });
    await expect(element(by.id('auth-reset-screen'))).toBeVisible();
  });

  it('restores the shell after relaunch without losing routed state', async () => {
    await element(by.id('tab-search')).tap();
    await expect(element(by.id('search-screen'))).toBeVisible();
    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      permissions: {
        notifications: 'YES'
      }
    });
    await expect(element(by.id('feed-screen'))).toBeVisible();
  });

  authenticatedIt('signs in with configured E2E credentials and restores the session on relaunch', async () => {
    await signInWithFixture();
    await element(by.text('Back to feed')).tap();
    await expect(element(by.id('feed-screen'))).toBeVisible();

    await waitFor(element(by.id('feed-launch-first'))).toBeVisible().withTimeout(30000);
    await waitFor(element(by.id('feed-load-more'))).toBeVisible().withTimeout(30000);
    await element(by.id('feed-load-more')).tap();
    await waitFor(element(by.id('feed-launch-second'))).toBeVisible().withTimeout(30000);
    await element(by.id('feed-launch-first')).tap();
    await expect(element(by.id('launch-detail-screen'))).toBeVisible();

    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://search?q=starlink',
      permissions: {
        notifications: 'YES'
      }
    });
    await expect(element(by.id('search-screen'))).toBeVisible();
    await waitFor(element(by.id('search-result-first'))).toBeVisible().withTimeout(30000);

    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://saved',
      permissions: {
        notifications: 'YES'
      }
    });
    await expect(element(by.id('saved-screen'))).toBeVisible();

    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://preferences',
      permissions: {
        notifications: 'YES'
      }
    });
    await waitFor(element(by.id('preferences-screen'))).toBeVisible().withTimeout(30000);
    await element(by.id('preferences-enable-push')).tap();
    await waitFor(element(by.id('preferences-push-enabled-state'))).toHaveText('On').withTimeout(30000);
    await waitFor(element(by.id('preferences-device-registered-state'))).toHaveText('On').withTimeout(30000);

    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://profile',
      permissions: {
        notifications: 'YES'
      }
    });
    await expect(element(by.id('profile-screen'))).toBeVisible();
    await expect(element(by.id('profile-billing-section'))).toBeVisible();

    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://saved'
    });
    await expect(element(by.id('saved-screen'))).toBeVisible();

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      url: 'tminuszero://sign-in',
      permissions: {
        notifications: 'YES'
      }
    });

    await waitFor(element(by.id('sign-out-submit'))).toBeVisible().withTimeout(30000);
    await element(by.id('sign-out-submit')).tap();
    await waitFor(element(by.id('sign-in-submit'))).toBeVisible().withTimeout(30000);
  });
});
