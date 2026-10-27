# Cloudflare Tunnel (DOC-70 §5.2, §7.2)

The Tunnel of each environment is **remote-managed**: its routes live in Cloudflare (Zero Trust → Networks → Tunnels → `rms-<env>` →
Published application routes), not in a file, and the container of `docker/compose.base.yml` starts with only the token
(`tunnel --no-autoupdate run --token-file /run/secrets/tunnel-token`; both flags are in `cloudflared` 2026.10.1). This table is the
source of truth for the routes and is changed in the same pull request as a route.

Staging (`-staging` in the host names); production drops the suffix and uses `ssh.<domain>`:

| Hostname | Service type | URL | Reaches |
| --- | --- | --- | --- |
| `api-staging.<domain>` | HTTP | `caddy:80` | the API through Caddy (`ops/caddy/Caddyfile`) |
| `monitor-staging.<domain>` | HTTP | `grafana:3000` | Grafana, not through Caddy (behind Access, DR-88) |
| `ssh-staging.<domain>` | SSH | `172.30.0.1:22` | `sshd` on the host, seen from the container through the bridge gateway; `localhost` would be the container itself |
| `files-staging.<domain>` | HTTPS | `seaweedfs:8333` | the object store's S3 gateway only: presigned `PUT` and `GET`. *Origin Server Name* `seaweedfs`; do not override the HTTP Host header (the presigned URL is signed for the files host) |

The catch-all rule is `http_status:404`. The ops routes (`/health/live`, `/metrics`) and the filer, master and volume ports of SeaweedFS
(8888, 9333, 8080) have no route.

Access applications in front of it, and the service token `deploy-ci`: DOC-70 §5.2. A second connector replica is not run (DR-83); the
external uptime probe is what pages when the Tunnel is down.
