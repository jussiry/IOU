# Client data model (IndexedDB)

Runtime state is stored in IndexedDB (`iou_client_db`, object store `app_state`, key `root_state`).

## Root state

```json
{
  "model_version": 2,
  "user": { "...": "PersonModel" },
  "contacts": { "<npub>": { "...": "ContactPersonModel" } },
  "logs": [{ "...": "LogEntryModel" }],
  "outbox": [{ "...": "PeerMessageModel" }],
  "processed_peer_message_ids": ["peer_..."]
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

## ContactPersonModel

Same as `PersonModel`, except contact records do not store `private_key` or `private_key_hex`.

## ConnectionModel

```json
{
  "person_id": "npub1...",
  "person_name": "Bob",
  "friendship_status": "accepted",
  "debt_eur": 0,
  "trust_credit_limit_eur": 0,
  "recent_transactions": [{ "...": "TransactionModel" }]
}
```

`friendship_status` is one of:

- `accepted`
- `pending_outgoing`
- `pending_incoming`
- `rejected`

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

## PeerMessageModel

```json
{
  "id": "peer_...",
  "type": "friend_request",
  "from_user_id": "npub1...",
  "to_user_id": "npub1...",
  "created_at": "ISO-8601",
  "payload": { "...": "type-specific data" }
}
```

Current peer message types:

- `friend_request`
- `friend_accept`
- `friend_reject`
- `trust_limit_suggestion`
- `transaction_created`
- `received`
