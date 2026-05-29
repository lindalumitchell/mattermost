// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 7 — Guest Role Rules
 * TC-29 through TC-30
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

async function tryUploadFile(page: import('@playwright/test').Page): Promise<boolean> {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
        name: 'guest-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('guest upload test'),
    });
    await page.waitForTimeout(2000);
    const hasPreview = await page.getByText('guest-upload.txt').isVisible().catch(() => false);
    const hasError = await page.getByText(/do not have permission|not allowed/i).isVisible().catch(() => false);
    if (hasPreview) await page.keyboard.press('Enter');
    return hasPreview && !hasError;
}

test.describe('Block 7 — Guest Role Rules', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const guestEmail = process.env.RP_USER_GUEST_EMAIL ?? 'user-guest@example.com';
    const guestPassword = process.env.RP_USER_GUEST_PASSWORD ?? 'SomePassw0rd!';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-29: Guest with matching dept can upload when guest rule exists', async ({page}) => {
        // Add guest upload rule
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
            {
                name: 'Guest Upload Rule',
                role: ROLES.channelGuest,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(guestEmail, guestPassword);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-29-before-guest-upload.png', fullPage: true});
        const uploaded = await tryUploadFile(page);
        await page.screenshot({path: 'test-results/tc-29-after-guest-upload.png', fullPage: true});

        expect(uploaded).toBe(true);
    });

    test('TC-30: Guest denied when no guest rule exists (no fallback to channel_user)', async ({page}) => {
        // Remove guest rule — only channel_user and channel_admin rules
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
            {
                name: 'Admin Upload Rule',
                role: ROLES.channelAdmin,
                expression: CEL.deptHR,
                actions: [ACTIONS.upload],
            },
        ]);

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(guestEmail, guestPassword);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-30-before-guest-upload.png', fullPage: true});

        const uploadButton = page.getByRole('button', {name: /attach file|upload/i});
        const uploadHidden = !(await uploadButton.isVisible().catch(() => false));

        if (!uploadHidden) {
            const uploaded = await tryUploadFile(page);
            await page.screenshot({path: 'test-results/tc-30-after-guest-upload-attempt.png', fullPage: true});
            expect(uploaded).toBe(false);
        } else {
            await page.screenshot({path: 'test-results/tc-30-upload-button-hidden.png', fullPage: true});
            // Hidden upload button is valid denial
        }
    });
});
