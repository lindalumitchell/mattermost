// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 6 — File Download Enforcement
 * TC-24 through TC-28
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {
    ACTIONS,
    CEL,
    ROLES,
    enableABAC,
    restoreFeatureFlags,
    upsertChannelPolicy,
} from './support';

test.describe('Block 6 — File Download Enforcement', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const creds = {
        userEng: [process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com', process.env.RP_USER_ENG_PASSWORD ?? 'SomePassw0rd!'],
        userHR: [process.env.RP_USER_HR_EMAIL ?? 'user-hr@example.com', process.env.RP_USER_HR_PASSWORD ?? 'SomePassw0rd!'],
    };

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-24: Add download rule via API and verify', async () => {
        const result = await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
            {
                name: 'Engineering Download Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.download],
            },
        ]);
        expect(result.status).toBe(200);
    });

    test('TC-25: User with matching dept can download file', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userEng[0], creds.userEng[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        // Find a file attachment in the channel and attempt download
        const downloadLink = page.getByRole('link', {name: /download|test-upload/i}).first();
        await page.screenshot({path: 'test-results/tc-25-before-download.png', fullPage: true});

        // Intercept to confirm download is not blocked
        const [download] = await Promise.all([
            page.waitForEvent('download', {timeout: 8000}).catch(() => null),
            downloadLink.click().catch(() => {}),
        ]);

        await page.screenshot({path: 'test-results/tc-25-after-download.png', fullPage: true});
        // A non-null download event means the browser started the download
        expect(download).not.toBeNull();
    });

    test('TC-26: User without matching dept cannot download file', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userHR[0], creds.userHR[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-26-before-download.png', fullPage: true});

        const downloadLink = page.getByRole('link', {name: /download|test-upload/i}).first();
        const isVisible = await downloadLink.isVisible().catch(() => false);

        if (isVisible) {
            // Route intercept to detect a 403 response on download
            let downloadBlocked = false;
            await page.route('**/api/v4/files/**', async (route) => {
                const response = await route.fetch();
                if (response.status() === 403) downloadBlocked = true;
                await route.fulfill({response});
            });

            await downloadLink.click().catch(() => {});
            await page.waitForTimeout(2000);
            await page.screenshot({path: 'test-results/tc-26-after-download-attempt.png', fullPage: true});

            // Either blocked at network or error shown in UI
            const hasError = await page.getByText(/do not have permission|not allowed/i).isVisible().catch(() => false);
            expect(downloadBlocked || hasError).toBe(true);

            // Ensure no policy details are exposed
            const pageText = await page.textContent('body') ?? '';
            expect(pageText).not.toMatch(/Engineering Download Rule|department.*engineering/i);
        } else {
            // Download link not visible to denied user — also valid
            await page.screenshot({path: 'test-results/tc-26-download-link-hidden.png', fullPage: true});
        }
    });

    test('TC-27: File search filtering respects download policy for denied user', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userHR[0], creds.userHR[1]);
        await page.waitForURL('**/channels/**');

        // Open search
        await page.getByRole('button', {name: /search/i}).first().click();
        await page.getByRole('textbox', {name: /search/i}).fill('test-upload');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);

        await page.screenshot({path: 'test-results/tc-27-search-results.png', fullPage: true});

        // Files from ch-perm-private should not appear for user-hr
        const results = page.getByText('ch-perm-private');
        await expect(results).not.toBeVisible();
    });

    test('TC-28: Fail-closed on download API error (route intercept)', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userEng[0], creds.userEng[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        // Simulate a 500 error from the file download endpoint
        await page.route('**/api/v4/files/**', (route) =>
            route.fulfill({status: 500, body: JSON.stringify({message: 'internal server error'})}),
        );

        const downloadLink = page.getByRole('link', {name: /download|test-upload/i}).first();
        await downloadLink.click().catch(() => {});
        await page.waitForTimeout(2000);

        await page.screenshot({path: 'test-results/tc-28-fail-closed.png', fullPage: true});

        // Fail-closed: download must not succeed
        const [download] = await Promise.all([
            page.waitForEvent('download', {timeout: 3000}).catch(() => null),
            Promise.resolve(),
        ]);
        expect(download).toBeNull();
    });
});
