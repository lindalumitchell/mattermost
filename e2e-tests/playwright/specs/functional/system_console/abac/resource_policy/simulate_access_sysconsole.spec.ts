// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 9 — Simulate Access Modal: System Console
 * TC-41 through TC-46
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
    loginAs,
    restoreFeatureFlags,
    simulateUsers,
} from './support';

test.describe('Block 9 — Simulate Access Modal (System Console)', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;
    let otherTeamChannelId: string;
    let teamAdminTeamId: string;

    const sysAdminEmail = process.env.RP_SYS_ADMIN_EMAIL ?? 'sysadmin@example.com';
    const sysAdminPassword = process.env.RP_SYS_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const teamAdminEmail = process.env.RP_TEAM_ADMIN_EMAIL ?? 'team-admin@example.com';
    const teamAdminPassword = process.env.RP_TEAM_ADMIN_PASSWORD ?? 'SomePassw0rd!';
    const userEngEmail = process.env.RP_USER_ENG_EMAIL ?? 'user-eng@example.com';
    const userEngPassword = process.env.RP_USER_ENG_PASSWORD ?? 'SomePassw0rd!';

    const samplePolicy = {
        type: 'channel',
        version: POLICY_VERSION,
        rules: [
            {
                name: 'Test Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ],
    };

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        otherTeamChannelId = process.env.RP_OTHER_TEAM_CHANNEL_ID ?? '';
        teamAdminTeamId = process.env.RP_TEAM_ADMIN_TEAM_ID ?? '';
        if (!channelId) test.skip();
        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-41: Simulate Access modal accessible from System Console', async ({page}) => {
        const loginPage = new pages.LoginPage(page, serverUrl);
        await loginPage.goto();
        await loginPage.login(sysAdminEmail, sysAdminPassword);
        await page.waitForURL('**/channels/**');

        // Navigate to System Console -> Permission Policies
        await page.goto(`${serverUrl}/admin_console/user_management/permission_policies`);
        await page.waitForLoadState('networkidle');
        await page.screenshot({path: 'test-results/tc-41-permission-policies-list.png', fullPage: true});

        // Open first policy or create one
        const policyLink = page.getByRole('link', {name: /policy|edit/i}).first();
        if (await policyLink.isVisible()) {
            await policyLink.click();
        } else {
            await page.getByRole('button', {name: /create|add|new/i}).first().click();
        }

        await page.getByRole('button', {name: /simulate access|simulate/i}).click();
        await page.waitForTimeout(2000);
        await page.screenshot({path: 'test-results/tc-41-simulate-modal-sysconsole.png', fullPage: true});

        await expect(page.getByText(/simulate/i).first()).toBeVisible();
        // User picker should NOT be pre-filtered to a single channel
        await expect(page.getByRole('textbox', {name: /search users|add user/i}).first()).toBeVisible();
    });

    test('TC-42: Team admin can simulate against own team channel', async () => {
        test.skip(!teamAdminTeamId || !channelId, 'Requires RP_TEAM_ADMIN_TEAM_ID and RP_CH_PERM_PRIVATE_ID');

        const teamAdminClient = await loginAs(serverUrl, teamAdminEmail, teamAdminPassword);
        const result = await simulateUsers(teamAdminClient, {
            policy: samplePolicy,
            users: [process.env.RP_USER_ENG_ID ?? ''],
            team_id: teamAdminTeamId,
            channel_id: channelId,
        });

        expect(result.status).toBe(200);
    });

    test('TC-43: Team admin cannot simulate against channel from different team', async () => {
        test.skip(
            !teamAdminTeamId || !otherTeamChannelId,
            'Requires RP_TEAM_ADMIN_TEAM_ID and RP_OTHER_TEAM_CHANNEL_ID',
        );

        const teamAdminClient = await loginAs(serverUrl, teamAdminEmail, teamAdminPassword);
        const result = await simulateUsers(teamAdminClient, {
            policy: samplePolicy,
            users: [process.env.RP_USER_ENG_ID ?? ''],
            team_id: teamAdminTeamId,
            channel_id: otherTeamChannelId, // channel belongs to a different team
        });

        expect(result.status).toBe(400);
        const body = result.body as {id?: string; message?: string};
        expect(JSON.stringify(body)).toMatch(/invalid_param.*team_id|team_id.*invalid/i);
    });

    test('TC-44: Regular user is forbidden from simulate endpoint', async () => {
        const userEngClient = await loginAs(serverUrl, userEngEmail, userEngPassword);
        const result = await simulateUsers(userEngClient, {
            policy: samplePolicy,
            users: [process.env.RP_USER_ENG_ID ?? ''],
            channel_id: channelId,
        });

        expect(result.status).toBe(403);
    });

    test('TC-45: Empty users list is rejected', async () => {
        const result = await simulateUsers(adminClient, {
            policy: samplePolicy,
            users: [],
            channel_id: channelId,
        });

        expect(result.status).toBe(400);
    });

    test('TC-46: Missing policy field is rejected', async () => {
        const result = await simulateUsers(adminClient, {
            users: [process.env.RP_USER_ENG_ID ?? ''],
            channel_id: channelId,
            // policy intentionally omitted
        });

        expect(result.status).toBe(400);
    });
});
