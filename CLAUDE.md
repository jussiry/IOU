# IOU — Claude Development Guide

## Quick start

```bash
npm run dev   # starts server at http://localhost:3000 with auto-reload
```

---

## Commits and deploys

Do **not** run `git commit` or `git push` automatically after finishing a
task. When work is complete, propose a commit message and ask the user
whether to commit and push — wait for explicit confirmation before running
any git write commands.

**Exception:** if the user says "deploy" (or otherwise explicitly asks to
commit/push), that is the trigger to run `git add` + `git commit` +
`git push origin main` with a well-crafted message.

---

## Browser tools — which to use

**Preview browser (`preview_*` tools) is the only tool for testing this app's UI.**

- Use `preview_screenshot` and `preview_snapshot` to check what Alice sees
- Use `preview_click`, `preview_fill`, `preview_eval` to interact
- Do **not** use the Chrome plugin (`mcp__Claude_in_Chrome__*`) for localhost
  testing — it operates on the real browser and shares the same IndexedDB as
  the preview browser, which can corrupt Alice's seeded state

The Chrome plugin is only for cases the preview tools genuinely cannot handle
(e.g. file uploads, keyboard shortcuts). For normal UI verification it is
never needed.

---

## Dev seed users

The preview browser is always **Alice**. On first load it seeds automatically
via `?seed=alice` (no-op if a user already exists). Three fixed identities
share real keypairs so the preview browser and peer helper can connect via
WebRTC.

| User  | Seed URL      | Role                        |
|-------|---------------|-----------------------------|
| Alice | `?seed=alice` | Preview browser (main user) |
| Bob   | `?seed=bob`   | Peer helper (secondary)     |
| Carol | `?seed=carol` | Peer helper (secondary)     |

**Seeds only apply when IndexedDB is empty.** To switch users or start fresh,
navigate to `/?removeUser` first — that clears IndexedDB — then open
`/?seed=<name>`.

**Starting state:**
- Alice has Bob as an accepted friend and Carol as a pending incoming request
- Bob has Alice and Carol as accepted friends
- Carol has Alice as a pending outgoing request and Bob as an accepted friend

---

## Verification workflow

1. Make the change
2. Use `preview_screenshot` or `preview_snapshot` to verify Alice's view
3. If the change requires a second user to act first, run the peer helper from
   Bash, then snapshot Alice's view

### Page transitions

There is a **400 ms animated transition** between pages. After any navigation
click (nav buttons, Back, opening a friend row, etc.) wait at least 400 ms
before screenshotting or querying the DOM.

```js
// in preview_eval
await new Promise(r => setTimeout(r, 400));
```

`preview_snapshot` reads the DOM directly and shows the correct content even
during the animation, so prefer it over `preview_screenshot` when you only
need to check element presence or text.

---

## Testing multi-user interactions

To test how Alice's UI reacts to something Bob or Carol does, run the peer
helper from Bash. It opens a headless Chromium with isolated storage, seeds
the user, performs the action, waits for delivery, then closes — without
touching the preview browser's state.

```bash
npm run peer -- --user bob --action changeName --value Robert
npm run peer -- --user bob --action acceptFriend
npm run peer -- --user carol --action sendPaymentRequest --amount 25 --note "Dinner"
npm run peer -- --user bob --action cancelPaymentRequest
```

Add `--headed` to watch the peer's browser window while it acts.

### Available peer actions

| Action                | Required args           | What it does                                      |
|-----------------------|-------------------------|---------------------------------------------------|
| `changeName`          | `--value <name>`        | Changes display name, triggers notification on Alice's friend page |
| `acceptFriend`        | —                       | Accepts first incoming friend request             |
| `rejectFriend`        | —                       | Rejects first incoming friend request             |
| `sendPaymentRequest`  | `--amount <n> [--note]` | Sends payment request to first friend             |
| `cancelPaymentRequest`| —                       | Cancels outgoing payment request                  |

---

## E2E tests (full two-client Playwright)

These run two complete browser instances against a dedicated test server on
port 3001 — independent of the dev server and preview browser.

```bash
npm run test:e2e:friend-request-online
npm run test:e2e:reload-reconnect
node tests/two-client-e2e/run.cjs --scenario turn-relay
node tests/two-client-e2e/run.cjs --scenario server-queue-delivery
```

Scenarios live in `tests/two-client-e2e/scenarios/`. Add a `.cjs` file that
exports `{ name, run }` and register it in `tests/two-client-e2e/run.cjs`.

---

## Key files

| Path | Purpose |
|------|---------|
| `client/js/dev/seed.js` | Dev seed — user identities and starting states |
| `client/js/models/data-model.js` | `createConnectionModel` — register new connection fields here |
| `client/modules/subpage/friend.js` | Friend detail page binding |
| `client/modules/subpage/friend.html` | Actionable box templates |
| `tests/peer-helper/run.cjs` | Headless secondary-user driver |
| `tests/two-client-e2e/fixtures/paired-friends.cjs` | Shared keypairs (Alice / Bob / Carol) |
| `tests/two-client-e2e/scenarios/` | E2E scenario modules |
