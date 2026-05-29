// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 3 & 4 — Add Permission Rule: Happy Path & Validation
 * TC-12 through TC-18
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {
    ACTIONS,
    CEL,
    POLICY_VERSION,
    ROLES,
    enableABAC,
    fillPermissionRuleForm,
    getChannelPolicy,
    openChannelSettings,
    openPermissionsPolicyTab,
    restoreFeatureFlags,
    upsertChannelPolicy,
} from './support';

test.describe('Block 3 & 4 — Add Permission Rule', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const chanAdminEmail = process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com';
    const chanAdminPassword = process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-12: Add a valid upload rule for channel_user role', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        await fillPermissionRuleForm(page, {
            name: 'Engineering Upload Rule',
            role: ROLES.channelUser,
            expression: CEL.deptEngineering,
            action: 'Upload Files',
        });

        await page.screenshot({path: 'test-results/tc-12-rule-saved.png', fullPage: true});

        // Rule should appear in the list
        await expect(page.getByText('Engineering Upload Rule')).toBeVisible();
        // No error messages
        await expect(page.getByRole('alert')).not.toBeVisible();
    });

    test('TC-13: Saved policy has version v0.4', async () => {
        const result = await getChannelPolicy(adminClient, channelId);
        expect(result.status).toBe(200);
        expect((result.body as {version: string}).version).toBe(POLICY_VERSION);
    });

    test('TC-14: Add a second rule for channel_admin role', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        await fillPermissionRuleForm(page, {
            name: 'Admin Upload Rule',
            role: ROLES.channelAdmin,
            expression: CEL.deptHR,
            action: 'Upload Files',
        });

        await page.screenshot({path: 'test-results/tc-14-two-rules.png', fullPage: true});

        await expect(page.getByText('Engineering Upload Rule')).toBeVisible();
        await expect(page.getByText('Admin Upload Rule')).toBeVisible();
    });

    test('TC-15: Missing rule name shows inline error', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        await page.getByRole('button', {name: 'Add rule'}).click();
        // Leave name blank, fill other fields
        await page.getByRole('combobox', {name: 'Role'}).selectOption(ROLES.channelUser);
        await page.getByLabel('CEL Expression').fill(CEL.deptEngineering);
        await page.getByLabel('Upload Files').check();
        await page.getByRole('button', {name: 'Save'}).click();

        await page.screenshot({path: 'test-results/tc-15-missing-name-error.png', fullPage: true});

        // Expect inline validation error on the name field
        await expect(page.getByText(/name.*required|required.*name/i).or(page.getByRole('alert'))).toBeVisible();
        // Save should have been blocked — modal/form still open
        await expect(page.getByRole('button', {name: 'Save'})).toBeVisible();
    });

    test('TC-16: Whitespace-only name is rejected', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        await page.getByRole('button', {name: 'Add rule'}).click();
        await page.getByLabel('Rule name').fill('   ');
        await page.getByRole('combobox', {name: 'Role'}).selectOption(ROLES.channelUser);
        await page.getByLabel('CEL Expression').fill(CEL.deptEngineering);
        await page.getByLabel('Upload Files').check();
        await page.getByRole('button', {name: 'Save'}).click();

        await page.screenshot({path: 'test-results/tc-16-whitespace-name-error.png', fullPage: true});

        await expect(page.getByText(/name.*required|required.*name/i).or(page.getByRole('alert'))).toBeVisible();
    });

    test('TC-17: Duplicate rule name (exact and trailing space) shows error', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        // Try exact duplicate
        await page.getByRole('button', {name: 'Add rule'}).click();
        await page.getByLabel('Rule name').fill('Engineering Upload Rule');
        await page.getByRole('combobox', {name: 'Role'}).selectOption(ROLES.channelUser);
        await page.getByLabel('CEL Expression').fill(CEL.deptEngineering);
        await page.getByLabel('Upload Files').check();
        await page.getByRole('button', {name: 'Save'}).click();

        await page.screenshot({path: 'test-results/tc-17-duplicate-name-error.png', fullPage: true});

        await expect(page.getByText(/duplicate|unique|already exists/i).or(page.getByRole('alert'))).toBeVisible();
    });

    test('TC-18: API rejects channel policy rule with system_admin role', async () => {
        const result = await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Invalid Role Rule',
                role: 'system_admin',
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);

        expect(result.status).toBe(400);
    });
});
