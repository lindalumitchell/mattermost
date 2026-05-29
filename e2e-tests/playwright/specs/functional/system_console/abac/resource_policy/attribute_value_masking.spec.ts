// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Block 14 — Attribute Value Masking (AVM) in Save Path
 * TC-61 through TC-62
 *
 * Only applicable when AttributeValueMasking=true and a source_only CPA
 * field (classification) is in use.
 */

import {expect, test} from '@playwright/test';

import {getAdminClient} from '@e2e-pw/server';

import {
    ACTIONS,
    CEL,
    POLICY_VERSION,
    ROLES,
    enableABAC,
    getChannelPolicy,
    restoreFeatureFlags,
    setFeatureFlag,
    upsertChannelPolicy,
} from './support';

const MASKED_SENTINEL = '--------';

test.describe('Block 14 — Attribute Value Masking in Save Path', () => {
    let adminClient: Awaited<ReturnType<typeof getAdminClient>>;
    let serverUrl: string;
    let channelId: string;

    test.beforeAll(async () => {
        ({adminClient, serverUrl} = await getAdminClient());
        channelId = process.env.RP_CH_PERM_PRIVATE_ID ?? '';

        if (!channelId || !process.env.RP_CLASSIFICATION_ATTR_ID) {
            test.skip();
            return;
        }

        await enableABAC(adminClient);
        await restoreFeatureFlags(adminClient);
        await setFeatureFlag(adminClient, 'AttributeValueMasking' as never, true);

        // Create a rule that references the source_only classification attribute
        await upsertChannelPolicy(adminClient, channelId, [
            {
                name: 'Classification Rule',
                role: ROLES.channelUser,
                expression: `user.attributes.classification == "secret"`,
                actions: [ACTIONS.upload],
            },
        ]);
    });

    test.afterAll(async () => {
        await setFeatureFlag(adminClient, 'AttributeValueMasking' as never, false);
        await restoreFeatureFlags(adminClient);
    });

    test('TC-61: Changing action type via masked expression re-injection is rejected', async () => {
        // Step 1: retrieve the policy (literal will be masked as --------)
        const getResult = await getChannelPolicy(adminClient, channelId);
        expect(getResult.status).toBe(200);

        const policy = getResult.body as {
            version: string;
            rules: Array<{name: string; role: string; expression: string; actions: string[]}>;
        };

        // The expression should contain the masked sentinel when retrieved by a non-sysadmin
        // (or will be full text for sysadmin — in that case we simulate the attack manually)
        const rule = policy.rules[0];

        // Step 2: PUT back with actions changed from upload to download, expression unchanged (masked)
        const tampered = {
            ...policy,
            rules: [
                {
                    ...rule,
                    actions: [ACTIONS.download], // changed from upload
                    expression: rule.expression.includes(MASKED_SENTINEL)
                        ? rule.expression
                        : rule.expression.replace('secret', MASKED_SENTINEL),
                },
            ],
        };

        const putResponse = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels/${channelId}/access_control_policy`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
                body: JSON.stringify(tampered),
            },
        );

        // Server should lock actions back to stored value — either 200 with locked actions
        // or a 400/403 rejection
        if (putResponse.status === 200) {
            const saved = (await putResponse.json()) as {
                rules: Array<{actions: string[]}>;
            };
            // Actions must be locked back to upload, not changed to download
            expect(saved.rules[0].actions).toContain(ACTIONS.upload);
            expect(saved.rules[0].actions).not.toContain(ACTIONS.download);
        } else {
            expect([400, 403]).toContain(putResponse.status);
        }
    });

    test('TC-62: Deleting a rule with masked values is blocked (HTTP 403)', async () => {
        // PUT a policy that omits the rule containing source_only values
        const putResponse = await fetch(
            `${(adminClient as {getUrl(): string}).getUrl()}/api/v4/channels/${channelId}/access_control_policy`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${(adminClient as {getToken(): string}).getToken()}`,
                },
                body: JSON.stringify({
                    type: 'channel',
                    version: POLICY_VERSION,
                    rules: [], // omit all rules — attempts to delete the source_only rule
                }),
            },
        );

        expect(putResponse.status).toBe(403);
    });
});
