// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 2 — Channel Settings Permissions Policy Tab: Visibility & Access
 * TC-8 through TC-11
 *
 * All flags enabled, EA license active.
 * Tests that the Permissions Policy tab appears only for channel admins on
 * regular (non-DM/GM) channels.
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {enableABAC, restoreFeatureFlags} from './support';

test.describe('Block 2 — Channel Settings Permissions Policy Tab Visibility', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;

    // Credentials injected from environment / setup fixture
    const chanAdminEmail = process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com';
    const chanAdminPassword = process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const regularUserEmail = process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com';
    const regularUserPassword = process.env.RP_USER_ENG_PASSWORD ?? 'SomePassw0rd!';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-8: Permissions Policy tab visible to channel admin on private channel', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await page.getByText('ch-perm-private').first().click();
        await page.getByRole('button', {name: 'Channel Settings'}).click();

        await page.screenshot({path: 'test-results/tc-08-channel-settings-tabs.png', fullPage: true});

        const permTab = page.getByRole('tab', {name: 'Permissions Policy'});
        await expect(permTab).toBeVisible();

        await permTab.click();
        await page.screenshot({path: 'test-results/tc-08-permissions-policy-tab.png', fullPage: true});

        // Empty state: Add rule button, search field, table header
        await expect(page.getByRole('button', {name: 'Add rule'})).toBeVisible();
    });

    test('TC-9: Permissions Policy tab not visible on DM channel', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        // Open a DM — click the direct messages section
        await page.getByRole('button', {name: 'Write a direct message'}).click();

        // Type a username to find and open a DM
        const dmRecipient = process.env.RP_USER_ENG_USERNAME ?? 'user-eng';
        await page.getByRole('combobox', {name: 'Search for people'}).fill(dmRecipient);
        await page.getByText(dmRecipient).first().click();
        await page.keyboard.press('Enter');
        await page.waitForURL('**/channels/**');

        // Try to open channel settings
        const settingsBtn = page.getByRole('button', {name: 'Channel Settings'});
        if (await settingsBtn.isVisible()) {
            await settingsBtn.click();
            await page.screenshot({path: 'test-results/tc-09-dm-channel-settings.png', fullPage: true});
            await expect(page.getByRole('tab', {name: 'Permissions Policy'})).not.toBeVisible();
        } else {
            // DMs may not expose a Channel Settings button at all — that also satisfies the requirement
            await page.screenshot({path: 'test-results/tc-09-dm-no-settings-button.png', fullPage: true});
        }
    });

    test('TC-10: Permissions Policy tab not visible on GM channel', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        // Open a GM via the direct messages button
        await page.getByRole('button', {name: 'Write a direct message'}).click();

        const user1 = process.env.RP_USER_ENG_USERNAME ?? 'user-eng';
        const user2 = process.env.RP_USER_HR_USERNAME ?? 'user-hr';

        const searchBox = page.getByRole('combobox', {name: 'Search for people'});
        await searchBox.fill(user1);
        await page.getByText(user1).first().click();
        await searchBox.fill(user2);
        await page.getByText(user2).first().click();
        await page.keyboard.press('Enter');
        await page.waitForURL('**/channels/**');

        const settingsBtn = page.getByRole('button', {name: 'Channel Settings'});
        if (await settingsBtn.isVisible()) {
            await settingsBtn.click();
            await page.screenshot({path: 'test-results/tc-10-gm-channel-settings.png', fullPage: true});
            await expect(page.getByRole('tab', {name: 'Permissions Policy'})).not.toBeVisible();
        } else {
            await page.screenshot({path: 'test-results/tc-10-gm-no-settings-button.png', fullPage: true});
        }
    });

    test('TC-11: Permissions Policy tab not visible to regular channel member', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(regularUserEmail, regularUserPassword);
        await page.waitForURL('**/channels/**');

        await page.getByText('ch-perm-private').first().click();
        await page.getByRole('button', {name: 'Channel Settings'}).click();

        await page.screenshot({path: 'test-results/tc-11-regular-member-channel-settings.png', fullPage: true});

        await expect(page.getByRole('tab', {name: 'Permissions Policy'})).not.toBeVisible();
    });
});
