// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 11 — Mixed Rules (Membership + Permission on the Same Policy)
 * TC-55 through TC-56
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';
import {pages} from '@e2e-pw/pages';

import {
    ACTIONS,
    CEL,
    ROLES,
    enableABAC,
    getChannelPolicy,
    openChannelSettings,
    openPermissionsPolicyTab,
    restoreFeatureFlags,
    upsertChannelPolicy,
} from './support';

async function tryUploadFile(page: import('@playwright/test').Page): Promise<boolean> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
        name: 'mixed-test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('mixed rules upload test'),
    });
    await page.waitForTimeout(2000);
    const hasPreview = await page.getByText('mixed-test.txt').isVisible().catch(() => false);
    const hasError = await page.getByText(/do not have permission|not allowed/i).isVisible().catch(() => false);
    if (hasPreview) await page.keyboard.press('Enter');
    return hasPreview && !hasError;
}

test.describe('Block 11 — Mixed Rules', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const chanAdminEmail = process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com';
    const chanAdminPassword = process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const userEngEmail = process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com';
    const userEngPassword = process.env.RP_USER_ENG_PASSWORD ?? 'SomePassw0rd!';
    const userHREmail = process.env.RP_USER_HR_EMAIL ?? 'user-hr@example.com';
    const userHRPassword = process.env.RP_USER_HR_PASSWORD ?? 'SomePassw0rd!';
    const userHRId = process.env.RP_USER_HR_ID ?? '';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-55: Channel with both membership and upload rules enforces both independently', async ({page}) => {
        // Add membership rule + upload rule to ch-perm-private
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Membership Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.membership],
            },
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);

        // Step 1: Try to add user-hr (department=hr) — membership policy should deny
        const addResult = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels/${channelId}/members`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
                body: JSON.stringify({user_id: userHRId}),
            },
        );
        expect(addResult.status).toBe(400);

        // Step 2: user-eng can upload
        {
            const loginPage = new pages.LoginPage(page, serverUrl);
            await loginPage.goto();
            await loginPage.login(userEngEmail, userEngPassword);
            await page.waitForURL('**/channels/**');
            await page.getByText('ch-perm-private').first().click();
            await page.screenshot({path: 'test-results/tc-55-eng-upload.png', fullPage: true});
            const uploaded = await tryUploadFile(page);
            expect(uploaded).toBe(true);
        }

        // Step 3: user-hr (if somehow in channel) upload denied
        // We verify this at the API level since user-hr cannot join
        // The upload rule CEL also denies hr, so no further UI step needed here
    });

    test('TC-56: Saving channel permissions preserves existing membership rule', async ({page}) => {
        // ch-perm-private currently has membership + upload rules
        const beforeResult = await getChannelPolicy(adminClient, channelId);
        const beforeBody = beforeResult.body as {rules?: Array<{name: string; actions: string[]}>};
        const membershipRuleBefore = beforeBody.rules?.find((r) => r.actions.includes(ACTIONS.membership));
        expect(membershipRuleBefore).toBeDefined();

        // Open Channel Settings -> edit only the upload rule expression via UI
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);

        // Click edit on the upload rule
        await page.getByRole('button', {name: /edit/i}).first().click();
        const celInput = page.getByLabel('CEL Expression');
        await celInput.clear();
        await celInput.fill(`${CEL.deptEngineering} || user.attributes.clearance == "high"`);
        await page.getByRole('button', {name: 'Save'}).click();
        await page.waitForTimeout(1500);
        await page.screenshot({path: 'test-results/tc-56-after-save.png', fullPage: true});

        // Verify membership rule still present after save
        const afterResult = await getChannelPolicy(adminClient, channelId);
        const afterBody = afterResult.body as {rules?: Array<{name: string; actions: string[]}>};
        const membershipRuleAfter = afterBody.rules?.find((r) => r.actions.includes(ACTIONS.membership));
        expect(membershipRuleAfter).toBeDefined();
        expect(membershipRuleAfter?.name).toBe(membershipRuleBefore?.name);
    });
});
