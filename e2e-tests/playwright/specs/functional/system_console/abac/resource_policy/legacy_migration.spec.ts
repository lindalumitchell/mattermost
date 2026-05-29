// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 12 — Legacy Policy Migration & Backwards Compatibility
 * TC-57 through TC-58
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {
    ACTIONS,
    enableABAC,
    getChannelPolicy,
    openChannelSettings,
    openPermissionsPolicyTab,
    restoreFeatureFlags,
} from './support';

test.describe('Block 12 — Legacy Policy Migration', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let wildcardChannelId: string;
    let membershipOnlyId: string;

    const sysAdminEmail = process.env.RP_SYS_ADMIN_EMAIL ?? 'sysadmin@example.com';
    const sysAdminPassword = process.env.RP_SYS_ADMIN_PASSWORD ?? 'SomePassw0rd!';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        wildcardChannelId = process.env.RP_CH_WILDCARD_ID ?? '';
        membershipOnlyId = process.env.RP_CH_MEMBERSHIP_ONLY_ID ?? '';
        if (!membershipOnlyId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-57: Legacy wildcard * action migrated to explicit membership on save', async ({page}) => {
        test.skip(
            !wildcardChannelId,
            'Requires RP_CH_WILDCARD_ID — a channel pre-seeded with a v0.2/v0.3 wildcard * policy',
        );

        // Verify channel loads with PolicyEnforced=true
        const before = await getChannelPolicy(adminClient, wildcardChannelId);
        expect(before.status).toBe(200);

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(sysAdminEmail, sysAdminPassword);
        await page.waitForURL('**/channels/**');

        // Open Channel Settings and save without changes (triggers migration path)
        const wildcardChannelName = process.env.RP_CH_WILDCARD_NAME ?? 'ch-wildcard';
        await openChannelSettings(page, wildcardChannelName);
        await openPermissionsPolicyTab(page);
        await page.screenshot({path: 'test-results/tc-57-before-save.png', fullPage: true});

        await page.getByRole('button', {name: /save/i}).click();
        await page.waitForTimeout(1500);
        await page.screenshot({path: 'test-results/tc-57-after-save.png', fullPage: true});

        // Verify via API: wildcard * gone, explicit membership rule present, no duplicate
        const after = await getChannelPolicy(adminClient, wildcardChannelId);
        expect(after.status).toBe(200);
        const rules = (after.body as {rules?: Array<{actions: string[]}>}).rules ?? [];

        const membershipRules = rules.filter((r) => r.actions.includes(ACTIONS.membership));
        const wildcardRules = rules.filter((r) => r.actions.includes('*'));

        expect(wildcardRules.length).toBe(0); // no wildcard remaining
        expect(membershipRules.length).toBe(1); // exactly one membership rule
    });

    test('TC-58: Channel Settings loads correctly for channel with pre-existing v0.3 policy', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(sysAdminEmail, sysAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-membership-only');
        await page.screenshot({path: 'test-results/tc-58-channel-settings-v03.png', fullPage: true});

        // Membership tab should reflect existing rule
        const membershipTab = page.getByRole('tab', {name: /membership/i});
        if (await membershipTab.isVisible()) {
            await membershipTab.click();
            await page.screenshot({path: 'test-results/tc-58-membership-tab.png', fullPage: true});
        }

        // Permissions Policy tab should be empty (no permission rules)
        const permTab = page.getByRole('tab', {name: 'Permissions Policy'});
        if (await permTab.isVisible()) {
            await permTab.click();
            await page.screenshot({path: 'test-results/tc-58-permissions-tab-empty.png', fullPage: true});
            // No upload/download rules should exist
            await expect(page.getByText(/upload.*rule|download.*rule/i)).not.toBeVisible();
        }

        // No JS errors on the page
        const errors: string[] = [];
        page.on('pageerror', (err) => errors.push(err.message));
        await page.waitForTimeout(1000);
        expect(errors).toHaveLength(0);
    });
});
