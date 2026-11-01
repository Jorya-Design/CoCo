#!/usr/bin/env bash
set -euo pipefail

# One-time bootstrap by a project administrator. Credentials remain in gcloud.
# GitHub receives a short-lived identity restricted to this repository and main.
deploy_project=coco-3471c
deploy_number=375045542679
deploy_account=github-deploy@coco-3471c.iam.gserviceaccount.com
deploy_pool=coco-github
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$deploy_project" --quiet

if ! gcloud iam service-accounts describe "$deploy_account" --project="$deploy_project" >/dev/null 2>&1; then
  gcloud iam service-accounts create github-deploy --display-name="CoCo GitHub deploy" --project="$deploy_project" --quiet
fi
if ! gcloud iam workload-identity-pools describe "$deploy_pool" --location=global --project="$deploy_project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$deploy_pool" --location=global --display-name="CoCo GitHub Actions" --project="$deploy_project" --quiet
fi
if ! gcloud iam workload-identity-pools providers describe github --workload-identity-pool="$deploy_pool" --location=global --project="$deploy_project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc github \
    --workload-identity-pool="$deploy_pool" --location=global --project="$deploy_project" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
    --attribute-condition="assertion.repository_id == '1441783030' && assertion.repository_owner_id == '93083413' && assertion.ref == 'refs/heads/main'" --quiet
fi
gcloud iam service-accounts add-iam-policy-binding "$deploy_account" \
  --project="$deploy_project" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$deploy_number/locations/global/workloadIdentityPools/$deploy_pool/attribute.repository_id/1441783030" --quiet >/dev/null

for deploy_role in roles/firebasehosting.admin roles/firebaserules.admin roles/datastore.indexAdmin roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$deploy_project" --member="serviceAccount:$deploy_account" --role="$deploy_role" --quiet >/dev/null
done
echo "GitHub's main-branch deployment identity is configured."
