// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 8 — Simulate Access Modal: Channel Settings
 * TC-31 through TC-40
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {
    ACTIONS,
    CEL,
    ROLES,
    enableABAC,
    openChannelSettings,
    openPermissionsPolicyTab,
    restoreFeatureFlags,
    setFeatureFlag,
    FEATURE_FLAGS,
    upsertChannelPolicy,
} from './support';

test.describe('Block 8 — Simulate Access Modal (Channel Settings)', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const chanAdminEmail = process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com';
    const chanAdminPassword = process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const sysAdminEmail = process.env.RP_SYS_ADMIN_EMAIL ?? 'sysadmin@example.com';
    const sysAdminPassword = process.env.RP_SYS_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const userEngUsername = process.env.RP_USER_ENG_USERNAME ?? 'user-eng';
    const userHRUsername = process.env.RP_USER_HR_USERNAME ?? 'user-hr';
    const userGuestUsername = process.env.RP_USER_GUEST_USERNAME ?? 'user-guest';
    const userNoDeptUsername = process.env.RP_USER_NO_DEPT_USERNAME ?? 'user-no-dept';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);

        // Ensure Engineering Upload Rule exists
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);
    });

    // Helper: open Channel Settings -> Permissions tab -> click Simulate rules
    async function openSimulateModal(page: import('@playwright/test').Page) {
        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);
        await page.getByRole('button', {name: /simulate rules|simulate/i}).first().click();
        await page.waitForSelector('[data-testid="simulate-access-modal"], [aria-label*="Simulate"], .modal', {timeout: 8000});
    }

    test('TC-31: Simulate Access button opens modal pre-populated with channel members', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);
        await page.screenshot({path: 'test-results/tc-31-simulate-modal-open.png', fullPage: true});

        // Modal should be visible
        await expect(page.getByText(/simulate/i).first()).toBeVisible();
        // Actions filtered to upload_file_attachment
        await expect(page.getByText(/upload/i)).toBeVisible();
    });

    test('TC-32: this_rule scope — matching user shows ALLOW', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);

        // Add user-eng to simulation
        const userSearch = page.getByRole('textbox', {name: /search users|add user/i}).first();
        await userSearch.fill(userEngUsername);
        await page.getByText(userEngUsername).first().click();

        // Ensure scope = this_rule (default)
        const scopeSelector = page.getByRole('combobox', {name: /scope/i});
        if (await scopeSelector.isVisible()) {
            await scopeSelector.selectOption({label: /this rule/i});
        }

        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-32-allow-result.png', fullPage: true});

        await expect(page.getByText(/allow/i)).toBeVisible();
        await expect(page.getByText(/this_rule|this rule/i)).toBeVisible();
    });

    test('TC-33: this_rule scope — non-matching user shows DENY with blame', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);

        const userSearch = page.getByRole('textbox', {name: /search users|add user/i}).first();
        await userSearch.fill(userHRUsername);
        await page.getByText(userHRUsername).first().click();
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-33-deny-result.png', fullPage: true});

        await expect(page.getByText(/deny/i)).toBeVisible();
        // user-hr's dept value shown
        await expect(page.getByText(/hr/i)).toBeVisible();
        // No policy internals leaked beyond the rule's own expression
    });

    test('TC-34: this_rule scope — user with no applicable role shows rule-does-not-apply', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);

        const userSearch = page.getByRole('textbox', {name: /search users|add user/i}).first();
        await userSearch.fill(userGuestUsername);
        await page.getByText(userGuestUsername).first().click();
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-34-rule-not-applicable.png', fullPage: true});

        await expect(
            page.getByText(/rule doesn.t apply|no applicable rule|not applicable/i),
        ).toBeVisible();
    });

    test('TC-35: Upper-scoped deny shown generically (no policy details leaked)', async ({page}) => {
        test.skip(
            !process.env.RP_HAS_SYSTEM_POLICY,
            'Requires a system-level policy to be configured — set RP_HAS_SYSTEM_POLICY=true to enable',
        );

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-35-upper-scoped-deny.png', fullPage: true});

        await expect(page.getByText(/denied by another policy/i)).toBeVisible();
        // Must NOT show expression/rule name/attribute values from another policy
        const bodyText = await page.textContent('body') ?? '';
        expect(bodyText).not.toMatch(/system_permission.*expression|channel_policy.*name/i);
    });

    test('TC-36: All scope shows combined policy stack result', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);

        const userSearch = page.getByRole('textbox', {name: /search users|add user/i}).first();
        await userSearch.fill(userEngUsername);
        await page.getByText(userEngUsername).first().click();

        // Switch to All scope
        const scopeSelector = page.getByRole('combobox', {name: /scope/i});
        if (await scopeSelector.isVisible()) {
            await scopeSelector.selectOption({label: /all/i});
        } else {
            const allBtn = page.getByRole('radio', {name: /all/i});
            if (await allBtn.isVisible()) await allBtn.click();
        }

        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-36-all-scope.png', fullPage: true});

        // Should show some result (allow or deny)
        await expect(page.getByText(/allow|deny/i).first()).toBeVisible();
    });

    test('TC-37: Session attribute override changes simulation result', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);

        // Add user-no-dept
        const userSearch = page.getByRole('textbox', {name: /search users|add user/i}).first();
        await userSearch.fill(userNoDeptUsername);
        await page.getByText(userNoDeptUsername).first().click();

        // Open Configure session panel
        const configBtn = page.getByRole('button', {name: /configure session|session/i}).first();
        if (await configBtn.isVisible()) {
            await configBtn.click();
            // Set department override
            await page.getByLabel(/department/i).fill('engineering');
        }

        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-37-attribute-override.png', fullPage: true});

        // With override, user-no-dept should now ALLOW
        await expect(page.getByText(/allow/i)).toBeVisible();
    });

    test('TC-38: Non-sysadmin channel admin sees masked CPA values', async ({page}) => {
        test.skip(
            !process.env.RP_CLASSIFICATION_ATTR_ID,
            'Requires classification source_only CPA to be configured — set RP_CLASSIFICATION_ATTR_ID',
        );

        await setFeatureFlag(adminClient, 'AttributeValueMasking' as never, true);

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-38-masked-values.png', fullPage: true});

        // Masked sentinel value should appear
        await expect(page.getByText('--------')).toBeVisible();
    });

    test('TC-39: Sysadmin sees unmasked CPA values', async ({page}) => {
        test.skip(
            !process.env.RP_CLASSIFICATION_ATTR_ID,
            'Requires classification source_only CPA — set RP_CLASSIFICATION_ATTR_ID',
        );

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(sysAdminEmail, sysAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-39-unmasked-values.png', fullPage: true});

        // No masked sentinel
        await expect(page.getByText('--------')).not.toBeVisible();
    });

    test('TC-40: OR-structure preserved in masked expression trace', async ({page}) => {
        test.skip(
            !process.env.RP_CLASSIFICATION_ATTR_ID,
            'Requires classification source_only CPA — set RP_CLASSIFICATION_ATTR_ID',
        );

        // Create rule with OR expression using source_only field
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'OR Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineeringOrHR,
                actions: [ACTIONS.upload],
            },
        ]);

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openSimulateModal(page);
        await page.getByRole('button', {name: /run|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-40-or-structure-masked.png', fullPage: true});

        // Expression tree should show || structure, not collapsed to &&
        const bodyText = await page.textContent('body') ?? '';
        expect(bodyText).toMatch(/\|\|/);
        expect(bodyText).not.toMatch(/--------.*&&.*--------/);

        await restoreFeatureFlags(adminClient);
    });
});
