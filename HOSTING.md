# Hosting WebDash

The project now supports a hosted Node.js server without changing the browser code.

## Start command

```sh
npm start
```

The server uses these environment variables:

- `PORT` - HTTP port supplied by the hosting provider. Defaults to `8080`.
- `HOST` - bind address. Defaults to `0.0.0.0`, which is required by most hosted/container platforms.

Health checks can use either:

- `/healthz`
- `/api/ping`

## Architecture

Host the entire `webdash` directory as one Node service. The Node process serves both the static game and `/api/*`, so the existing relative `fetch('api/...')` calls continue to work without CORS configuration.

Do not split the static site and API onto different domains unless you also change the browser API base URL and add CORS handling.

## Persistent storage

The helper writes downloaded/cached content into:

- `cache/`
- `levels/`
- `songs/`

On hosts with an ephemeral filesystem, those files disappear when the instance restarts. The game will still function, but cached levels/songs will be downloaded again. Attach a persistent volume if you want the cache to survive restarts.

## Official music caveat

`/gdres/*` serves official Geometry Dash music from a `Resources` directory adjacent to this project. A cloud server normally will not have your Steam Geometry Dash `Resources` folder, so those tracks will not be available there unless you provide files you are permitted to host. The included local asset fallback still works for assets already present in `assets/`.

## Reverse proxy / HTTPS

Most managed hosts terminate HTTPS in front of this Node process automatically. On a VPS, place Caddy or nginx in front of the app and proxy to the local Node port rather than exposing Node directly on ports 80/443.

## Example platform settings

- Runtime: Node.js 18 or newer
- Build command: none (or `npm install`)
- Start command: `npm start`
- Health check path: `/healthz`

The service must allow outbound HTTPS because the proxy contacts `www.boomlings.com` and song/content hosts.
