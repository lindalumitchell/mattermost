// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 10 — PolicyActions Hydration & Membership Gate Correctness
 * TC-47 through TC-54
 *
 * Regression tests for the bug fix: permission-only policies must NOT block
 * bulk membership edits or guest invites.
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';

import {
    ACTIONS,
    CEL,
    ROLES,
    bulkSetChannelMembers,
    enableABAC,
    getChannelDetails,
    inviteGuestToChannel,
    restoreFeatureFlags,
    upsertChannelPolicy,
} from './support';

test.describe('Block 10 — PolicyActions Hydration & Membership Gate', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;

    let permPrivateId: string;
    let membershipOnlyId: string;
    let noPolicyId: string;
    let userEngId: string;
    let userHRId: string;
    let userGuestEmail: string;
    let teamId: string;

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        permPrivateId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        membershipOnlyId = process.env.RP_CH_MEMBERSHIP_ONLY_ID ?? '';
        noPolicyId = process.env.RP_CH_NO_POLICY_ID ?? '';
        userEngId = process.env.RP_USER_ENG_ID ?? '';
        userHRId = process.env.RP_USER_HR_ID ?? '';
        userGuestEmail = process.env.RP_USER_GUEST_EMAIL ?? 'user-guest@example.com';
        teamId = process.env.RP_TEAM_ID ?? '';

        if (!permPrivateId || !membershipOnlyId || !noPolicyId) test.skip();

        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);

        // Ensure ch-perm-private has ONLY permission-action rules (no membership)
        await upsertChannelPolicy(adminClient, permPrivateId, [
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
    });

    test('TC-47: Bulk SetChannelMembers blocked for membership-policy channel', async () => {
        const result = await bulkSetChannelMembers(adminClient, membershipOnlyId, [userEngId]);
        // Membership-enforced channels block bulk member edits
        expect(result.status).toBe(400);
    });

    test('TC-48: Bulk SetChannelMembers allowed for permission-only policy channel', async () => {
        const result = await bulkSetChannelMembers(adminClient, permPrivateId, [userEngId, userHRId]);
        // Permission-only policy does NOT block bulk membership edits
        expect(result.status).toBe(200);
    });

    test('TC-49: Guest invite rejected for membership-policy channel', async () => {
        test.skip(!teamId, 'Requires RP_TEAM_ID env var');
        const result = await inviteGuestToChannel(adminClient, teamId, userGuestEmail, [membershipOnlyId]);
        expect(result.status).toBe(400);
    });

    test('TC-50: Guest invite succeeds for permission-only policy channel', async () => {
        test.skip(!teamId, 'Requires RP_TEAM_ID env var');
        const result = await inviteGuestToChannel(adminClient, teamId, userGuestEmail, [permPrivateId]);
        // Permission-only policy does not gate membership/joins
        expect([200, 201]).toContain(result.status);
    });

    test('TC-51: GET channel includes correct policy_actions for permission-only channel', async () => {
        const result = await getChannelDetails(adminClient, permPrivateId);
        expect(result.status).toBe(200);
        const ch = result.body as Record<string, unknown>;
        expect(ch.policy_enforced).toBe(true);
        const actions = ch.policy_actions as Record<string, boolean>;
        expect(actions).toBeTruthy();
        expect(actions[ACTIONS.upload]).toBe(true);
        expect(actions[ACTIONS.download]).toBe(true);
        // membership should NOT be present
        expect(actions[ACTIONS.membership]).toBeFalsy();
    });

    test('TC-52: GET channel includes correct policy_actions for membership-only channel', async () => {
        const result = await getChannelDetails(adminClient, membershipOnlyId);
        expect(result.status).toBe(200);
        const ch = result.body as Record<string, unknown>;
        expect(ch.policy_enforced).toBe(true);
        const actions = ch.policy_actions as Record<string, boolean>;
        expect(actions).toBeTruthy();
        expect(actions[ACTIONS.membership]).toBe(true);
        expect(actions[ACTIONS.upload]).toBeFalsy();
        expect(actions[ACTIONS.download]).toBeFalsy();
    });

    test('TC-53: GET channel shows policy_enforced=false for no-policy channel', async () => {
        const result = await getChannelDetails(adminClient, noPolicyId);
        expect(result.status).toBe(200);
        const ch = result.body as Record<string, unknown>;
        expect(ch.policy_enforced).toBeFalsy();
        // policy_actions empty or null
        const actions = ch.policy_actions as Record<string, boolean> | null;
        if (actions) {
            expect(Object.keys(actions).length).toBe(0);
        }
    });

    test('TC-54: Channel list endpoint returns correct policy_actions per channel', async () => {
        test.skip(!teamId, 'Requires RP_TEAM_ID env var');

        const response = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels?team_id=${teamId}&per_page=200`,
            {
                headers: {
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
            },
        );
        expect(response.status).toBe(200);
        const channels = (await response.json()) as Array<Record<string, unknown>>;

        const permPrivate = channels.find((c) => c.id === permPrivateId);
        const membershipOnly = channels.find((c) => c.id === membershipOnlyId);
        const noPolicy = channels.find((c) => c.id === noPolicyId);

        expect(permPrivate).toBeDefined();
        expect(membershipOnly).toBeDefined();
        expect(noPolicy).toBeDefined();

        // Each has the right action map
        expect((permPrivate?.policy_actions as Record<string, boolean>)?.[ACTIONS.upload]).toBe(true);
        expect((membershipOnly?.policy_actions as Record<string, boolean>)?.[ACTIONS.membership]).toBe(true);
        expect(noPolicy?.policy_enforced).toBeFalsy();
    });
});
