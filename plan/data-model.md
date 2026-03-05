# Client data model (IndexedDB)

Runtime state is stored in IndexedDB (`iou_client_db`, object store `app_state`, key `root_state`).

## Root state

```json
{
  "model_version": 1,
  "user": { "...": "PersonModel" },
  "contacts": { "<npub>": { "...": "PersonModel" } },
  "logs": [{ "...": "LogEntryModel" }]
}
```

## PersonModel

```json
{
  "id": "npub1...",
  "name": "Alice",
  "public_key": "npub1...",
  "public_key_hex": "<64-char hex>",
  "private_key": "nsec1...",
  "private_key_hex": "<64-char hex>",
  "connections": [{ "...": "ConnectionModel" }]
}
```

`id` uses the same `npub` format as Nostr and is the canonical user ID.

## ConnectionModel

```json
{
  "person_id": "npub1...",
  "person_name": "Bob",
  "debt_eur": 0,
  "trust_credit_limit_eur": 0,
  "recent_transactions": [{ "...": "TransactionModel" }]
}
```

## TransactionModel

```json
{
  "id": "tx_...",
  "date": "YYYY-MM-DD",
  "amount_eur": 0,
  "note": "string"
}
```

## LogEntryModel

```json
{
  "id": "log_...",
  "transaction_id": "tx_...",
  "timestamp": "ISO-8601",
  "text": "summary",
  "message": "optional detail",
  "friend_id": "npub1...",
  "amount_eur": 0
}
```
