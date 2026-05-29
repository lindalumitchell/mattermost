// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

/**
 * Shared setup helpers for Resource Policy (channel permission rules) E2E tests.
 * Covers: MM-68693 / PR #36472
 *
 * Feature flags required:
 *   MM_FEATUREFLAGS_PERMISSIONPOLICIES=true
 *   MM_FEATUREFLAGS_CHANNELPERMISSIONPOLICIES=true
 *   MM_FEATUREFLAGS_POLICYSIMULATION=true
 *   EnableAttributeBasedAccessControl=true
 *   License: Enterprise Advanced
 */

import {expect} from '@playwright/test';

import {Client4} from '@mattermost/client';
import type {Channel, Team, UserProfile} from '@mattermost/types/lib';

import {createRandomUser, getAdminClient} from '@e2e-pw/server';

export const FEATURE_FLAGS = {
    permissionPolicies: 'PermissionPolicies',
    channelPermissionPolicies: 'ChannelPermissionPolicies',
    policySimulation: 'PolicySimulation',
} as const;

export const POLICY_VERSION = 'v0.4';

export const CEL = {
    deptEngineering: 'user.attributes.department == "engineering"',
    deptHR: 'user.attributes.department == "hr"',
    deptEngineeringOrHR: 'user.attributes.department == "engineering" || user.attributes.department == "hr"',
} as const;

export const ACTIONS = {
    upload: 'upload_file_attachment',
    download: 'download_file_attachment',
    membership: 'membership',
} as const;

export const ROLES = {
    channelUser: 'channel_user',
    channelAdmin: 'channel_admin',
    channelGuest: 'channel_guest',
} as const;

export interface ResourcePolicyTestData {
    team: Team;
    otherTeam: Team;
    channels: {
        permPrivate: Channel;
        permPublic: Channel;
        membershipOnly: Channel;
        noPolicy: Channel;
    };
    users: {
        sysAdmin: UserProfile;
        userEng: UserProfile;
        userHR: UserProfile;
        userGuest: UserProfile;
        userNoDept: UserProfile;
        userChanAdmin: UserProfile;
        teamAdmin: UserProfile;
    };
    cpaIds: {
        department: string;
        clearance: string;
        classification: string;
    };
}

/**
 * Set a feature flag value via the System Console API.
 * Returns the previous value so callers can restore it in afterAll.
 */
export async function setFeatureFlag(
    adminClient: Client4,
    flag: string,
    value: boolean,
): Promise<void> {
    await adminClient.updateConfig({
        FeatureFlags: {[flag]: value},
    } as never);
}

/**
 * Restore multiple feature flags to true (default for tests).
 */
export async function restoreFeatureFlags(adminClient: Client4): Promise<void> {
    await adminClient.updateConfig({
        FeatureFlags: {
            [FEATURE_FLAGS.permissionPolicies]: true,
            [FEATURE_FLAGS.channelPermissionPolicies]: true,
            [FEATURE_FLAGS.policySimulation]: true,
        },
    } as never);
}

/**
 * Enable ABAC in server config.
 */
export async function enableABAC(adminClient: Client4): Promise<void> {
    await adminClient.updateConfig({
        AccessControlSettings: {
            EnableAttributeBasedAccessControl: true,
        },
    } as never);
}

/**
 * Create a Custom Profile Attribute and return its id.
 */
export async function createCPA(
    adminClient: Client4,
    name: string,
    accessMode?: string,
): Promise<string> {
    const attr = await adminClient.createCustomProfileAttribute({
        name,
        type: 'text',
        visibility: 'public',
        ...(accessMode ? {access_mode: accessMode} : {}),
    } as never);
    return (attr as {id: string}).id;
}

/**
 * Set a CPA value for a user.
 */
export async function setCPAValue(
    adminClient: Client4,
    userId: string,
    attrId: string,
    value: string,
): Promise<void> {
    await adminClient.setCustomProfileAttributeValue(userId, attrId, value);
}

/**
 * Build a channel-scoped AccessControlPolicy payload (v0.4).
 */
export function buildChannelPolicy(rules: ChannelPolicyRule[]): object {
    return {
        type: 'channel',
        version: POLICY_VERSION,
        rules,
    };
}

export interface ChannelPolicyRule {
    id?: string;
    name: string;
    role: string;
    expression: string;
    actions: string[];
}

/**
 * Upsert a channel AccessControlPolicy via API.
 * Returns the response body.
 */
export async function upsertChannelPolicy(
    adminClient: Client4,
    channelId: string,
    rules: ChannelPolicyRule[],
): Promise<Record<string, unknown>> {
    const response = await fetch(
        `${adminClient.getUrl()}/api/v4/channels/${channelId}/access_control_policy`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${adminClient.getToken()}`,
            },
            body: JSON.stringify(buildChannelPolicy(rules)),
        },
    );
    const body = await response.json();
    return {status: response.status, body};
}

/**
 * Get a channel AccessControlPolicy via API.
 */
export async function getChannelPolicy(
    adminClient: Client4,
    channelId: string,
): Promise<Record<string, unknown>> {
    const response = await fetch(
        `${adminClient.getUrl()}/api/v4/channels/${channelId}/access_control_policy`,
        {
            headers: {
                Authorization: `Bearer ${adminClient.getToken()}`,
            },
        },
    );
    if (response.status === 404) {
        return {status: 404, body: null};
    }
    const body = await response.json();
    return {status: response.status, body};
}

/**
 * Call the simulate_users endpoint and return {status, body}.
 */
export async function simulateUsers(
    client: Client4,
    payload: object,
): Promise<{status: number; body: unknown}> {
    const response = await fetch(
        `${client.getUrl()}/api/v4/access_control_policies/cel/simulate_users`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${client.getToken()}`,
            },
            body: JSON.stringify(payload),
        },
    );
    const body = await response.json().catch(() => null);
    return {status: response.status, body};
}

/**
 * Get channel details (including policy_actions and policy_enforced) via API.
 */
export async function getChannelDetails(
    client: Client4,
    channelId: string,
): Promise<Record<string, unknown>> {
    const response = await fetch(
        `${client.getUrl()}/api/v4/channels/${channelId}`,
        {
            headers: {
                Authorization: `Bearer ${client.getToken()}`,
            },
        },
    );
    const body = await response.json();
    return {status: response.status, body};
}

/**
 * Attempt to bulk-set channel members via PUT /api/v4/channels/{id}/members.
 * Returns {status, body}.
 */
export async function bulkSetChannelMembers(
    client: Client4,
    channelId: string,
    userIds: string[],
): Promise<{status: number; body: unknown}> {
    const response = await fetch(
        `${client.getUrl()}/api/v4/channels/${channelId}/members`,
        {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${client.getToken()}`,
            },
            body: JSON.stringify(userIds.map((id) => ({user_id: id}))),
        },
    );
    const body = await response.json().catch(() => null);
    return {status: response.status, body};
}

/**
 * Invite a guest to a channel via API.
 * Returns {status, body}.
 */
export async function inviteGuestToChannel(
    client: Client4,
    teamId: string,
    guestEmail: string,
    channelIds: string[],
): Promise<{status: number; body: unknown}> {
    const response = await fetch(
        `${client.getUrl()}/api/v4/teams/${teamId}/invite-guests/email`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${client.getToken()}`,
            },
            body: JSON.stringify({
                emails: [guestEmail],
                channels: channelIds,
                message: '',
            }),
        },
    );
    const body = await response.json().catch(() => null);
    return {status: response.status, body};
}

/**
 * Login as a user and return a Client4 instance authenticated as that user.
 */
export async function loginAs(
    serverUrl: string,
    email: string,
    password: string,
): Promise<Client4> {
    const client = new Client4();
    client.setUrl(serverUrl);
    await client.login(email, password);
    return client;
}

/**
 * Navigate to Channel Settings for a given channel display name.
 * Assumes the page is already logged in and on a team.
 */
export async function openChannelSettings(page: import('@playwright/test').Page, channelName: string) {
    // Click the channel name in the sidebar to ensure it's active
    await page.getByRole('link', {name: channelName}).first().click();

    // Open channel settings via the channel header menu
    await page.getByRole('button', {name: 'Channel Settings'}).click();
}

/**
 * Open the Permissions Policy tab in Channel Settings.
 * Assumes Channel Settings modal is already open.
 */
export async function openPermissionsPolicyTab(page: import('@playwright/test').Page) {
    await page.getByRole('tab', {name: 'Permissions Policy'}).click();
}

/**
 * Fill and save a permission rule form.
 */
export async function fillPermissionRuleForm(
    page: import('@playwright/test').Page,
    opts: {
        name: string;
        role: string;
        expression: string;
        action: 'Upload Files' | 'Download Files';
    },
) {
    await page.getByRole('button', {name: 'Add rule'}).click();
    await page.getByLabel('Rule name').fill(opts.name);

    // Role selector
    await page.getByRole('combobox', {name: 'Role'}).selectOption(opts.role);

    // CEL expression
    await page.getByLabel('CEL Expression').fill(opts.expression);

    // Action checkbox
    await page.getByLabel(opts.action).check();

    await page.getByRole('button', {name: 'Save'}).click();
}
