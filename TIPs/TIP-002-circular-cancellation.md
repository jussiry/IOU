# TIP-002: Circular Debt Cancellation

| Field  | Value |
|--------|-------|
| Number | TIP-002 |
| Title  | Circular Debt Cancellation |
| Status | Draft |
| Author | Jussi Rytkönen |
| Created | 2026-05-04 |

---

## Summary

When a cycle of debts exists in the trust network — A owes B, B owes C, C owes A — the minimum amount across all edges can be cancelled without money changing hands. This TIP defines a two-phase protocol for discovering such cycles and executing a multi-party signed cancellation transaction, while minimising the amount of debt information shared with participants outside the cycle.

---

## Motivation

Without cancellation, debts in a mutual-credit network can accumulate indefinitely even when circular cancellation opportunities exist. Manual cancellation requires all participants to coordinate out-of-band. Automated circular cancellation makes the ledger self-cleaning and reduces the cognitive overhead of tracking many small IOUs.

---

## Key Structural Properties

Before describing the protocol it is worth noting two properties that make implementation straightforward:

**1. All message paths in a cycle go between direct friends.**

In a 3-hop cycle A→B→C→A: A and B are friends (A owes B), B and C are friends (B owes C), C and A are friends (C owes A). Every hop in the search and every cancellation message travels between nodes that already have an established peer connection. No message ever needs to be routed through a non-friend. The same holds for longer cycles: each edge in the cycle is a friendship by definition.

This means the entire protocol runs on top of the existing signed peer-envelope infrastructure without any changes to routing.

**2. Loop search messages are ephemeral; only the cancellation is a ledger entry.**

Loop search and loop-found messages are transient protocol traffic — similar to `sync_hello` or `ping` — and are not written to the ledger. Only the completed cancellation is a permanent ledger entry.

**3. The protocol is non-blocking.**

Every message is fire-and-forget. No node waits for a response before continuing other work. If a signing chain stalls (a node is offline or doesn't respond), the unsigned proposal simply evaporates — there is no persistent "waiting" state to clean up. The only in-memory state across the whole protocol is the Phase 1 `search_id` cache, which expires automatically via TTL. The loop will be re-discovered on the next search cycle.

---

## Loop Length: 3-hop for v1, 4-hop as extension

**3-hop (triangle) loops:**
- The minimum case. Most common in tight-knit communities.
- Discovery requires exactly 2 forwarding hops.
- Each node talks only to its immediate neighbours in the cycle.
- Privacy leakage is bounded (see §Privacy Analysis).

**4-hop and longer:**
- Discover more cancellation opportunities in larger or sparser networks.
- Each additional hop adds one more participant who learns about the search.
- Protocol is mechanically identical — just `max_hops` increases by 1.
- Worth adding in v2 once 3-hop is stable; the code change is small.

**Recommendation**: implement with a configurable `max_hops` parameter (default 2 for 3-hop cycles). 4-hop can be enabled later by raising the limit.

---

## Phase 1: Loop Discovery

### Trigger

A node initiates a loop search when:
- It records a new tally (the new debt might complete a loop).
- It comes online and connects to a peer (background scan).

To avoid a flood of searches, a node should not re-initiate a search for the same creditor more than once per session, and should apply a short debounce after creating a new tally.

### Message: `loop_search`

Sent from a node to one of its creditors (someone they owe). This message is ephemeral — not written to either party's ledger.

```
loop_search {
  search_id:  uuid          // unique per search run, used only to deduplicate forwarding
  initiator:  A_pubkey      // who started the search
  chain:      [A, B, ...]   // ordered list of pubkeys in the chain so far
  max_hops:   number        // how many more forwards are allowed (decrements each hop)
}
```

`search_id` exists only to prevent the same search from being forwarded multiple times by the same node (e.g. if a message is delivered twice). It is scoped to Phase 1 and never appears in Phase 2 or the ledger entry.

### Discovery flow (3-hop example: A→B→C→A)

**Step 1 — A initiates:**
A owes B. A sends B a `loop_search`:
```
{ search_id: uuid, initiator: A, chain: [A], max_hops: 2 }
```

**Step 2 — B forwards:**
B receives the search. B checks:
- Is B already in `chain`? If yes, ignore.
- Has B already seen this `search_id`? If yes, ignore.
- Is `max_hops` > 0?

For each creditor C that B owes **and that is not already in `chain`**, B sends C a `loop_search`:
```
{ search_id: uuid, initiator: A, chain: [A, B], max_hops: 1 }
```

The chain membership filter happens at the sender before dispatching — no receiver needs to check whether it is in the chain.

**Step 3 — C checks for closure:**
C receives the search. C checks:
- Does C have a debt **to** the initiator A (i.e., `chain[0]`)?

If yes: loop A→B→C→A found. C sends A a `loop_found` directly (C and A are friends):
```
loop_found {
  chain: [A, B, C]   // full ordered loop; A is both start and implicit end
}
```

If no, and `max_hops` > 0: C continues forwarding to its own creditors (for 4-hop extension).

### Idempotency

Each node keeps a short-lived in-memory set of seen `search_id`s (TTL ~5 minutes). A search received with a known `search_id` is silently dropped. This is the only persistent state Phase 1 requires.

---

## Phase 2: Cancellation

When A receives `loop_found`, A becomes the coordinator. Phase 2 has two sub-phases: an unsigned amount-negotiation pass to find the cancel amount M, then a signing pass on the agreed final record.

### Phase 2a — Amount negotiation (unsigned, ephemeral)

Each participant contributes their edge amount; the running minimum propagates forward. These messages carry no IDs — they are identified solely by their `chain` content, are never stored, and evaporate if the chain stalls.

**A → B:**
```
{ chain: [A,B,C], running_min: X }   // X = A_owes_B
```

**B → C:**
B clips to its own edge: `running_min = min(X, Y)` where Y = B_owes_C.
```
{ chain: [A,B,C], running_min: min(X,Y) }
```

**C → A:**
C clips to its own edge: `M = min(running_min, Z)` where Z = C_owes_A. C returns the final amount:
```
{ chain: [A,B,C], final_amount: M }
```

### Phase 2b — Signing (permanent)

Now that M is known, all participants sign the same canonical record. A creates it and passes it around the loop for sequential signing:

**A → B → C:** each adds their signature over `{chain, cancel_amount: M}`.

C, holding all three signatures, broadcasts the completed record to A and B.

### Final cancellation record

```
LedgerEntry {
  type:    "loop_cancellation"
  payload: {
    chain:         [A, B, C]   // ordered: each node cancels their debt to the next
    cancel_amount: M
    signatures: {
      A: <sig over {chain, cancel_amount: M}>,
      B: <sig over {chain, cancel_amount: M}>,
      C: <sig over {chain, cancel_amount: M}>
    }
  }
}
```

Each participant writes this same record to their own ledger. The ledger handler applies it:
- For A: reduce A's debt to B by M.
- For B: reduce B's debt to C by M.
- For C: reduce C's debt to A by M.

Which edge to reduce is determined by each node's position in `chain`: node at index `i` reduces their debt to node at index `(i+1) % len(chain)`.

The entry is valid if and only if:
1. All signatures in `chain` are present and verify against `{chain, cancel_amount}`.
2. `cancel_amount ≤ current_debt` on this node's edge (verified before writing).

Condition 2 is the sole correctness guard for concurrent cancellations — no additional deduplication mechanism is needed.

---

## Privacy Analysis

### What each participant learns

In a 3-hop cycle A→B→C→A:

| Party | Already knew       | Learns during discovery          | Learns during cancellation |
|-------|--------------------|----------------------------------|----------------------------|
| A     | A_owes_B           | B and C are in a cycle with A    | B_owes_C, C_owes_A, M      |
| B     | A_owes_B, B_owes_C | A is searching, C is a link to A | C_owes_A, M                |
| C     | B_owes_C, C_owes_A | A and B are in the chain         | A_owes_B, M                |

### Irreducible minimum leakage

**C learning that A owes B** is unavoidable: C cannot check "do I owe the initiator?" without knowing who the initiator is.

**Each participant learning all three amounts during cancellation** is also unavoidable: every participant must verify `cancel_amount ≤ their own edge` to sign validly. The sequential minimum approach limits exposure to the minimum value, not the individual edge amounts, but bounds inference is possible.

### What non-participants never learn

- Any party not in the cycle learns nothing about the cycle or its amounts.
- The amounts of non-cycle edges (e.g. if B also owes D, D learns nothing).
- The server sees only encrypted opaque envelopes.

### Leakage comparison with 4-hop cycles

Each additional hop adds one participant who learns one more chain segment. The leakage profile scales linearly with loop length. For 3-hop it is minimal; for long chains it becomes more significant.

---

## Edge Cases

### Competing cancellations

Any two cancellations that share an edge — whether they are the same loop discovered by two different peers (e.g. [A,B,C] and [B,C,A]) or different loops that happen to share an edge (e.g. [A,B,C] and [A,B,D]) — are handled identically: whichever completes first reduces the shared edge; the second is rejected at signing time when the node on that edge detects `cancel_amount > remaining_debt` and stops forwarding. The residual debt is re-discoverable on the next search.

### Signing chain stalls

If any participant in Phase 2 is offline or unresponsive, the unsigned proposal is never completed. No node holds any persistent state waiting for it — the proposal evaporates. No rollback or cleanup is needed. The loop is re-discovered on the next search cycle.

### Partial vs full cancellation

The protocol cancels exactly `min(all edge amounts)`. The smallest debt is fully cleared; the others are reduced by the same amount. No edge goes negative.

---

## Ledger Integration

The `loop_cancellation` entry type is new but fits the existing append-only ledger. It is handled in `handlers.js` with a new case in `routeInboundEntry` / `routeOutboundEntry` that reduces `debt_eur` on the relevant connection by `cancel_amount`.

The `loop_search`, `loop_found`, and Phase 2 negotiation messages are **not** ledger entries. They are handled as transport-layer messages (similar to `sync_hello`) and hold no persistent state beyond the Phase 1 `search_id` cache.

---

## Open Questions

1. **When to initiates** a loop searches and how to deal with **WebRTC connection (actively peers) vs. server connection (partly active peers)**? WebRTC connections can be querried more performantly

2. **Re-initiation after stall.** After a signing chain evaporates, should the coordinator automatically retry after a backoff, or wait for the next new tally to trigger a fresh search?

3. **Maximum chain length in practice.** In a community of 30 people with average 5 friends each, what fraction of debts participate in 3-hop vs 4-hop cycles? Empirical data would inform whether 4-hop is worth the extra complexity.

4. **Notification UX.** Should the user see "€15 cancelled in a 3-way loop with Bob and Carol"? Silent is simpler; notification is better for trust and transparency. Probably notification for v1.

5. **Search frequency throttling.** Re-run when a new tally is created, and at most once per hour otherwise — or trigger on peer reconnect.

6. **Multi-currency loops.** A future with multiple currencies requires matching loop edges by currency before attempting cancellation.

---

## Implementation Notes

- New ephemeral peer message kinds: `loop_search`, `loop_found`, `loop_cancel_negotiate`, `loop_cancel_sign`.
- New ledger entry type: `loop_cancellation`.
- New command: `cancelLoop(chain, cancelAmount)` — analogous to `createTransaction`.
- Phase 1 state: in-memory `Set<search_id>` with TTL expiry. Not persisted to IndexedDB.
- Phase 2 state: none. All negotiation and signing messages are fire-and-forget.
- Signature payload: `{chain, cancel_amount}` — no IDs required.
