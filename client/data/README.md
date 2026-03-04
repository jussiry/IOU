# IOU Data Model

Each person has a single JSON file under `client/data/people/`.

## Conventions
- `debt_eur` is from the perspective of the file owner.
  - Positive means the other person owes the owner.
  - Negative means the owner owes the other person.
- `trust_credit_limit_eur` is the maximum trusted credit the owner extends to that person.
- `recent_transactions` (optional) is an array of the most recent transactions between the owner and the connected person.

## Logs
`client/data/logs.json` stores a list of log entries. Each entry includes:
- `id`
- `transaction_id`
- `timestamp` (ISO)
- `text` (single-line summary)
- `message` (optional detail)

## Example fields
- `id`: stable identifier for the person.
- `name`: display name.
- `connections`: array of connected people and the current debt/credit limits between them.
