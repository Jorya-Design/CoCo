# Auth, identities, and access grants

Inventory verified on 1 November 2026 against project IAM, the workload identity
provider, its service-account policy, and Firebase Authentication configuration.

Project: coco-3471c (375045542679). Production:
https://coco-3471c.web.app. Firestore: (default), europe-west2.

## CoCo Co and its members

The prototype has one public organization, CoCo Co (organizations/coco-co).
Its editing members are:

- jhosephchi@gmail.com
- suryansh@gmail.com

The organization document is maintained administratively. Browser clients cannot
change its name or member list. The seed script creates it and its first room
once, and preserves existing room content on later runs.

Public read access applies to rooms with orgId=coco-co and their plan updates,
chat, presence, approvals, and run records. The UI marks this workspace as a
public demo. Unrelated orgs and room paths have no public grant.

## Application authentication

The application uses Firebase Authentication Google sign-in as its primary
method, with email/password registration, email verification, and password reset
as a fallback. Firebase manages and restores client sessions.

1. Visitors can browse CoCo Co without signing in.
2. A member selects Sign in → Continue with Google and chooses their member
   Google account. Other Google accounts remain read-only.
3. Google supplies the verified email claim for these Gmail members. A new
   password account must verify its email before it can edit.
4. The app reloads the user and refreshes the ID token after verification.
5. Firestore rules require email_verified=true and a lowercased email claim
   matching one of the organization's two member emails before allowing writes.

Registration is self-service, but creating or verifying another account grants
no editing access. A signed-in nonmember remains a read-only visitor.

Google provider configuration was completed by a teammate and verified in the
Firebase console: the provider is enabled and joryatm@gmail.com is saved as the
support contact. The public-facing project name is saved as CoCo, completing
[#2](https://github.com/Jorya-Design/CoCo/issues/2).

The Google button calls `signInWithPopup` with an account picker and the default
Google profile/email scopes. It does not request Gmail, Drive, or other Google
API access. Blocked windows, cancelled sign-in, unauthorized domains, network
failures, and provider configuration errors have visible recovery messages.
Pop-up sign-in avoids cross-site redirect storage dependencies. Users whose
browser blocks it can allow pop-ups for CoCo and retry; no redirect is started
silently after cancellation.

Firebase automatically resolves a Google-hosted Gmail identity to an existing
account with the same email. For other provider collisions, the UI keeps the
pending Google credential in component memory, locks the existing email, asks
for the existing CoCo password, and calls `linkWithCredential` on that signed-in
user. The app waits for linking and token refresh before closing sign-in. It does
not delete accounts, move documents, or store OAuth credentials in local/session
storage. Closing the sign-in screen discards any pending linking credential.

The production SDK configuration and Firebase public project configuration were
checked on 1 November 2026. `coco-3471c.web.app` and
`coco-3471c.firebaseapp.com` are authorized domains; the SDK uses
`coco-3471c.firebaseapp.com` as its auth domain.

Verification covers Google sign-in for both member emails in the Auth emulator,
UID preservation for existing verified password users, existing authored content,
explicit provider linking, refreshed Google claims, sign-out, anonymous browsing,
and rejection of verified Google outsiders. These emulator checks do not
substitute for each member completing sign-in with their real Google account in
production. The production authorization endpoint was also checked: it returns a
Google sign-in URL at accounts.google.com. No real member credentials are used
in tests.

The public Firebase SDK configuration is loaded from Hosting's
/__/firebase/init.json endpoint. Its API key identifies the app; Firestore rules
enforce access. No Google administrative credentials or OpenAI inference keys
are sent to the browser.

Implementation: [Firebase initialization](../apps/web/src/lib/firebase.ts),
[auth and org UI](../apps/web/src/App.tsx),
[sign-in error recovery](../apps/web/src/lib/auth.ts),
[Firestore rules](../firestore.rules), and
[organization bootstrap](../scripts/seed-organization.ts).

## Application user grants

| Principal | Grants |
| --- | --- |
| Signed-out visitor | Read CoCo Co's organization, rooms, shared plan, chat, presence, DAG snapshots, and execution records. No writes or presence heartbeat. |
| Unverified account | The same public read access; verification, password reset, and sign-out. No writes. |
| Verified nonmember | The same public read access. Cannot create rooms, edit plans, send chat, approve work, or change membership. |
| Either verified CoCo Co member | Create org rooms, edit shared plans, append chat, maintain their own presence, update room titles, and create immutable approval snapshots. |
| Any browser user, including both members | No organization/membership writes, room org changes, execution-record writes, or mutation/deletion of saved CRDT updates, chat messages, or approvals. |
| Authorized project administrator | Maintain the org membership document through Google Cloud/Firebase administrative access. This is a separate IAM grant. |

ownerUid records who created a room; editing authority comes from the org's
member list. App membership does not grant Google Cloud project IAM access.
No new Google Cloud role was granted to either application member.

### Firestore path policy

| Path | Read | Browser write |
| --- | --- | --- |
| organizations/coco-co | Public | Denied; administrative provisioning only. |
| rooms/{id} with orgId=coco-co | Public; list queries filter on orgId | Verified org member creates a room with their UID; members can update its title. |
| rooms/{id}/updates/{id} | Public for CoCo Co rooms | Member appends an attributed binary update up to 256 KiB. Immutable afterward. getAfter permits atomic room + seed creation. |
| rooms/{id}/messages/{id} | Public for CoCo Co rooms | Member appends a message up to 8,000 characters under their UID. Immutable afterward. |
| rooms/{id}/interviews/{id} | Public for CoCo Co rooms | Member appends a bounded, attributed question/answer with a matching new room message in the same batch. Immutable afterward. |
| rooms/{id}/presence/{sessionId} | Public for CoCo Co rooms | Member creates/updates/deletes their own presence. Another UID cannot take over the record. |
| rooms/{id}/approvals/{id} | Public for CoCo Co rooms | Member creates an immutable snapshot: plan up to 200,000 characters and 1–100 tasks. |
| rooms/{id}/runs/{id} | Public for CoCo Co rooms | Denied. Reserved for the trusted control plane. |
| All other paths | Denied | Denied |

Create timestamps must equal the server request time. Schemas reject extra
fields on append-only records. Rules do not parse Yjs or validate every task's
semantics. The client validates the DAG, and the future control plane must
independently validate an approval before executing it.

Membership is evaluated on authorized requests. Disabling an Auth account
prevents future sign-in/refresh; existing ID tokens are not an instant revocation
mechanism. Remove the member email administratively to revoke editing access.
Public read access remains available to everyone.

## GitHub Actions deployment identity

Service account: github-deploy@coco-3471c.iam.gserviceaccount.com.
The setup creates no service-account key.

Trust configuration:

- Pool: projects/375045542679/locations/global/workloadIdentityPools/coco-github.
- Provider: github.
- Issuer: https://token.actions.githubusercontent.com.
- Mappings: google.subject=assertion.sub and
  attribute.repository_id=assertion.repository_id.
- Condition:

~~~text
assertion.repository_id == '1441783030'
&& assertion.repository_owner_id == '93083413'
&& assertion.ref == 'refs/heads/main'
~~~

These are Jorya-Design/CoCo's repository ID, organization ID, and main ref.
The service-account policy grants roles/iam.workloadIdentityUser to:

~~~text
principalSet://iam.googleapis.com/projects/375045542679/locations/global/workloadIdentityPools/coco-github/attribute.repository_id/1441783030
~~~

GitHub obtains a short-lived OIDC identity, then impersonates this service
account. Pull-request refs do not satisfy the provider's branch condition.

### Project roles granted to the deployer

All five bindings below are scoped to coco-3471c.

| Role | Effective purpose and scope |
| --- | --- |
| roles/firebasehosting.admin | Manage Hosting sites, versions, and releases, including production content. |
| roles/firebaserules.admin | Manage and publish Firebase rulesets/releases, including rules that govern access to room data. |
| roles/datastore.indexAdmin | Manage Firestore indexes. |
| roles/firebase.viewer | Broad Firebase read access used by the CLI. This role also includes Firestore entity reads, Auth user reads, logs, and Storage object reads where those resources exist. |
| roles/serviceusage.serviceUsageConsumer | Use enabled project services and inspect usage metadata. |

The deployer has no project Owner, Editor, Firebase Auth Admin, or IAM policy
administration grant. Publishing Firestore rules can nevertheless change data
access, so changes to the main branch carry that authority.

The workflow's GitHub token has contents:read. The deploy job additionally has
id-token:write. Production uses the production environment and serial workflow
concurrency. GitHub Actions is enabled on this repository; the app's workflow
pins the actions it uses to exact commits.

Source of truth: [workflow](../.github/workflows/firebase.yml) and
[one-time IAM setup](../scripts/setup-deploy.sh).

## Existing Google Cloud principals

The following bindings were present in the verified project policy. The CI setup
preserved them. Human principal identities are maintained in the project's IAM
console; this public inventory records their roles and count.

| Principal | Project-level roles |
| --- | --- |
| Two existing human project administrators | roles/owner |
| service-375045542679@gcp-sa-firebase.iam.gserviceaccount.com | roles/firebase.managementServiceAgent |
| firebase-adminsdk-fbsvc@coco-3471c.iam.gserviceaccount.com | roles/firebase.sdkAdminServiceAgent; roles/firebaseauth.admin; roles/iam.serviceAccountTokenCreator |
| service-375045542679@firebase-rules.iam.gserviceaccount.com | roles/firebaserules.system |
| service-375045542679@gcp-sa-firestore.iam.gserviceaccount.com | roles/firestore.serviceAgent |

The existing Admin SDK account has broad administrative and data permissions.
It is not the browser identity or the GitHub deployer. Administrative SDK/IAM
access is governed by IAM and can bypass browser Firestore rules. A Firebase
Auth account and a Google Cloud project-owner grant are separate access systems.

This inventory covers project-level bindings and the new deployer's
service-account impersonation policy. It is not an audit of organization/folder
inheritance, every other service-account policy, or pre-existing credential keys.

## Local development identities

The auth and Firestore emulators use demo-coco and loopback endpoints.
scripts/seed-emulators.mjs creates a disposable verified local account:
suryansh@gmail.com / local-dev-password. It has no production identity or
project IAM grant. Emulator owner tokens are local test fixtures.

The existing operator's Firebase CLI and gcloud sessions were used for initial
provisioning and the first deployment. GitHub CLI used the existing repository
administrator authorization to push the source. Their credentials remain in
the local tools' stores; none were added to this repo or GitHub Actions secrets.

## Linux workers: access not yet configured

The authentication foundation is described in [Worker machine
authentication](worker-machine-auth.md). It provides separate machine bearer
credentials, hash-only control-plane verifiers, expiration/revocation, and a
gated VM deployment workflow. Its lease authorization helper must be integrated
with the future scheduler's transactional storage operations. No worker gateway
or execution service is deployed by the existing Firebase Hosting workflow.

No Linux worker service account, GitHub worker credential, repository-writing
grant, or OpenAI inference credential has been provisioned by this setup.
The future service needs a separate identity and an explicit grant design for
approved snapshots, execution events, attempt leases, artifacts, and repository
access. A normal room membership must never become a worker identity.

## Inspect and change access

Inspect current bindings locally:

~~~sh
gcloud projects get-iam-policy coco-3471c
gcloud iam service-accounts get-iam-policy \
  github-deploy@coco-3471c.iam.gserviceaccount.com --project coco-3471c
gcloud iam workload-identity-pools providers describe github \
  --workload-identity-pool=coco-github --location=global --project=coco-3471c
gcloud iam roles describe roles/firebase.viewer
~~~

To stop CI impersonation, disable the github workload identity provider or remove
its service-account workloadIdentityUser binding. Existing short-lived
credentials can remain valid until they expire. Remove the deployer's project
roles when retiring the integration. Review rules and IAM changes independently
from application org membership, and update this inventory when grants change.

Authorization regression coverage:
[Firestore emulator tests](../tests/firestore.rules.test.ts) and
[Google identity integration tests](../tests/auth.emulator.test.ts).
`npm run test:rules` starts both Auth and Firestore emulators and runs these suites
serially because they reset the disposable demo-coco project.
