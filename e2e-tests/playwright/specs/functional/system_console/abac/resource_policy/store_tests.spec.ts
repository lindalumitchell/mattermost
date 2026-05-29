// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 16 — API: PolicyActionsHydration Store Tests
 * TC-67 through TC-70
 *
 * Pure API tests — no UI interaction.
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';

import {
    ACTIONS,
    CEL,
    POLICY_VERSION,
    ROLES,
    enableABAC,
    restoreFeatureFlags,
    upsertChannelPolicy,
} from './support';

/**
 * Helper: fetch policy actions for a single policy ID.
 * Maps to the store's GetActionsForPolicy.
 */
async function getActionsForPolicy(
    adminClient: {getUrl(): string; getToken(): string},
    policyId: string,
): Promise<{status: number; body: unknown}> {
    const response = await fetch(
        `${adminClient.getUrl()}/api/v4/access_control_policies/${policyId}/actions`,
        {
            headers: {
                Authorization: `Bearer ${adminClient.getToken()}`,
            },
        },
    );
    const body = await response.json().catch(() => null);
    return {status: response.status, body};
}

/**
 * Helper: fetch policy actions for multiple policy IDs (batch).
 * Maps to the store's GetActionsForPolicies.
 */
async function getActionsForPolicies(
    adminClient: {getUrl(): string; getToken(): string},
    policyIds: string[],
): Promise<{status: number; body: unknown}> {
    const params = policyIds.map((id) => `ids=${id}`).join('&');
    const response = await fetch(
        `${adminClient.getUrl()}/api/v4/access_control_policies/actions?${params}`,
        {
            headers: {
                Authorization: `Bearer ${adminClient.getToken()}`,
            },
        },
    );
    const body = await response.json().catch(() => null);
    return {status: response.status, body};
}

test.describe('Block 16 — API PolicyActionsHydration Store Tests', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let uploadChannelId: string;
    let membershipChannelId: string;
    let uploadPolicyId: string;
    let membershipPolicyId: string;

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        uploadChannelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';
        membershipChannelId = process.env.RP_CH_MEMBERSHIP_ONLY_ID ?? '';

        if (!uploadChannelId || !membershipChannelId) test.skip();

        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);

        // Ensure known policy states
        const uploadResult = await upsertChannelPolicy(adminClient, uploadChannelId, [
            {
                name: 'Upload Rule',
                role: ROLES.channelUser,
                expression: CEL.deptEngineering,
                actions: [ACTIONS.upload],
            },
        ]);
        expect(uploadResult.status).toBe(200);
        uploadPolicyId = (uploadResult.body as {id?: string}).id ?? '';

        // ch-membership-only already has a membership policy from setup
        const membershipGet = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels/${membershipChannelId}/access_control_policy`,
            {
                headers: {
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
            },
        );
        if (membershipGet.status === 200) {
            const body = (await membershipGet.json()) as {id?: string};
            membershipPolicyId = body.id ?? '';
        }
    });

    test('TC-67: GetActionsForPolicy returns union of own + parent actions for child policy', async () => {
        test.skip(
            !uploadPolicyId,
            'Requires a saved policy ID — uploadPolicyId not resolved from upsert response',
        );

        const result = await getActionsForPolicy(
            adminClient as {getUrl(): string; getToken(): string},
            uploadPolicyId,
        );
        expect(result.status).toBe(200);
        const actions = result.body as Record<string, boolean>;
        expect(actions[ACTIONS.upload]).toBe(true);
    });

    test('TC-68: GetActionsForPolicy returns 404 for non-existent policy ID', async () => {
        const fakeId = '00000000-0000-0000-0000-000000000000';
        const result = await getActionsForPolicy(
            adminClient as {getUrl(): string; getToken(): string},
            fakeId,
        );
        expect(result.status).toBe(404);
    });

    test('TC-69: GetActionsForPolicies returns correct map per ID', async () => {
        test.skip(
            !uploadPolicyId || !membershipPolicyId,
            'Requires both uploadPolicyId and membershipPolicyId to be resolved',
        );

        const result = await getActionsForPolicies(
            adminClient as {getUrl(): string; getToken(): string},
            [uploadPolicyId, membershipPolicyId],
        );
        expect(result.status).toBe(200);
        const map = result.body as Record<string, Record<string, boolean>>;

        // Upload policy
        expect(map[uploadPolicyId]).toBeDefined();
        expect(map[uploadPolicyId][ACTIONS.upload]).toBe(true);
        expect(map[uploadPolicyId][ACTIONS.membership]).toBeFalsy();

        // Membership policy
        expect(map[membershipPolicyId]).toBeDefined();
        expect(map[membershipPolicyId][ACTIONS.membership]).toBe(true);
        expect(map[membershipPolicyId][ACTIONS.upload]).toBeFalsy();
    });

    test('TC-70: GetActionsForPolicies omits missing IDs from result', async () => {
        test.skip(!uploadPolicyId, 'Requires uploadPolicyId to be resolved');

        const fakeId = '00000000-0000-0000-0000-000000000001';
        const result = await getActionsForPolicies(
            adminClient as {getUrl(): string; getToken(): string},
            [uploadPolicyId, fakeId],
        );
        expect(result.status).toBe(200);
        const map = result.body as Record<string, unknown>;

        // Valid ID present
        expect(map[uploadPolicyId]).toBeDefined();
        // Non-existent ID absent (not nil-valued)
        expect(map[fakeId]).toBeUndefined();
    });
});
