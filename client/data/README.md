# IOU Data Model

Runtime user data is persisted in IndexedDB. Seed person fixtures used for tests live under `tests/people/`.

## Conventions
- `debt_eur` is from the perspective of the file owner.
  - Positive means the other person owes the owner.
  - Negative means the owner owes the other person.
- `trust_credit_limit_eur` is the maximum trusted credit the owner extends to that person.
- `recent_transactions` (optional) is an array of the most recent transactions between the owner and the connected person.

## Logs
`client/data/logs.json` can store seed log fixtures. Runtime logs are persisted in IndexedDB. Each log entry includes:
- `id`
- `transaction_id`
- `timestamp` (ISO)
- `text` (single-line summary)
- `message` (optional detail)

## Example fields
- `id`: stable identifier for the person.
- `name`: display name.
- `connections`: array of connected people and the current debt/credit limits between them.
