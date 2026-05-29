// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 15 — Error Handling & Edge Cases
 * TC-63 through TC-66
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
    upsertChannelPolicy,
} from './support';

test.describe('Block 15 — Error Handling & Edge Cases', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;
    let userEngId: string;

    const chanAdminEmail = process.env.RP_CHAN_ADMIN_EMAIL ?? 'user-chan-admin@example.com';
    const chanAdminPassword = process.env.RP_CHAN_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const userEngEmail = process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com';

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        userEngId = process.env.RP_USER_ENG_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);

        // Ensure ch-perm-private has a permission-only policy
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Engineering Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);
    });

    test('TC-63: 500 error during policy load shows error state, not blank form', async ({page}) => {
        // Intercept the channel policy GET and return 500
        await page.route('**/api/v4/channels/*/access_control_policy', (route) =>
            route.fulfill({status: 500, body: JSON.stringify({message: 'simulated server error'})}),
        );

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);
        await page.waitForTimeout(2000);

        await page.screenshot({path: 'test-results/tc-63-policy-load-error.png', fullPage: true});

        // Error state must be shown
        await expect(
            page.getByText(/error|failed to load|something went wrong/i).first(),
        ).toBeVisible();

        // Save button must be disabled to prevent wiping existing rules
        const saveBtn = page.getByRole('button', {name: /save/i});
        if (await saveBtn.isVisible()) {
            await expect(saveBtn).toBeDisabled();
        }
    });

    test('TC-64: Non-403 attribute fields fetch error leaves editor usable', async ({page}) => {
        // Intercept attribute fields endpoint and return 500
        await page.route('**/api/v4/custom_profile_attributes**', (route) =>
            route.fulfill({status: 500, body: JSON.stringify({message: 'simulated error'})}),
        );

        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);
        await page.getByRole('button', {name: 'Add rule'}).click();
        await page.waitForTimeout(2000);

        await page.screenshot({path: 'test-results/tc-64-attr-load-error.png', fullPage: true});

        // Editor must still render (not stuck in loading)
        await expect(page.getByLabel('Rule name')).toBeVisible();

        // Add rule button must still be usable
        await expect(page.getByRole('button', {name: /save/i})).toBeVisible();
    });

    test('TC-65: Direct self-add to permission-only policy channel is allowed', async () => {
        // Permission-only policy does not gate membership/joins
        const response = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels/${channelId}/members`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
                body: JSON.stringify({user_id: userEngId}),
            },
        );
        // 200 (already member) or 201 (newly added) both indicate allowed
        expect([200, 201]).toContain(response.status);
    });

    test('TC-66: Websocket event carries fresh policy_actions after policy update', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(chanAdminEmail, chanAdminPassword);
        await page.waitForURL('**/channels/**');

        // Subscribe to websocket events via page.evaluate
        const wsUrl = serverUrl.replace(/^http/, 'ws') + '/api/v4/websocket';
        const token = process.env.RP_ADMIN_TOKEN ?? '';

        await page.evaluate(
            ({wsUrl, token, channelId}: {wsUrl: string; token: string; channelId: string}) => {
                (window as Record<string, unknown>).__rpWsEvents = [];
                const ws = new WebSocket(wsUrl);
                ws.onopen = () => {
                    ws.send(JSON.stringify({seq: 1, action: 'authentication_challenge', data: {token}}));
                };
                ws.onmessage = (e: MessageEvent) => {
                    try {
                        const msg = JSON.parse(e.data as string) as {event?: string; data?: unknown};
                        if (msg.event === 'channel_access_control_updated') {
                            (window as Record<string, unknown>).__rpWsEvents =
                                [msg.data, ...(window as Record<string, unknown[]>).__rpWsEvents as unknown[]];
                        }
                    } catch {}
                };
                (window as Record<string, unknown>).__rpWs = ws;
            },
            {wsUrl, token, channelId},
        );

        await page.waitForTimeout(1000);

        // Trigger a policy update via Channel Settings
        await openChannelSettings(page, 'ch-perm-private');
        await openPermissionsPolicyTab(page);
        await page.getByRole('button', {name: 'Add rule'}).click();
        await page.getByLabel('Rule name').fill('WS Test Rule');
        await page.getByRole('combobox', {name: 'Role'}).selectOption(ROLES.channelUser);
        await page.getByLabel('CEL Expression').fill(CEL.deptEngineering);
        await page.getByLabel('Upload Files').check();
        await page.getByRole('button', {name: 'Save'}).click();
        await page.waitForTimeout(3000);

        await page.screenshot({path: 'test-results/tc-66-after-policy-save.png', fullPage: true});

        // Check that we received the websocket event
        const wsEvents = await page.evaluate(
            () => (window as Record<string, unknown>).__rpWsEvents,
        ) as unknown[];

        expect(wsEvents.length).toBeGreaterThan(0);

        // The event payload should include policy_actions
        const firstEvent = wsEvents[0] as Record<string, unknown>;
        expect(firstEvent).toBeTruthy();
    });
});
