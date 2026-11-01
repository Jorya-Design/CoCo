param([string]$Gcloud = 'gcloud')
$ErrorActionPreference = 'Stop'
$project = 'coco-3471c'
$vm = 'coco-execution-1'
$zone = 'europe-west2-b'
$deployer = 'github-runtime-deploy@coco-3471c.iam.gserviceaccount.com'
$runtime = 'coco-control-plane@coco-3471c.iam.gserviceaccount.com'
function Invoke-Cloud {
  & $Gcloud @args --quiet --format=none
  if ($LASTEXITCODE -ne 0) { throw "Google Cloud command failed: $($args[0..2] -join ' ')" }
}
Invoke-Cloud services enable iap.googleapis.com oslogin.googleapis.com iamcredentials.googleapis.com --project=$project
$accounts = & $Gcloud iam service-accounts list --project=$project --format='value(email)'
if ($accounts -notcontains $deployer) { Invoke-Cloud iam service-accounts create github-runtime-deploy --display-name='CoCo runtime deployment' --project=$project }
if ($accounts -notcontains $runtime) { Invoke-Cloud iam service-accounts create coco-control-plane --display-name='CoCo trusted control plane' --project=$project }
# Existing WIF provider already pins repository ID 1441783030, owner ID 93083413,
# and refs/heads/main. This service account cannot be impersonated by a PR job.
Invoke-Cloud iam service-accounts add-iam-policy-binding $deployer --role=roles/iam.workloadIdentityUser --member='principalSet://iam.googleapis.com/projects/375045542679/locations/global/workloadIdentityPools/coco-github/attribute.repository_id/1441783030' --project=$project
Invoke-Cloud projects add-iam-policy-binding $project --member="serviceAccount:$deployer" --role=roles/compute.viewer --condition=None
Invoke-Cloud compute instances add-iam-policy-binding $vm --zone=$zone --project=$project --member="serviceAccount:$deployer" --role=roles/compute.osAdminLogin
Invoke-Cloud projects add-iam-policy-binding $project --member="serviceAccount:$deployer" --role=roles/iap.tunnelResourceAccessor "--condition=expression=destination.ip == '10.154.0.2' && destination.port == 22,title=coco_execution_ssh"
Invoke-Cloud iam service-accounts add-iam-policy-binding $runtime --member="serviceAccount:$deployer" --role=roles/iam.serviceAccountUser --project=$project
# Only the trusted control plane uses this VM identity. No service-account keys.
Invoke-Cloud projects add-iam-policy-binding $project --member="serviceAccount:$runtime" --role=roles/datastore.user --condition=None
$rules = & $Gcloud compute firewall-rules list --project=$project --format='value(name)'
if ($rules -notcontains 'coco-iap-ssh') {
  Invoke-Cloud compute firewall-rules create coco-iap-ssh --project=$project --network=default --direction=INGRESS --priority=900 --allow=tcp:22 --source-ranges=35.235.240.0/20 --target-tags=coco-runtime-host
}
if ($rules -notcontains 'coco-deny-direct-ssh') {
  Invoke-Cloud compute firewall-rules create coco-deny-direct-ssh --project=$project --network=default --direction=INGRESS --priority=1000 --action=DENY --rules=tcp:22 --source-ranges=0.0.0.0/0 --target-tags=coco-runtime-host
}
Invoke-Cloud compute instances add-tags $vm --zone=$zone --project=$project --tags=coco-runtime-host
$attached = & $Gcloud compute instances describe $vm --zone=$zone --project=$project --format='value(serviceAccounts.email)'
if ($attached -ne $runtime) {
  Invoke-Cloud compute instances stop $vm --zone=$zone --project=$project
  Invoke-Cloud compute instances set-service-account $vm --zone=$zone --project=$project --service-account=$runtime --scopes=cloud-platform
  Invoke-Cloud compute instances start $vm --zone=$zone --project=$project
}
Write-Output 'CoCo runtime identity, GitHub deployment access, and IAP-only SSH configured.'
