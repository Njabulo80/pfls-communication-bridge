
# PFLS Communication Bridge

**Price Flow Ladder Sequence (PFLS)**

The PFLS Communication Bridge is a communication service designed to connect the PFLS Trader dashboard with the MetaTrader 5 Expert Advisor (EA).

## Git Integration

The project is connected to GitHub through Cloudflare Workers Builds.

- **GitHub account:** Njabulo80
- **Repository:** pfls-communication-bridge
- **Deployment branch:** main
- **Cloudflare Worker:** pfls-communication-bridge-v2
- **Deployment command:** `npx wrangler deploy`

## Deployment Workflow

When changes are committed and pushed to the connected `main` branch, Cloudflare can automatically start a new build and deployment.

A GitHub connection alone does not confirm that deployment has succeeded. Each build must be checked in Cloudflare's deployment history.

## Project Components

1. PFLS Trader dashboard (PWA).
2. Cloudflare communication bridge.
3. MetaTrader 5 Expert Advisor.
4. Secure communication and heartbeat system.
5. Persistent status storage.

## Development Status

- [x] GitHub repository created.
- [x] Cloudflare Git integration connected.
- [ ] Initial build successfully verified.
- [ ] Cloudflare deployment verified.
- [ ] Persistent storage verified.
- [ ] PWA-to-Worker communication tested.
- [ ] MT5 EA communication tested.

## Important Notice

The project is under development. A successful Git integration or Worker deployment does not mean that MetaTrader 5 is connected or that automated trading is operational.

All EA functionality must be compiled and tested in MetaTrader 5 before live use.
