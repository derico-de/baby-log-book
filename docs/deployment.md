# Deploying with Docker Compose and a reverse proxy

The app is one container and one volume. The container speaks plain HTTP on an
internal port and publishes nothing to the host; a reverse proxy you already
run — Caddy, nginx, Traefik, anything — terminates TLS and forwards to it. The
image ships no proxy configuration on purpose, so this page is that
configuration, written out for the two most common proxies.

Three facts about the app decide most of what follows:

- **`ORIGIN` is required and has to be exactly right.** Every Claim Link is an
  absolute URL built from it, and SvelteKit checks the `Origin` header of every
  POST against it. `https://log.example.com` — scheme, host, port as typed into
  the browser, no trailing slash.
- **HTTPS is not optional in practice.** The app is a PWA; service workers only
  register in a secure context, and the session cookie is `Secure` if and only
  if `ORIGIN` is `https`. Plain HTTP works only on `localhost`.
- **Live sync is a Server-Sent Events stream** at `/api/sync/live`. A proxy
  that buffers responses will hold those events forever, and clients fall back
  to polling without ever telling you. Caddy handles this by default; nginx
  needs one location block.

## The compose file

A self-hoster's `compose.yaml` — this one is complete, not a fragment of the
repo's example:

```yaml
services:
  app:
    image: ghcr.io/derico-de/baby-log-book:1
    restart: unless-stopped
    environment:
      ORIGIN: ${ORIGIN:?set ORIGIN to the public URL, e.g. https://log.example.com}
      # Safe here because both proxy configs below overwrite X-Forwarded-For
      # with the real client address. Without a proxy doing that, leave it off.
      TRUST_PROXY: '1'
    volumes:
      - data:/data
    expose:
      - '3000'

  # The proxy service — pick ONE of the two variants below.

volumes:
  data:
```

Beside it, a `.env` file:

```sh
ORIGIN=https://log.example.com
```

Pin the tag to the major (`:1`) rather than `:latest`: minor and patch updates
are safe to take unattended, a major is a decision.

## Variant A: Caddy

The short one. Caddy obtains and renews the TLS certificate itself, flushes
SSE streams without being told, and by default ignores a client-supplied
`X-Forwarded-For` and sets the real address — which is exactly what
`TRUST_PROXY=1` needs.

Add to the `services:` block:

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
```

and to `volumes:`:

```yaml
  caddy_data:
  caddy_config:
```

The whole `Caddyfile`:

```caddy
log.example.com {
	reverse_proxy app:3000
}
```

That is genuinely all: certificates, HTTP→HTTPS redirect, SSE flushing and a
correct `X-Forwarded-For` are Caddy defaults. Caddy imposes no request body
limit of its own, so the app's `BODY_SIZE_LIMIT` (2M in the image) is the only
one in play.

## Variant B: nginx

nginx in the same compose project, with certificates you provide (certbot,
acme.sh, your CA — not covered here):

```yaml
  nginx:
    image: nginx:stable
    restart: unless-stopped
    ports:
      - '80:80'
      - '443:443'
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
```

`nginx.conf`:

```nginx
server {
    listen 80;
    server_name log.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name log.example.com;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    # The image sets BODY_SIZE_LIMIT=2M; nginx's default of 1m would reject
    # sync pushes the app itself is willing to accept.
    client_max_body_size 2m;

    location / {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        # Overwrite, never append ($proxy_add_x_forwarded_for): TRUST_PROXY=1
        # believes this header, so a client-supplied value must not survive.
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The Server-Sent Events stream for live sync. Buffered, its events sit in
    # nginx until the connection dies; the client silently degrades to polling.
    location /api/sync/live {
        proxy_pass http://app:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        # Default is 60s; the stream is long-lived. EventSource reconnects on
        # its own if cut, but there is no reason to cut it every minute.
        proxy_read_timeout 1h;
    }
}
```

## A proxy that already runs on the host

If nginx or Caddy runs on the host itself (not in Docker), the container has to
publish a port for it to reach — bound to loopback, so only the proxy sees it:

```yaml
  app:
    # ...everything as above, but replace `expose` with:
    ports:
      - '127.0.0.1:8300:3000'
```

Then proxy to `http://127.0.0.1:8300` instead of `http://app:3000`; everything
else in the configs above stays the same. Host Caddy keeps its default
`trusted_proxies` behaviour, so `TRUST_PROXY=1` remains correct; for host nginx
the `$remote_addr` line already does the overwriting.

## First run

```sh
docker compose up -d
docker compose logs app
```

On an empty household the app prints a one-time setup link into the log — built
from `ORIGIN`, which is why that value had to be right before this moment. Open
it on your phone; whoever opens it becomes the first parent, and the link dies
on use. If it scrolled away unused, `docker compose restart app` prints a fresh
one.

If a claimed link lands on "refused" instead, the diagnosis is almost always
`ORIGIN`: it differs from the address in the browser's bar by a scheme, a port,
or a trailing slash.

## Updating

```sh
docker compose pull
docker compose up -d
```

Migrations are cumulative from any older version and a backup is taken
automatically before any migration runs, so unattended updaters (Watchtower and
friends) are fine within a major. Rolling back across a major is not supported.

## Day two

Backups land nightly in the volume under `/data/backups/` and restoring is a
file copy; the operator CLI runs via `docker exec` whether or not the app is
up. All three are covered in the [README](../README.md) — this page only adds
what the proxy changes, which is nothing: back up the `data` volume, and leave
the proxy out of it.
