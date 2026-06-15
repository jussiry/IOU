# TIPs — Tally Improvement Proposals

A **TIP** is a design document for a non-trivial change to Tally: it captures the
motivation, the design, the trade-offs considered, and the implementation plan
for a feature before (and while) it is built. TIPs are the project's durable
design record — the place to understand *why* something works the way it does,
not just *how*.

Each TIP has a header table with a **Status** (`Draft`, `Implemented`, …), a
number, and an author. A TIP number can span more than one document when a
feature ships in phases (see the implemented/unimplemented split below).

## Implemented vs. unimplemented

Documents are organized by what has actually shipped:

- **`TIPs/`** (this folder) holds TIPs — or the **parts of a TIP** — that are
  **not yet implemented**: drafts, and the still-pending phases of a feature
  whose earlier phases have already landed.
- **`TIPs/implemented/`** holds the design records for work that **is
  implemented and verified**. Moving a doc here marks the design as done and
  preserves it as the canonical record of what was built.

### Splitting a phased TIP

When a TIP ships in layers, we **split it** rather than move the whole thing:

1. The implemented design moves to `implemented/` (Status → `Implemented`), with
   a short context banner noting which layers are done and pointing to the
   continuation.
2. A continuation doc stays in `TIPs/` covering only the **unimplemented**
   phases, with its own context banner pointing back to the implemented base.

This keeps `implemented/` an accurate record of shipped work while the root
folder always reflects what is still outstanding.