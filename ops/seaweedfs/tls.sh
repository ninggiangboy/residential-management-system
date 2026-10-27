#!/usr/bin/env bash
# usage: tls.sh <env>        (as `deploy`, on the host; DOC-70 §5.5 step 2)
#
# A private CA and the certificate of the SeaweedFS S3 gateway, which names both the service (`seaweedfs`, for the API and the
# Tunnel connector) and the fixed bridge address (`172.30.0.20`, for pgBackRest on the host). The CA key is shredded: to renew,
# run it again. Never overwrites: a host that has `ca.pem` keeps it.
# `RMS_TLS_DIR` and `RMS_SECRETS_DIR` move the output for the tests.
set -euo pipefail
env="${1:?usage: tls.sh staging|production}"
tls="${RMS_TLS_DIR:-/etc/rms/tls}"
secrets="${RMS_SECRETS_DIR:-/etc/rms/secrets}"
if [ -e "$tls/ca.pem" ]; then
  echo "kept $tls/ca.pem (remove ca.pem, seaweedfs.pem and the key to renew)"
  exit 0
fi
install -d -m 0750 "$tls"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 1825 -subj "/CN=rms-$env-ca" -keyout ca.key -out ca.pem 2>/dev/null
openssl req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -subj "/CN=seaweedfs" -keyout seaweedfs.key -out seaweedfs.csr 2>/dev/null
printf 'subjectAltName=DNS:seaweedfs,IP:172.30.0.20\n' > san.ext
openssl x509 -req -in seaweedfs.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 825 -extfile san.ext -out seaweedfs.pem 2>/dev/null
install -m 0440 seaweedfs.key "$secrets/seaweedfs-tls-key"
install -m 0444 ca.pem "$tls/ca.pem"
install -m 0444 seaweedfs.pem "$tls/seaweedfs.pem"
echo "made $tls/ca.pem and $tls/seaweedfs.pem (valid until $(openssl x509 -in seaweedfs.pem -noout -enddate | cut -d= -f2))"
