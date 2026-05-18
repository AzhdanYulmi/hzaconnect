# Test keypair

These keys are committed *intentionally* to the repository for the dev workflow and CI. **Never use them for a production deployment** — anyone with this repo can sign valid-looking license tokens.

For your real production keys:

1. Run `pnpm --filter @hzaconnect/license-server keys:generate` (writes to `apps/license-server/keys/`).
2. Keep the private key on your license server, off any shared volume.
3. Replace the public key embedded in the casino's API deployment with the new one.

Test keys are loaded automatically when `LICENSE_PUBLIC_KEY_PEM` is unset and `NODE_ENV !== "production"`.
