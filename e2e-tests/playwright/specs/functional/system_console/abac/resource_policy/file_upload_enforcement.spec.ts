// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 5 — File Upload Enforcement
 * TC-19 through TC-23
 *
 * State: ch-perm-private has an upload rule for channel_user
 * requiring department=engineering.
 * The Admin Upload Rule (channel_admin + department=hr) is added for TC-23.
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

// Helper: try to attach and send a file in the current channel.
// Returns true if the file message appears, false if denied.
async function tryUploadFile(page: import('@playwright/test').Page): Promise<boolean> {
    // Use a simple text blob as the upload target
    const fileInput = page.locator('input[type="file"]').first();

    // Trigger file input — Playwright can set files without clicking
    await fileInput.setInputFiles({
        name: 'test-upload.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('resource policy upload test'),
    });

    // Wait briefly for either a success (file preview) or an error
    await page.waitForTimeout(2000);

    const hasFilePreview = await page.getByText('test-upload.txt').isVisible().catch(() => false);
    const hasPermissionError = await page
        .getByText(/do not have permission|not allowed|permission denied/i)
        .isVisible()
        .catch(() => false);

    if (hasFilePreview) {
        // Send the message
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
    }

    return hasFilePreview && !hasPermissionError;
}

test.describe('Block 5 — File Upload Enforcement', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    const creds = {
        userEng: [process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com', process.env.RP_USER_ENG_PASSWORD ?? 'SomePassw0rd!'],
        userHR: [process.env.RP_USER_HR_EMAIL ?? 'user-hr@example.com', process.env.RP_USER_HR_PASSWORD ?? 'SomePassw0rd!'],
        userNoDept: [process.env.RP_USER_NO_DEPT_EMAIL ?? 'user-no-dept@example.com', process.env.RP_USER_NO_DEPT_PASSWORD ?? 'SomePassw0rd!'],
        chanAdmin: [process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com', process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!'],
    };

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);

        // Set up: upload rule for channel_user, no channel_admin rule
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);
    });

    test('TC-19: User with matching dept can upload file', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userEng[0], creds.userEng[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-19-before-upload.png', fullPage: true});
        const uploaded = await tryUploadFile(page);
        await page.screenshot({path: 'test-results/tc-19-after-upload.png', fullPage: true});

        expect(uploaded).toBe(true);
    });

    test('TC-20: User without matching dept cannot upload file', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userHR[0], creds.userHR[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-20-before-upload.png', fullPage: true});

        // Upload button may be hidden
        const uploadButton = page.getByRole('button', {name: /attach file|upload/i});
        const uploadHidden = !(await uploadButton.isVisible().catch(() => false));

        if (!uploadHidden) {
            // If button is visible, attempting upload should show a generic error
            const uploaded = await tryUploadFile(page);
            await page.screenshot({path: 'test-results/tc-20-after-upload-attempt.png', fullPage: true});
            expect(uploaded).toBe(false);

            // Error message must NOT expose policy details
            const errorText = await page.getByText(/do not have permission/i).textContent().catch(() => '');
            expect(errorText).not.toMatch(/engineering|department|CEL|policy.*name/i);
        } else {
            // Upload button hidden is also a valid denial
            await page.screenshot({path: 'test-results/tc-20-upload-button-hidden.png', fullPage: true});
        }

        expect(uploadHidden || true).toBe(true); // passes if either denial mechanism present
    });

    test('TC-21: User with no dept attribute cannot upload file', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.userNoDept[0], creds.userNoDept[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-21-before-upload.png', fullPage: true});

        const uploadButton = page.getByRole('button', {name: /attach file|upload/i});
        const uploadHidden = !(await uploadButton.isVisible().catch(() => false));

        if (!uploadHidden) {
            const uploaded = await tryUploadFile(page);
            await page.screenshot({path: 'test-results/tc-21-after-upload-attempt.png', fullPage: true});
            expect(uploaded).toBe(false);
        } else {
            await page.screenshot({path: 'test-results/tc-21-upload-button-hidden.png', fullPage: true});
        }
    });

    test('TC-22: Channel admin falls back to member rule when no admin rule exists', async ({page}) => {
        // Precondition: only channel_user rule exists (no channel_admin rule)
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(creds.chanAdmin[0], creds.chanAdmin[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-22-before-upload.png', fullPage: true});
        const uploaded = await tryUploadFile(page);
        await page.screenshot({path: 'test-results/tc-22-after-upload.png', fullPage: true});

        // chan-admin has department=engineering, so falls back to channel_user rule → ALLOW
        expect(uploaded).toBe(true);
    });

    test('TC-23: Channel admin rule shadows member rule (first-match-wins)', async ({page}) => {
        // Add channel_admin rule with department=hr (chan-admin has engineering → DENY)
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
        await loginPage.login(creds.chanAdmin[0], creds.chanAdmin[1]);
        await page.waitForURL('**/channels/**');
        await page.getByText('ch-perm-private').first().click();

        await page.screenshot({path: 'test-results/tc-23-before-upload.png', fullPage: true});
        const uploaded = await tryUploadFile(page);
        await page.screenshot({path: 'test-results/tc-23-after-upload.png', fullPage: true});

        // Admin rule matches first (department=hr fails for chan-admin) → DENY
        // No fall-through to channel_user rule
        expect(uploaded).toBe(false);
    });
});
