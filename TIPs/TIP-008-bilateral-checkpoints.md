# TIP-008: Bilateral Checkpoints

| Field   | Value |
|---------|-------|
| Number  | TIP-008 |
| Title   | Bilateral Checkpoints |
| Status  | Draft |
| Author  | Jussi Rytkönen |
| Created | 2026-10-14 |

---

## Summary

Two friends periodically co-sign one record — a **checkpoint** — stating the
balance between them and exactly which transactions it accounts for. Once a
checkpoint exists, the history before it is no longer needed by anyone: the
balance starts from the checkpoint, sync starts from the checkpoint, and a
recovering device is rebuilt from the checkpoint. The old entries can be
archived locally and are never sent to anyone again.

That last property is the point. Today every ledger entry must stay
*re-verifiable by others* forever, because sync recovery forwards it — which
means every signature scheme and payload format Tally has ever shipped must be
supported forever. A checkpoint bounds that: a format only has to be
verifiable until every relationship that used it has checkpointed past it.

---

## Motivation

The ledger is append-only and nothing ever leaves it. Three costs grow with it,
without limit:

1. **Format debt.** Records are verified again whenever they are forwarded
   during sync (`verifyLedgerEntryAuthorship`). So the legacy
   `tally-canonical-schnorr-v1` verifier, and every future one, can never be
   deleted while any ledger anywhere holds a record signed that way. The same
   goes for old payload shapes that state derivation must keep understanding.
2. **Sync cost.** `sync_hello` advertises *every* known entry id for the
   relationship, and recovery replays the entire bilateral history. Both grow
   with the age of the friendship, not with what changed.
3. **Exposure.** A full, signed, forwardable history of every IOU between two
   people is kept on every device of both, indefinitely.

Re-signing old records in a new format was considered and rejected: only a
record's author can re-sign it, so one unreachable friend (lost key, stopped
using Tally) blocks retiring a format for everyone; the "replace" record type
itself becomes permanent legacy; and routed payments would need every
participant to re-sign. A checkpoint needs one co-signature per friendship and
replaces *all* of that history at once.

---

## What a checkpoint says — and what it deliberately does not

A checkpoint is an agreement about **debt**, and only debt:

```
Checkpoint {
  id:          "cp_…"
  parties:     [A, B]             // sorted pubkeys; both must sign
  previous:    "cp_…" | null      // the checkpoint this one extends
  balance_eur: 42.00              // what B owes A (negative = A owes B)
  covers: {
    count:     17                 // balance-affecting entries since `previous`
    digest:    <sha256>           // over their sorted ids
  }
  created_at:  <timestamp>
}
```

`balance_eur` is the balance *after* every covered entry, so the checkpoint is
self-contained — nobody needs `previous`'s balance, or anything before it, to
read the current one.

**Trust limits are not in it.** A trust limit is an informal statement of
willingness, not an obligation: a friend who set a limit that would allow a
routed payment can still decline to sign it (TIP-007). Agreeing on a
number that binds nobody adds a negotiation without adding certainty. Each
side keeps its current trust limit as ordinary local state, and the most recent
trust-limit message in each direction is simply kept past the checkpoint (see
§What survives a checkpoint).

Nor does a checkpoint carry names, open payment requests, or anything else
that is still in motion.

---

## Agreeing on a checkpoint

The two ledgers are not guaranteed to be identical. A receiver drops an entry
it finds inapplicable (`applyInboundPeerMessage` rolls back the append), and
either side may simply not have received something yet. So the checkpoint does
not hash "the ledger"; it names an **explicit set** of balance-affecting
entries and both sides check that set against their own copy.

1. **Propose** (ephemeral, like `sync_hello`). Either side, while both are
   online, sends `checkpoint_propose` with the full record minus signatures,
   plus the covered ids. It covers every balance-affecting entry the proposer
   holds since `previous`, except ones newer than a short settling margin, so
   entries still in flight are left for the next checkpoint rather than
   causing a mismatch.
2. **Verify.** The other side recomputes from its own ledger: same `previous`,
   same covered set, and the same balance when those entries are applied to
   `previous.balance_eur`.
3. **Sign or decline.** On a match, it signs and returns the record. On a
   mismatch it declines with the ids it is missing or has extra — which is
   exactly a sync request; the next proposal then matches.
4. **Commit.** The proposer adds its signature. The fully-signed record is a
   durable ledger entry on both sides, and syncs to both users' other devices
   like any other entry.

This is the two-party case of TIP-007's multi-party record: one canonical
digest, valid if and only if every listed party's signature is present and
verifies. The two should share one implementation.

**Signing order doesn't matter.** Whoever signs last can only commit or not.
Withholding leaves the pair exactly where they were, and committing late is
harmless because the covered set is explicit: anything newer simply isn't in
it. So unlike TIP-007, nobody needs to be forced to sign last.

**When.** Automatically, not by the user: when both are online and either
enough covered entries have accumulated or enough time has passed since the
last checkpoint. A declined or failed attempt costs nothing and is retried
later.

**Balance is computed from the ledger.** Today `debt_eur` is maintained
incrementally by the message handlers. The checkpoint needs a pure function —
*balance of this relationship = checkpoint balance + Σ covered transactions* —
that both sides run identically. Writing it is a prerequisite, and it should
then become the source of `debt_eur` rather than a cross-check.

---

## What survives a checkpoint

After committing checkpoint *N*, an entry between the pair may be archived when
it is covered by *N*, or when it is settled and not balance-affecting. These
stay live:

| Kept | Why |
|------|-----|
| Checkpoint *N* | It is the new starting point. Earlier checkpoints can go. |
| Entries after *N* | Not yet covered. |
| Open payment requests (and their eventual response or cancel) | Still actionable. |
| The latest trust-limit message in each direction | Current local state; not agreed, so not checkpointed. |
| The latest `name_changed` | Current display name. |
| Pending friendship messages | Only if the friendship is not yet accepted — a checkpoint already proves it is. |

**Archiving is local.** An archived entry is never forwarded or re-verified
again; it can be kept as display history (the Logs page) or deleted. Its
signature was checked once, when it arrived, and that is all the trust it ever
needs from now on. This is where old formats stop mattering: an archived
record only needs to be *displayable*, and can be converted once to the current
display shape and left alone.

---

## Sync and recovery

- **`sync_hello`** advertises the latest checkpoint id plus the ids after it,
  instead of every id ever.
- **Behind on checkpoints.** A peer whose latest checkpoint is older is sent the
  newer checkpoint and the entries after it, not the entries the checkpoint
  replaced.
- **Recovery.** A wiped device that reconnects is sent the latest checkpoint and
  everything live after it, and rebuilds the relationship from that. This is
  shorter than today's full replay and needs no legacy verifier for anything
  older than the checkpoint.
- **Self-sync.** Checkpoints are ordinary durable entries, so the user's other
  devices receive them and can archive the same entries.

---

## Routed payments

Each hop of a routed payment (TIP-007) is an ordinary IOU between two
friends, so its effect on each pair's balance is covered by that pair's next
checkpoint like any other transaction. The multi-party payment record itself is
balance-affecting for every hop that appears in it; it becomes archivable for a
given participant once that participant has checkpointed past it with **both**
of its neighbours in the route. Until then it stays live, so it can still be
produced as evidence if a neighbour disputes the hop.

---

## Disputes and evidence

Today the evidence for a balance is the set of individually signed IOUs. After
a checkpoint it is one record signed by **both** parties — strictly stronger,
since it is an explicit agreement on the total rather than a sum the parties
must each reconstruct. A user who wants the itemised history anyway keeps their
archive; nothing about the protocol depends on it.

---

## Formats: how this fits with upcasting

Checkpoints and upcasting solve two halves of format debt:

- **Upcasting** (see the [Ledger spec](../design/spec-ledger.html)) keeps old
  shapes out of the app's own logic: a record is verified once on arrival with
  whatever verifier its version needs, then converted to the current shape.
- **Checkpoints** remove the need to *forward* old records, which is the only
  reason their original verifier must survive.

Together: a verifier or payload version can be deleted once no live,
un-checkpointed entry uses it — which is something a client can measure from
its own ledger.

---

## The one case a checkpoint cannot fix

A friend who never comes back online can never co-sign, so that relationship's
history stays live — and with it whatever formats it uses. This is bounded and
does no harm to anyone else: the client can stop *forwarding* such entries after
a long silence (the only party who could recover them is the absent friend),
and keep them only as verified-on-arrival local history. That is a policy
decision, listed below.

---

## Open questions

1. **Thresholds.** How many covered entries, or how much time, before proposing
   a checkpoint? Probably generous — checkpoints are cheap, but each one is a
   round trip and a signature request, which matters for NIP-07 signers that
   prompt the user.
2. **External signers.** With a NIP-07 extension every checkpoint signature may
   raise a prompt. Batch checkpoints with other work, or sign them only when the
   user is otherwise active?
3. **Absent friends.** After how long, if ever, does a client stop forwarding a
   silent relationship's history?
4. **Settling margin.** How old must an entry be before it is eligible for a
   checkpoint, so concurrent transactions don't cause repeated mismatches?
5. **Archive by default?** Keep archived entries for the Logs page, or delete
   them, or let the user choose?
6. **Currencies.** `balance_eur` assumes one currency. When other currencies
   arrive, the checkpoint carries one balance per currency.

---

## Implementation notes

1. A pure, shared balance function computed from the ledger, used for
   checkpoints and as the source of `debt_eur`.
2. The co-signed record primitive — shared with TIP-007, and through it with
   TIP-002.
3. `checkpoint_propose` / decline / commit messages, and checkpoint-aware
   `sync_hello`.
4. Local archiving, then the first legacy-verifier removal as proof that it
   works.
