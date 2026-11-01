# Auth, identities, and access grants

Inventory verified on 1 November 2026 against project IAM, the workload identity
provider, its service-account policy, and the Firebase Authentication console.

Project: coco-3471c (375045542679). Production:
https://coco-3471c.web.app. Firestore: (default), europe-west2.

## Application authentication

Production uses Firebase Authentication email/password accounts with email
verification, password reset, and Firebase-managed client sessions.

1. A user registers or signs in using the Firebase web SDK.
2. A new account receives a verification link. The app shows the verification
   screen until the account's email is verified.
3. On confirmation, the app reloads the user and refreshes the ID token.
4. Firestore rules require an authenticated token with email_verified=true.
5. Room access requires the token's email to appear in that room's memberEmails.

Registration is self-service. A verified account can create its own room.
Creating an account grants no access to another team's rooms.
Google sign-in is currently disabled: the requested public support email is
joryatm@gmail.com, and it is not offered as a support contact for the current
console login. Add that provider after the support contact is configured.

The public Firebase SDK configuration is loaded from Hosting's
/__/firebase/init.json endpoint. Its API key identifies the app; Firestore rules
enforce access. No Google administrative credentials or OpenAI inference keys
are sent to the browser.

Implementation: [Firebase initialization](../apps/web/src/lib/firebase.ts),
[sign-in and verification screens](../apps/web/src/App.tsx),
[Firestore rules](../firestore.rules).

## Application user grants

Room access is based on ownerUid and memberEmails. There is no global app-admin
role or custom-claims role system in this release.

| Principal | Grants |
| --- | --- |
| Signed-out visitor | Load the public app shell; no room data access. |
| Unverified account | Verify email, reset password, sign out; no room data access. |
| Verified nonmember | Create a private room; query rooms containing their own email. No access to other rooms. |
| Room collaborator | Read room metadata, Yjs updates, chat, presence, approvals, and run records; append authored CRDT updates and chat; maintain their own presence; create an immutable approval. |
| Room owner | All collaborator grants; update the room title and member email list, retaining their own membership. |
| Browser user, including a room owner | No execution-record writes. No mutation/deletion of saved CRDT updates, chat messages, or approvals. |

An owner shares a room by adding a teammate's email. The teammate signs in and
verifies that address; the room appears in their list. Sharing sends no email.
The UI adds members. Removing membership currently uses an owner-authorized
Firestore update or an administrator's console tools.

Room deletion is not exposed or granted. User profile display names are labels;
the rules check authorUid against the authenticated UID.

### Firestore path policy

| Path under rooms/{roomId} | Read | Write |
| --- | --- | --- |
| Room document | Verified members | Verified creator creates a room for themselves; owner updates title/membership only. |
| updates/{id} | Verified members | Member creates an authored binary update up to 256 KiB. Immutable afterward. getAfter permits atomic room + seed creation. |
| messages/{id} | Verified members | Member appends a message up to 8,000 characters under their UID. Immutable afterward. |
| presence/{sessionId} | Verified members | Member creates/updates/deletes their own presence; another UID cannot take over that record. |
| approvals/{id} | Verified members | Member creates an immutable approved snapshot: plan up to 200,000 characters and 1–100 tasks. |
| runs/{id} | Verified members | Browser writes denied. Reserved for the future trusted control plane. |
| All other paths | Denied | Denied |

Create timestamps must equal the server request time. Schemas reject extra
fields on append-only records. The rules do not parse Yjs or validate the
semantics of every task in an approval; the client validates the DAG, and the
future control plane must independently validate the whole execution contract.

Membership changes affect subsequent authorized requests. Previously downloaded
content and local offline copies cannot be recalled. Disabling an Auth account
prevents future sign-in/refresh; existing ID tokens are not an instant revocation
mechanism. Remove room membership when removing room access.

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
teammate@example.com / local-dev-password. It has no production identity or
project IAM grant. Emulator owner tokens are local test fixtures.

The existing operator's Firebase CLI and gcloud sessions were used for initial
provisioning and the first deployment. GitHub CLI used the existing repository
administrator authorization to push the source. Their credentials remain in
the local tools' stores; none were added to this repo or GitHub Actions secrets.

## Linux workers: access not yet configured

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
from room invitations, and update this inventory when grants change.

Authorization regression coverage:
[Firestore emulator tests](../tests/firestore.rules.test.ts).
