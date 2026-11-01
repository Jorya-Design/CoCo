#!/usr/bin/env bash
set -euo pipefail
# Executor code may reach public package registries, but cannot reach metadata,
# private network services, other containers, or host services other than inference.
for range in 169.254.0.0/16 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16; do
  iptables -C DOCKER-USER -i br-cocoexec -d "$range" -j DROP 2>/dev/null || iptables -I DOCKER-USER -i br-cocoexec -d "$range" -j DROP
done
iptables -C INPUT -i br-cocoexec -p tcp --dport 8790 -j ACCEPT 2>/dev/null || iptables -I INPUT -i br-cocoexec -p tcp --dport 8790 -j ACCEPT
iptables -C INPUT -i br-cocoexec -j DROP 2>/dev/null || iptables -A INPUT -i br-cocoexec -j DROP
