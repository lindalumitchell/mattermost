import {defineConfig, devices} from '@playwright/test';

import {duration, testConfig} from '@mattermost/playwright-lib';

const chromeUse = {
    browserName: 'chromium' as const,
    ...devices['Desktop Chrome'],
};

export default defineConfig({
    globalSetup: './global_setup',
    testDir: './specs',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['html', {open: 'never'}], ['list']],
    use: {
        baseURL: testConfig.baseURL,
        ignoreHTTPSErrors: true,
        headless: testConfig.headless,
        locale: 'en-US',
        launchOptions: {
            args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
            firefoxUserPrefs: {
                'media.navigator.streams.fake': true,
                'permissions.default.microphone': 1,
                'permissions.default.camera': 1,
            },
            slowMo: testConfig.slowMo,
        },
        screenshot: 'on',
        timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
        trace: 'off',
        video: 'on',
        actionTimeout: duration.half_min,
    },
    projects: [
        {
            name: 'chromium',
            use: chromeUse,
        },
    ],
});
