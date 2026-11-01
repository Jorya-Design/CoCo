#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || exit 1
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils docker.io iptables
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a===24&&b>=12?0:1)' 2>/dev/null; then
  node_stage=$(mktemp -d /tmp/coco-node.XXXXXX)
  trap 'rm -rf -- "$node_stage"' EXIT
  curl --fail --silent --show-error --location https://nodejs.org/dist/v24.12.0/node-v24.12.0-linux-x64.tar.xz -o "$node_stage/node-v24.12.0-linux-x64.tar.xz"
  curl --fail --silent --show-error --location https://nodejs.org/dist/v24.12.0/SHASUMS256.txt -o "$node_stage/SHASUMS256.txt"
  (cd "$node_stage"; grep ' node-v24.12.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum --check -)
  tar -xJf "$node_stage/node-v24.12.0-linux-x64.tar.xz" -C /usr/local --strip-components=1
fi
systemctl enable --now docker
if ! docker network inspect coco-executor >/dev/null 2>&1; then
  docker network create --driver bridge --subnet 172.30.0.0/24 --gateway 172.30.0.1 \
    --opt com.docker.network.bridge.name=br-cocoexec --opt com.docker.network.bridge.enable_icc=false coco-executor
fi
[[ $(docker network inspect --format '{{(index .IPAM.Config 0).Gateway}}' coco-executor) == 172.30.0.1 ]] || exit 1
install -m 0755 deploy/executor-firewall.sh /usr/local/sbin/coco-executor-firewall
install -m 0644 deploy/coco-executor-firewall.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now coco-executor-firewall
