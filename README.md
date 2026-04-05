# IOU - Create Your Own Money

A peer-to-peer IOU tracking app that records debts and trust connections between friends. Debts are recorded locally on users' own devices, and by setting trust limits the debts can be extended to make transactions between strangers — as long as there is a chain of trusted friends between them.

## Why

Money, in its essence, is just bookkeeping that tracks good deeds that should be paid back. IOU (I owe you) returns money to its roots by basing it on personal loans that can be extended to strangers through a trusted chain of friends. This relatively basic functionality can become the basis for a whole monetary system — returning the control, and responsibility, of money from governments and banks back to people.

## Try it out

https://iou-ui.up.railway.app

Development is on early stage, so don't use it to transact large amounts yet. Also backup your data regularly (when in active use) to avoid catastrophes.

## How it works

Users create an identity (public/private keypair), add friends by exchanging public keys (via QR code or copy-paste), and send IOUs through direct WebRTC data channels. Debts can be settled through direct repayment or automatic circular cancellation — if A owes B, B owes C, and C owes A, the system can cancel the loop.

There is no central ledger. Each client stores its own state in IndexedDB and syncs with peers when both are online. Messages that can't be delivered immediately are queued in an outbox and retried on reconnection.

## Chained transactions

Chained transactions expand trust to people we don't know directly. This works by finding a connection through trusted friends: Alice and Bob trust each other, Bob and Charlie trust each other. With a chained transaction Alice can send an IOU to Charlie that Charlie trusts, even if Alice and Charlie don't trust each other directly.

```
Alice wants to pay Charlie for a table, but they don't know each other.
Bob is friends with both.

Before:
  Alice ──trust── Bob ──trust── Charlie

Transaction (Alice pays Charlie 50 EUR):
  Alice ──IOU 50──> Bob ──IOU 50──> Charlie

After:
  Alice owes Bob 50       (Alice gave her IOU to Bob)
  Bob owes Charlie 50     (Bob gave his IOU to Charlie)
  Bob's net balance: 0    (received 50 from Alice, gave 50 to Charlie)
  Charlie got paid        (holds Bob's trusted IOU worth 50)

Longer chains work the same way:
  Alice ──> Bob ──> Carol ──> Dave ──> Charlie
  Each link passes an IOU of equal value to the next.
```

## Current Features

- Send and receive IOUs between friends
- QR code generation and scanning for adding friends and receiving payments
- Trust limits between friends (credit agreements)
- Real-time peer status (online/offline indicators)
- Transaction history and activity logs
- Works on mobile browsers

## TODO

- Chained transactions have not yet been implemented.
- Multiple servers that clients can connect to (to keep decentralized)
- Different currencies (beside euros). Could be anything that users want to transact with.
- "Market place": personal exchange rates for transferring one currency to another.
- Fees on chained transactions (see /plan/idea.md for explanation).

## Architecture

```
Browser A  <──WebRTC DataChannel──>  Browser B
    \                                    /
     \──WebSocket──> Server <──WebSocket/
```

- **Client**: Vanilla JS SPA with no build step (for now).
- **Server**: Node.js HTTP server that serves static files and runs a WebSocket signaling server. No database, no user data storage.
- **Signaling**: WebSocket server routes offer/answer/ICE messages between peers and tracks online presence.
- **Transport**: WebRTC data channels carry JSON messages (friend requests, IOUs, trust limit negotiations, receipts).
- **Identity**: Nostr-compatible keys (npub/nsec). Users can import existing Nostr private keys.
- **Storage**: IndexedDB on each client. All long term data is stored on clients. Single root state object.

## WebRTC and signaling

The server assigns no roles — it only forwards messages between clients who have declared each other as peer candidates. When a client connects:

1. Client registers its user ID via WebSocket
2. Client sends its list of friend public keys (peer candidates)
3. Server checks if any candidates are online and sends `peer_connect` to both sides
4. Clients negotiate a WebRTC connection using the "perfect negotiation" pattern
5. Once the data channel opens, all app messages flow peer-to-peer

When a client disconnects, the server notifies its eligible peers immediately so they can clean up stale connections.

ICE servers: STUN for direct connections, TURN over TCP as fallback (hosted on Railway via coturn).

## Getting started

### Development

```bash
npm install
npm run dev
```

This starts the server on `http://localhost:3000` with auto-reload via nodemon.

### Production

```bash
npm start
```

Or with Docker:

```bash
docker build -t iou .
docker run -p 8080:8080 iou
```

## Tests

```bash
npm run test:e2e:two-client
npm run test:e2e:friend-request-online
npm run test:e2e:reload-reconnect
```

Tests use Playwright to run two browser instances that connect to a local server and exercise friend requests, messaging, and reconnection scenarios.
