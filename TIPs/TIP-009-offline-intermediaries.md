# TIP-009: Offline Intermediaries

| Field   | Value |
|---------|-------|
| Number  | TIP-009 |
| Title   | Offline Intermediaries — binding routing budgets |
| Status  | Draft |
| Author  | Jussi Rytkönen |
| Created | 2026-10-16 |
| Extends | [TIP-007](TIP-007-chained-transactions.md) |

---

## Summary

TIP-007 v1 needs every participant of a chained transaction online, because
each one signs. This TIP lets an **intermediary be offline** by signing their
consent in advance: a **routing budget** — "while I can't be reached, up to
€X may be routed from Alice onward through me". The budget is a binding
promise, separate from the informal trust limit, opt-in, consumed by use and
never self-renewing. The upstream neighbour, who is online, keeps its running
total; overspending it is provable fraud, and the intermediary's exposure can
never exceed the budget they chose.

---

## The example used throughout

**Alice** wants to pay **Carol** €20 for a lamp. They are not friends, but both
are friends with **Bob**, so the payment is routed through him:

```
Alice ──IOU €20──> Bob ──IOU €20──> Carol
payer            intermediary        payee
```

Afterwards Alice owes Bob €20 more, Bob owes Carol €20 more, and Bob is even.
The difference from TIP-007 is that **Bob is offline**: his phone is off, so
he cannot approve the payment when it happens. Alice and Carol are online.

What Bob risks is the first link: he now holds Alice's IOU, and if she never
pays it, he still owes Carol. So the question this TIP answers is how Bob can
agree in advance, and how much.

---

## Motivation

A chained transaction succeeds only if every intermediary approves it
immediately. People's phones are off, out of signal, or in a drawer; most of
the time a route of three friends will have at least one who can't answer.
Service-worker signing (push wakes the app, which signs with its local key)
covers a device that has network but a closed app. It cannot cover a device
that is unreachable, and nothing can sign there without the key. The only way
to take part while unreachable is to have agreed *beforehand*.

That is what a credit line was in RipplePay: standing consent to be routed
through. Tally cannot copy it directly, because RipplePay had a server that
knew every balance and could stop a revoked line instantly. Here there is no
such authority, which shapes everything below.

---

## Why not make the trust limit binding

The obvious design is to make the existing trust limit the promise: Bob's
limit for Alice is standing consent to be routed through up to that limit.
It fails on mistakes and on revocation:

- **A trust limit refills.** Capacity is *limit minus current debt*, so every
  time Alice's debt to Bob shrinks, the promise is available again. It has no
  end.
- **A withdrawal can't be proven received.** Bob can lower or cancel the limit,
  but if he is unreachable and Alice claims she never received the change,
  nobody can show otherwise — there is no shared clock and no authority. So
  whatever the limit says when Bob goes offline is effectively promised.
- **The damage lands on Bob, not on the person who misbehaved.** Bob ends up
  owed by Alice and owing Carol, who did nothing wrong. Unlike a direct IOU,
  where Bob was party to the deal and can refuse or renegotiate if it went bad,
  a routed IOU is a debt Bob owes for a deal he had no part in. If Alice never
  pays, Bob still owes Carol.

Combine the three and an accidental million-euro limit is a million-euro
liability that cannot be withdrawn. So the trust limit stays what it is today
— informal, governing what you approve while you are online — and the binding
promise becomes a separate, much smaller number.

---

## The routing budget

**Only used when Bob is offline.** When Bob can be reached — app open, or
woken by a push — he approves each payment live, exactly as in TIP-007, and
can approve anything up to his full trust limit with Alice. The routing budget
is consulted only when nobody can ask him. It is a second, smaller number for
the one situation where Bob cannot say no.

```
RoutingBudget {               // durable; authored by the intermediary (Bob)
  id:        "rb_…"
  from:      Bob              // who is promising
  upstream:  Alice            // whose IOUs Bob accepts while unreachable
  amount:    50.00            // ceiling on the running total; see §Withdrawing it
  replaces:  "rb_…" | null    // the grant this one supersedes
  after_use: "ru_…" | null    // the last use of the replaced grant Bob had seen
}
```

- **Per upstream friend.** Bob grants Alice €50 and another friend, Dave, €30, separately. His
  total exposure is the sum, which he can see.
- **Consumed, not a ceiling.** Each routed payment uses part of the budget;
  nothing gives it back. When it is spent, Bob must come back online and grant
  again. An ignored withdrawal can therefore gain at most the remaining budget,
  once.
- **Downstream is open.** Bob's IOU may go to any of his friends who accepts it.
  Owing them more costs Bob nothing — he holds Alice's IOU for the same amount —
  and each of them signs for themselves.
- **Also bounded by the trust limit.** A use must fit both the remaining budget
  and Bob's current headroom with Alice computed from their shared ledger.
- **Opt-in, default zero.**

### In the UI: the "offline limit"

Users should not need the term "routing budget". It appears as a second field
on the existing trust-limit page for a friend, under the trust limit itself:

> **Trust limit:** €200
>
> **Offline limit:** €20
>
> *While you're offline, others can pay through you up to this amount without
> asking you. Keep it smaller than your trust limit: you will owe it to the
> person paid even if Alice never pays you back, and a change you make while
> offline only takes effect once Alice receives it.*

- **It can never exceed the trust limit,** and the UI suggests a fraction of it.
- **It shows what is left** ("€12 of €20 left") and when it was last used, since
  it doesn't refill on its own.
- Saving the field grants a new budget; setting it to zero withdraws it.

### Withdrawing it

Bob withdraws or lowers a budget by granting a new one that names the grant it
`replaces` (`amount: 0` to withdraw). It takes effect when Alice **receives**
it. There are no dates: without a shared clock, an expiry time would be stated
by whoever uses the offer, and so could not be enforced.

**One running total per lineage.** A replacing grant does not start a fresh
budget. Uses of the old grant and the new one count against one running total,
and `amount` is a ceiling on that total. So lowering €50 to €20 when €35 is
already spent leaves nothing to spend, rather than €20 more. Without this,
Alice could spend the old grant in full and then the new one too — lowering a
budget would raise the exposure.

**The race.** Uses Alice made before she received the replacement are valid
under the old ceiling, because in her view the promise was still in force. Uses
after it must fit the new one. Alice cannot be shown to have received it late,
so the worst case is that the old ceiling applies in full — but never more than
the largest ceiling Bob ever granted. That is Bob's maximum loss, and he chose
it. `after_use` records the last use Bob had seen when he replaced the grant, so
both sides can tell which uses he knew about.

---

## Using a budget

Alice, the upstream neighbour, is the only one who can spend a budget Bob
granted her, so she is the natural one to keep its running total. Each use is a
small record Alice signs:

```
RoutingBudgetUse {            // authored by the upstream neighbour (Alice)
  id:        "ru_…"
  budget:    "rb_…"
  previous:  "ru_…" | null    // the previous use of this budget
  amount:    20.00
  spent:     35.00            // running total including this use
  chain:     "ctx_…"          // the chained transaction it backs
}
```

In the chained transaction record, Bob's leg carries this use in place of
Bob's live signature. The record is valid if every *online* participant signed
it and every offline intermediary's leg carries a use that fits its budget.

**Overspending is provable.** Uses form a single line: each names the one before
it. If Alice issues two uses naming the same `previous`, she has signed two
contradictory accounts of the same budget, and both are evidence against her.
Bob is liable only for uses that fit the budget in order. Whoever accepted an
IOU from Bob beyond that holds Alice's signed contradiction as their claim
against her — see §Open questions for whether downstream friends should be
able to limit that risk.

**Bob learns everything when he returns.** Every routed payment is a chained
record that downstream friends also hold, so Bob receives all of them by
ordinary sync, whether or not Alice delivers them, and can check the running
total himself.

---

## Who may be offline

Every leg of a chain moves risk to the person who receives the IOU: on the leg
Alice → Bob, Bob now holds Alice's IOU. That person must either sign live, or
have granted a budget **and** have the other end of that leg online, to keep the
running total. It follows that:

- **The payer is always online.** They start the chain and, per TIP-007, sign
  last.
- **No two neighbours in a chain may both be offline,** because the leg between
  them would have nobody to approve it or keep its total.
- **The payee may be offline** if the last intermediary is online and the payee
  has granted that intermediary a budget: they can be paid while away, which is
  the same promise in the other position.

A three-person chain therefore works with the middle person offline; a longer
chain works with every other person offline.

---

## Disputes

A routed payment is not one deal but a chain of IOUs, and only its two ends
made the deal. If the lamp Carol sold Alice turns out to be broken, that is
between Alice and Carol. A refund is a new chained transaction in the other
direction, with the same consent rules; no intermediary is ever obliged to
reverse anything, because none of them was party to the sale.

That is also why an intermediary's own risk must stay small and chosen: if
Alice refuses to pay Bob, Bob's IOU to Carol still stands. A routing budget
is the most Bob agrees to lose that way while he cannot be asked.

---

## Interaction with other TIPs

- **TIP-007.** Validation rule 1 (every participant signed) becomes "every
  online participant signed, and each offline one is covered by a budget use".
  Payer-signs-last is unchanged. No in-flight reservation is needed on a
  budget-backed leg: Alice is the only writer of its running total.
- **TIP-008.** Budgets and their uses are entries between Alice and Bob. Uses
  are not debt, so a checkpoint does not include them, but the debt they create
  is covered like any other. The current grant and its latest use stay live
  across a checkpoint; earlier grants and uses can then be archived.
- **Service-worker signing** (push wakes the app, which signs with its local
  key) is the better path whenever the intermediary's device has network: it
  approves each payment live, so it needs no budget. Budgets are for when that
  fails.

---

## Open questions

1. **Downstream protection.** Carol accepts Bob's IOU on the strength of
   Alice's running total, which Carol cannot check. Should each friend be able
   to set a separate cap on how much they accept through offline-backed legs?
2. **Equivocation policy.** When Alice issues two uses that conflict, which
   branch does Bob honour? Order by lowest id is deterministic; is it fair?
3. **Defaults and UI.** How small should the suggested budget be, and how
   should the cost of a broken promise be explained so it isn't granted
   carelessly?
4. **Renewal.** Should Bob's app top up a budget automatically when he comes
   back online, within a ceiling he set once?
5. **Visibility.** Should Alice see how much of Bob's budget is left, and
   should Bob be notified each time his budget is used?
6. **Fees.** If intermediaries take fees (TIP-007 open question 3), does an
   offline intermediary's fee come from the budget record?

---

## Implementation notes

1. Depends on TIP-007's chained transaction record.
2. Two new durable record types: `routing_budget` and `routing_budget_use`.
3. Validation of a budget-backed leg: the use verifies, it names its budget and
   previous use, the running total is consistent, and it fits both the budget
   and the trust-limit headroom.
4. The "offline limit" field on the trust-limit page (§In the UI).
