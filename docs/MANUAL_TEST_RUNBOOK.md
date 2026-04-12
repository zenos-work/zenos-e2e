# Zenos Manual Test Runbook

This runbook is paired with the CSV matrix in this folder and is intended for local, staging, and production dry runs.

## Scope

The matrix covers launch-critical functional areas:

- Authentication and access control
- Reader journeys and article discovery
- Authoring and editorial workflow
- Social engagement and connected social accounts
- Notifications and profile/settings
- Admin moderation and feature controls
- Community and marketplace scope expansions

## Preconditions

- Frontend, backend, and D1 migrations are already deployed for the target environment.
- Test accounts exist for `READER`, `AUTHOR`, `APPROVER`, and `SUPERADMIN` roles.
- At least one seeded article is available, or the tester can create and publish one during the run.
- Stripe, Resend, and other environment-specific integrations are configured if those flows are being exercised.
- Database cleanup is intentionally out of scope for this run.

## Execution Notes

- Use the CSV to record `Pass`, `Fail`, or `Blocked` per test case.
- Capture screenshots and request IDs for any failures.
- For role-specific cases, sign out fully before switching accounts.
- For tests that create data, note the created IDs so they can be cleaned up after validation.
- If a feature is intentionally disabled by a feature flag, mark the gated experience as verified only if the fallback message is correct and access control matches the expected state.

## Recommended Order

1. Auth and access control
2. Public navigation and discovery
3. Authoring and workflow
4. Social and notifications
5. Profile and settings
6. Admin moderation and feature flags
7. Community and marketplace

## Evidence To Capture

- Login success and protected-route redirect behavior
- Draft, submitted, approved, and published article states
- Admin approval/rejection outcomes
- Notification delivery and read state changes
- Feature-flag preview output and gated route behavior
- Community post creation and marketplace purchase or review flow
