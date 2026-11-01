#!/usr/bin/env bash
set -euo pipefail
umask 077
release_id=${1:?release SHA required}
[[ $release_id =~ ^[a-f0-9]{40}$ ]] || exit 1
release_dir="/opt/coco/install-$release_id"
install -d -m 0755 -o root -g root /opt/coco
cd "$release_dir"
bash deploy/bootstrap.sh
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==24||minor<12) process.exit(1)' || { echo 'Install Node.js >=24.12.0 <25 before deploying'; exit 1; }
for service_user in coco-plane coco-worker; do
  id "$service_user" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$service_user"
done
usermod -aG docker coco-worker
install -d -m 0700 -o coco-worker -g coco-worker /var/lib/coco-worker
install -d -m 0750 -o root -g coco-plane /etc/coco/control-plane
install -d -m 0750 -o root -g coco-worker /etc/coco/worker
# Credentials are deployed to separate service identities, outside source/worktrees.
install -m 0640 -o root -g coco-plane .coco/credentials/worker-registry.json /etc/coco/control-plane/workers.json.new
install -m 0640 -o root -g coco-worker .coco/credentials/worker-token /etc/coco/worker/token.new
execute=false
if [[ -s .coco/credentials/openai-key ]]; then
  install -m 0640 -o root -g coco-plane .coco/credentials/openai-key /etc/coco/control-plane/openai-key.new
  execute=true
fi
rm -rf -- "$release_dir/.coco"
# Remove all raw credentials before allowing the service user to install dependencies.
chown -R coco-plane:coco-plane "$release_dir"
runuser -u coco-plane -- npm ci --ignore-scripts
chown -R root:root "$release_dir"
chmod -R a+rX "$release_dir"
if [[ $execute == true ]]; then
  docker build --file deploy/Dockerfile.executor --tag "coco-executor:$release_id" .
  mv /etc/coco/control-plane/openai-key.new /etc/coco/control-plane/openai-key
fi
printf 'COCO_EXECUTION_ENABLED=%s\nCOCO_REPOSITORY_SHA=%s\nCOCO_EXECUTOR_IMAGE=coco-executor:%s\n' "$execute" "$release_id" "$release_id" > /etc/coco/runtime.env
chmod 0600 /etc/coco/runtime.env
mv /etc/coco/control-plane/workers.json.new /etc/coco/control-plane/workers.json
mv /etc/coco/worker/token.new /etc/coco/worker/token
ln -sfn "$release_dir" /opt/coco/current
install -m 0644 deploy/coco-control-plane.service /etc/systemd/system/
install -m 0644 deploy/coco-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable coco-control-plane coco-worker
systemctl restart coco-control-plane coco-worker
ready=false
for attempt in {1..60}; do
  if systemctl is-active --quiet coco-control-plane coco-worker && curl --fail --silent http://127.0.0.1:8787/healthz >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done
[[ $ready == true ]] || { echo 'Control plane did not become healthy'; exit 1; }
runuser -u coco-worker -- node scripts/check-worker-runtime.mjs
echo 'CoCo Linux worker services deployed'
