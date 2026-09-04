# TIP-007: Chained Transactions

| Field  | Value |
|--------|-------|
| Number | TIP-007 |
| Title  | Chained Transactions |
| Status | Draft (very early — signature design only) |
| Author | Jussi Rytkönen |
| Created | 2026-09-02 |

---

## Summary

A chained transaction lets Alice pay Charlie when they are not friends, by passing IOUs along a path of mutual friends: Alice→Bob→Charlie. Each hop is an ordinary IOU between friends; the chain as a whole must be **all-or-nothing**, so that no intermediary ever ends up having paid out without being paid in.

This draft defines the **commit mechanism**: a single multi-party record that is valid only once every participant has signed it, plus the signed `cancel` that lets a not-yet-signed participant kill it early, plus the in-flight reservations that stop the same credit being promised twice. **Routing is deliberately left open** — see §Phase 1.

The commit mechanism is intended to be the *same primitive* used by [TIP-002](TIP-002-circular-cancellation.md). See §Relationship to TIP-002.

---

## Motivation

Chained transactions are the feature that turns Tally from a shared debt notebook into money: without them, value only moves between people who already trust each other. They are named in `README.md` and [Purpose](../design/purpose.html) as core to the idea, and are the largest unimplemented piece of the project.

The design constraint that makes this hard is Tally's own: there is **no chain and no global ledger** (see [Related work](../design/related-work.html)). Every comparable system — Trustlines, Circles — solved multi-hop atomicity by putting the whole path in one on-chain transaction, and solved routing by publishing the trust graph. Tally has neither, by choice.

---

## Relationship to TIP-002 — one primitive, two features

A chained transaction and a circular cancellation are **structurally the same operation**:

|                         | TIP-002 circular cancellation | TIP-007 chained transaction |
|-------------------------|-------------------------------|-----------------------------|
| Shape                   | A cycle (last hop closes back to the first) | A path (distinct payer and payee ends) |
| Effect on each edge     | Reduces existing debt          | Creates new debt            |
| Needs unanimous signing | Yes                            | Yes                         |
| Needs a canonical record every participant appends | Yes | Yes |
| Every hop is between direct friends | Yes               | Yes                         |

They differ in one respect that matters enormously for safety:

> **Cancellation can only ever make you better off; a chained transaction can make you worse off.**

TIP-002 gets away with a signing pass that has no id, no deadline and no reservation, because its final guard (`cancel_amount ≤ current_debt`) is self-limiting: a stale cancellation revealed months later either still applies harmlessly or fails the guard. A stale *chained transaction* revealed months later **increases** the debt you owe, at a moment you did not choose. Everything in §Deadlines below exists because of that asymmetry.

**Recommendation:** build a shared `multi_party_record` primitive — canonical digest, signature set, deadline, reservation, signed cancel, ledger sharing rules — and express both TIPs on top of it, rather than writing two bespoke signing flows. If TIP-002 lands first with its own ad-hoc flow, it should be rebased onto the primitive when this TIP is implemented.

*Open:* whether the primitive is generic over "cycle" and "path", or whether a cycle is simply a path whose last hop points back at the first (which would make it one shape with one validation rule).

---

## Key structural properties

**1. Every hop is between direct friends.** As in TIP-002, no message ever has to be routed through a non-friend: each edge of the path is an existing friendship with an existing peer connection. The protocol runs on the existing signed envelope infrastructure.

**2. Only the completed chain is a ledger entry.** Route discovery and proposal traffic are ephemeral (like `sync_hello`); only the fully-signed record is durable.

**3. There is no double-spend to resolve, so no consensus is needed — only evidence.** Either the complete signature set exists or it does not, and it is self-verifying: anyone holding it can prove validity to anyone else. Unlike a blockchain, there is never a choice between two conflicting histories. This reduces "did it commit?" from a coordination problem to a **delivery** problem — which is why §Deadlines, not consensus, is the hard part.

**4. Intermediaries end net-neutral.** Bob receives an IOU from Alice and issues one to Charlie of equal value (modulo fees), so his net balance is unchanged. What he spends is *credit*, not money.

---

## The record

```
ChainedTransaction {
  id:        "ctx_…"          // unique; part of the signed digest
  legs: [                      // ordered, payer → payee
    { from: A, to: B, amount: 50.10 },
    { from: B, to: C, amount: 50.05 },
    { from: C, to: D, amount: 50.00 },
  ]
  deadline:  <timestamp>       // after which no signature may be added
  note?:     <string>          // visible to endpoints; see §Privacy
}
```

Participants = every pubkey appearing in any leg. Each participant signs the canonical digest of the whole object (`js/crypto/canonical.js`), exactly as TIP-002 signs `{chain, cancel_amount}`.

The record is **valid if and only if** every participant's signature is present and verifies. There is no partial state: an incomplete signature set is not a transaction, it is a proposal.

On commit, each participant appends the *identical* record to their ledger and derives their own effect from their position: a participant appearing as `to` in leg *i* and `from` in leg *i+1* applies both.

*Open:* whether amounts decrease along the path (fees to intermediaries, as in the original idea notes) in v1, or whether every leg is equal for now and fees come later. Fees complicate the digest slightly and help decorrelate amounts (§Privacy), but need a policy for who sets them.

---

## Phase 1 — Routing (open)

**Deliberately unspecified in this draft.** Tally has no global graph and does not want one, so a route must be discovered by asking friends — which is the genuinely unsolved half of this feature.

Sketch of the option space, to be worked out in a later revision or a separate TIP:

- **Probing / flooding**, in the shape of TIP-002's `loop_search`: ask friends "can you reach D for 50?", forwarded with a hop limit and a de-duplicating `search_id`. Reuses machinery TIP-002 already needs.
- **Recipient-side advertisement**: D tells its friends it wants to be reachable; the two searches meet in the middle.
- **Cached neighbourhood knowledge**: each node keeps a partial view of the graph two or three hops out, refreshed on sync.
- **Manual routing**: the user picks a mutual friend themselves. Ugly, but a valid v0 and useful for testing the commit path in isolation.

Open sub-questions: what "optimal" means (fewest hops / greatest bottleneck capacity / lowest fee / **most debt-reducing** — a route that cancels existing debt rather than creating new debt increases network capacity and should probably be preferred); whether to probe only WebRTC-connected peers; how much a probe leaks.

**The commit design below does not depend on how the route is found**, which is why it can be specified first.

---

## Phase 2 — Signature collection

Once a route exists, one participant (normally the payer) becomes the **assembler**: it builds the record, signs it, and circulates it for signatures.

### Message: `ctx_propose` (ephemeral)

Carries the unsigned record plus the signatures gathered so far. Not written to the ledger.

### What each participant verifies before signing

1. The record is well-formed and `deadline` is in the future by a sane margin.
2. Their own legs are consistent: the amount they receive ≥ the amount they send (they are not being asked to subsidise the chain).
3. Their **outgoing** leg fits within the credit their next-hop friend extends them, *after* existing in-flight reservations (§Reservations).
4. Their **incoming** leg is within their own trust limit for the previous hop — i.e. they are willing to be owed this much more by that friend.
5. The path does not visit them twice (see §Validation).
6. They have not already signed or cancelled this `id`.

If all pass, the participant signs, **reserves** (§Reservations), and forwards.

### Collection topology (open)

- **Sequential along the path** — as TIP-002 does. Simple, matches the friend-to-friend connectivity, and each hop only ever talks to its neighbours (best for a future private variant). Slowest, and one offline hop stalls everything.
- **Hub-and-spoke via the assembler** — the assembler contacts everyone. Faster and easier to reason about, but the assembler must be able to *reach* every participant, and they are not all its friends. Would need relay-mediated delivery to strangers, which the current envelope model does not do.
- **Hybrid** — sequential by default, with the assembler re-driving a stalled hop.

Sequential is the natural fit for v1 given the friends-only connectivity, but this is genuinely open.

---

## Phase 3 — Commit

Whoever adds the final signature holds a complete, self-verifying record. They broadcast it to every participant they can reach; each recipient re-broadcasts to *its* neighbours in the chain. Because the record proves itself, any participant can convince any other — there is no privileged announcer.

*Open:* whether commit is also acknowledged (a receipt per participant), so the assembler can tell the user "everyone has it" rather than "it committed". Probably yes for UX, but the record is valid regardless.

---

## Cancel

A participant that has **not yet signed** may refuse, and should say so explicitly rather than letting the proposal evaporate:

```
ChainedTransactionCancel {
  id:       "ctx_…"       // the proposal being cancelled
  by:       <pubkey>
  reason?:  "declined" | "insufficient_capacity" | "expired" | …
  signature
}
```

A valid signed cancel from any participant **voids the id permanently** for everyone who sees it: no signature may be added afterwards, and every recipient releases its reservation immediately instead of waiting out the deadline. It propagates the same way the proposal did.

Rules:

- Anyone in `legs` may cancel **before they have signed**.
- A cancel is itself evidence, and is self-verifying like the commit record.
- Cancel and commit are mutually exclusive; a participant that has seen both must treat *the one that is provably complete* as authoritative — see §Deadlines for why this is not fully symmetrical.

**Open — can a participant cancel *after* signing?** Arguments both ways:

- **No (recommended for v1).** A signature is a commitment; allowing retraction destroys atomicity, because "everyone has signed" would stop meaning "it will commit". The escape hatch is the deadline.
- **Yes, until the set is complete.** More forgiving in a network where a chain can sit half-signed for hours. But then two participants can race — one completing, one retracting — and you are back to needing a tie-break rule, which is exactly the consensus problem property 3 says we do not have.
- **Middle ground:** post-signing retraction is not a protocol operation but a *social* one — you ask the assembler to cancel before it completes. Costs nothing to implement.

*Open:* whether a cancel should be a ledger entry or ephemeral. Ephemeral is cheaper and matches TIP-002's treatment of failed flows; durable makes "why did this fail?" answerable later and gives evidence against a peer who cancels constantly.

---

## In-flight reservations

Without reservations, two concurrent chains through Bob can each individually fit inside his available credit and jointly exceed it. Both would be signed in good faith, and the second to commit would push him past a limit that was never agreed.

**Rule:** signing reserves the amount on both of that participant's affected edges — outgoing capacity toward the next hop, and headroom against the previous hop — until the record commits, is cancelled, or the deadline passes.

Reserved amounts are subtracted from `available_trust` everywhere it is computed (`js/utils/friendships.js`, `js/friends-helpers.js`), so a second proposal validating against the same credit correctly fails check 3 above.

Open points:

- **Reserve at propose time or sign time?** Sign time is cleaner (a reservation is the local half of a commitment). Propose time reduces wasted round-trips when a chain is doomed, but lets a hostile proposer freeze a friend's credit for free — a denial-of-service with no signature cost. **Sign time is recommended.**
- **Persisted or in-memory?** In-memory is simpler and matches TIP-002's "state evaporates" model, but a reload would drop a reservation while its signature is still outstanding, which is unsafe. Reservations probably have to be persisted alongside the outbox, and reconciled on load against the deadline.
- **UI:** reserved credit should be visible ("€50 pending in a chained payment"), otherwise available trust silently drops and looks like a bug.
- **Interaction with TIP-002:** a cancellation and a chained payment competing for the same edge must see each other's reservations, which is another argument for one shared primitive.

---

## Deadlines, and the withholding problem

This is the sharp edge of the whole design, and it is not fully solvable.

**The attack.** A participant — most naturally the assembler, or whoever adds the last signature — holds the completed record instead of broadcasting it. Your signature is out there; you do not know whether the chain committed. The holder waits, watches how your balances develop, and presents the record at the moment it hurts most, or discards it if the chain stopped being useful to them. Your signature has become a **free option** written against you.

**Why an honest network produces the same state.** A peer that is simply offline, a relay that drops an envelope, or a device that crashes mid-broadcast leaves you in the identical position: signed, unresolved, unable to distinguish malice from a partition. Any rule must therefore work for both cases.

**Why it is still relatively benign in Tally.** Every counterparty in the chain is either your friend or your friend's friend, the amount is bounded by a credit limit you chose, and there is a real person to ask. That is a genuine advantage over trustless systems — but it is a mitigation, not a fix, and it weakens as chains lengthen and as devices (rather than people) get compromised.

**The impossibility.** After the deadline, a complete-and-correctly-dated record arrives late. Either:

- you **accept it**, and the deadline bounds nothing — you can be surprised indefinitely, which is the attack above; or
- you **reject it**, and a participant who was honest but slow (or partitioned) loses value they are genuinely owed.

There is no rule that avoids both. This is the classical result that atomic commit is impossible with unreliable messaging; you can only choose who carries the risk.

**Options, none obviously right:**

1. **Strict received-by deadline.** The record must be *received* before `deadline`, not merely dated before it. Hard bound, simple to implement, and the loss lands on the slow/partitioned party. Requires deadlines generous enough that honest offline peers are not routinely burned — which widens the option window.
2. **Deadline + grace.** Accept until `deadline + Δ`. Softens honest failures; the option window is just longer. Δ is arbitrary.
3. **Assembler duty.** The assembler is named in the record and is responsible for delivery; failure to deliver is attributable, and the ledger's evidence trail makes it socially visible. Enforcement is friendship, not protocol. Fits Tally's trust model; useless against a compromised device.
4. **Revive-on-evidence.** A late record does not commit automatically, but surfaces as a claim the affected participants can accept manually ("Bob says this chain completed — accept?"). Turns a silent debt into a decision, and keeps the audit trail. More UI, but arguably the most honest option for a peer-to-peer app.
5. **Short deadlines, online-only chains for v1.** Only attempt a chain when every hop is currently WebRTC-connected, with a deadline of seconds. Massively shrinks the window and the failure surface, at the cost of chains that only work when everyone happens to be online. **Probably the right v1**, with a longer-lived variant once the mechanism is proven.

*Open:* whether the deadline is absolute (wall-clock, requiring roughly synced clocks) or relative to a signed proposal timestamp. Note the ledger already distrusts local `timestamp` and relies on the signed `originated_at` ([Ledger spec](../design/spec-ledger.html) §2) — the same reasoning applies here, and clock skew between friends is a real source of spurious expiry.

---

## Validation rules

An inbound `chained_transaction` entry is applied only if:

1. Every participant in `legs` has a present, verifying signature over the canonical digest.
2. The record was received within the accepted window (§Deadlines, option-dependent).
3. No participant appears twice in the path (a self-intersecting route would multiply that person's exposure).
4. Each leg amount is positive, and amounts are non-increasing along the path.
5. The `id` has not already been applied, and has not been cancelled.
6. For the applying node's own edges: the resulting debt does not exceed a limit it agreed to — *open:* whether this is a hard rejection (safe, but can produce a chain the rest of the network considers committed and one node does not) or a warning that still applies (consistent, but overrides the user's limit). This is the ugliest open question in the draft.

---

## Ledger integration

A chained transaction is the ledger's **first multi-party record**, and it breaks an assumption baked into the current design: entries have one `from_user_id` and one `to_user_id`, and `getLedgerEntriesForPeer` slices the ledger bilaterally, never forwarding third-party entries ([Ledger spec](../design/spec-ledger.html) §4.1).

A chained record must be held by participants who are not one of its two endpoints, so the spec needs:

- a definition of which participants receive which parts during sync,
- a rule for verifying a multi-party record that arrives from someone who is not its author,
- a decision on whether the whole record is shared with all participants (simple; leaks the route) or sliced per participant (see §Privacy).

*Open:* whether the record is stored once with a participant list, or whether each node stores a projection of it. Storing it whole is much simpler and makes the record self-verifying on replay; projections are a prerequisite for the private variant below.

---

## Partly private chained transactions (future — explicitly not v1)

In v1 every participant sees the whole record: the full route, every amount, and the identities of the endpoints. That is a real privacy regression relative to bilateral transactions, and worth improving later — but the obvious fix does not work, and it is worth writing down why.

**The tension:** onion routing (Sphinx, as used by Lightning) hides the route from the hops, but **requires the sender to already know the full route**. Lightning affords that only because it gossips the entire channel graph publicly. Tally cannot publish that graph without giving up the property that distinguishes it. Meanwhile, hop-by-hop route discovery (§Phase 1) leaks the route to participants *by construction*, because they are the ones doing the discovery. **Hiding the route from participants and discovering it without a global graph pull in opposite directions**, and no design here escapes that without a global graph.

What is nonetheless available later:

- **Per-leg signing bound by a shared root.** Each participant signs only its own leg plus a binding value (the `id`, or a Merkle root over all legs) and receives an inclusion proof. Hides leg *contents* from non-adjacent participants. Does **not** hide *participation*: verifying unanimity requires knowing the signer set, which leaks path length and membership.
- **Leg-to-leg encryption of the payload.** The `note` and the endpoints' identities are encrypted to the endpoints, so intermediaries learn only their two neighbours and their amount. Cheap, and worth doing early — arguably even in v1.
- **Signature aggregation** (MuSig2 / FROST over the Schnorr keys already in use). Compresses unanimity to one signature. Elegant, but verification still requires the key set, so it buys little privacy, adds two rounds, and nonce mishandling can leak a private key. Not worth it.
- **Amount correlation** remains regardless: an identical amount along a path fingerprints it. Per-hop fees perturb this slightly; multi-part payments would perturb it more.

A reasonable target is "intermediaries learn their neighbours, their amount, and the path length — nothing else", reached by per-leg signing plus payload encryption. It is a v2 concern, and the v1 record shape should simply avoid decisions that make it impossible (notably: keep the digest structured per-leg even if everyone currently signs the whole thing).

---

## Why not HTLC / ILP for v1

Interledger and Lightning solve the same commit problem with a hash time-locked contract: the recipient picks a secret `r` and publishes `H(r)`; each hop promises conditionally ("I pay if shown `r` before T"), timeouts decrease along the path so each hop can always claim upstream after being claimed downstream, and revealing `r` unlocks every leg at once.

This machinery exists to achieve atomicity between parties who **do not trust each other and cannot settle socially**. It also needs an enforcement layer to mean anything — for Lightning that is the blockchain; for ILP it is that your peer is a business partner. A timeout by itself provides no recourse, only a rule for what the ledger concludes.

Tally's hops are friends with an explicit credit limit, so the unanimous-signature design gets the same atomicity with far less machinery and no secret management. What is worth taking from ILP is the *discipline*, and this draft takes it: an expiry inside the signed object, reservations on prepare, and an explicit reject.

HTLCs become worth revisiting if hops stop being friends-of-friends, or if a private variant needs a hop to commit without seeing who is downstream.

---

## Open questions

1. **Where does the deadline risk land** — strict received-by, grace, assembler duty, or revive-on-evidence (§Deadlines)? Everything else in the design is comparatively mechanical.
2. **Online-only chains for v1?** Requiring every hop to be WebRTC-connected shrinks the problem enormously; is the resulting feature still useful enough to ship?
3. **Can a signer retract?** (§Cancel.) Recommended no; needs a decision before implementation.
4. **Hard-reject or apply-with-warning** when an inbound chain would push a node past its own limit (§Validation rule 6)?
5. **Reservation persistence** across reload, and reconciliation on load.
6. **Shared primitive scope** — is a cycle just a path that closes, or two shapes with one signing flow (§Relationship to TIP-002)?
7. **Fees in v1 or later**, and who sets them.
8. **Maximum path length.** Longer chains find more routes and multiply every failure mode; 3 hops is probably the right ceiling to start.
9. **Multi-currency chains** — out of scope here, but the record shape should not make it impossible.

---

## Implementation notes

- New ephemeral peer message kinds: `ctx_propose`, `ctx_cancel`, `ctx_commit`.
- New ledger entry type: `chained_transaction` — the project's first multi-party record.
- New command: `createChainedTransaction(route, amount)`, alongside `createTransaction` in `js/commands/transaction.js`.
- Reservations belong next to the outbox in persisted state; `available_trust` computations must subtract them.
- Signature payload: the canonical digest of `{id, legs, deadline}` via `js/crypto/canonical.js`, signed with the existing authorship-proof machinery (`js/peer/authorship.js`) so a third-party-forwarded record verifies without change.
- Build the `multi_party_record` helpers first and port TIP-002 onto them, rather than duplicating the signing flow.
