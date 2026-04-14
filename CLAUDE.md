# IOU — Claude Development Guide

## Quick start

```bash
npm run dev   # starts server at http://localhost:3000 with auto-reload
```

The preview browser is always seeded as **Alice**. Open it at:

```
http://localhost:3000/?seed=alice
```

or just use the Preview tool — it opens `localhost:3000` and the seed is applied automatically on first load.

---

## Dev seed users

Three fixed identities share the same keypairs across the preview browser and
the peer helper, so they can actually connect via WebRTC when both are running.

| User  | Seed URL             | Role in testing             |
|-------|----------------------|-----------------------------|
| Alice | `?seed=alice`        | Default preview browser user |
| Bob   | `?seed=bob`          | Peer helper (second user)    |
| Carol | `?seed=carol`        | Peer helper (third user)     |

`?seed=reset` is a backward-compat alias for `?seed=alice`.

**Seeds only apply when IndexedDB is empty.** The preview browser always
starts with empty state, so `?seed=alice` on first open just works. If you
need to switch users or start fresh, navigate to `/?removeUser` first — that
clears IndexedDB so the next `?seed=<name>` can apply.

**Starting state:**
- Alice has Bob as an accepted friend and Carol as a pending incoming request
- Bob has Alice and Carol as accepted friends
- Carol has Alice as a pending outgoing request and Bob as an accepted friend

---

## Testing multi-user interactions

To test how Alice's UI reacts to something Bob does:

1. Open the preview browser at `/?seed=alice` (Alice's view)
2. Run the peer helper in a terminal to drive Bob headlessly:

```bash
npm run peer -- --user bob --action changeName --value Robert
npm run peer -- --user bob --action acceptFriend
npm run peer -- --user carol --action sendPaymentRequest --amount 25 --note "Dinner"
npm run peer -- --user bob --action cancelPaymentRequest
```

The peer helper opens a headless Chromium, seeds the user, connects to the
same dev server, performs the action, waits 2 s for delivery, then closes.

Add `--headed` to watch the peer's browser while it acts:

```bash
npm run peer -- --user bob --action changeName --value Robert --headed
```

### Available peer actions

| Action                | Required args          | What it does                              |
|-----------------------|------------------------|-------------------------------------------|
| `changeName`          | `--value <name>`       | Changes display name, triggers notification on Alice's friend page |
| `acceptFriend`        | —                      | Accepts first incoming friend request     |
| `rejectFriend`        | —                      | Rejects first incoming friend request     |
| `sendPaymentRequest`  | `--amount <n> [--note]`| Sends payment request to first friend     |
| `cancelPaymentRequest`| —                      | Cancels outgoing payment request          |

---

## E2E tests (full two-client Playwright)

These run two complete browser instances with no dev server dependency — the
harness starts its own server on port 3001.

```bash
npm run test:e2e:two-client                        # default scenario
npm run test:e2e:friend-request-online
npm run test:e2e:reload-reconnect
node tests/two-client-e2e/run.cjs --scenario turn-relay
node tests/two-client-e2e/run.cjs --scenario server-queue-delivery
```

Scenarios live in `tests/two-client-e2e/scenarios/`. To add a new scenario,
create a `.cjs` file that exports `{ name, run }` and register it in
`tests/two-client-e2e/run.cjs`.

---

## Verification workflow

After making a UI change that is visible in the browser:

1. Use the `preview_screenshot` or `preview_snapshot` tools to check the result
2. If you need a second user's action to trigger something, run the peer helper
   from Bash and then snapshot Alice's view
3. For complex multi-step flows, write an E2E scenario instead

---

## Key files

| Path | Purpose |
|------|---------|
| `client/js/dev/seed.js` | Dev seed — user identities and starting state |
| `client/js/models/data-model.js` | `createConnectionModel` — add new connection fields here |
| `client/modules/subpage/friend.js` | Friend detail page binding |
| `client/modules/subpage/friend.html` | Actionable box templates |
| `tests/peer-helper/run.cjs` | Headless second-user driver |
| `tests/two-client-e2e/fixtures/paired-friends.cjs` | Shared keypairs (Alice/Bob/Carol) |
| `tests/two-client-e2e/scenarios/` | E2E scenario modules |
