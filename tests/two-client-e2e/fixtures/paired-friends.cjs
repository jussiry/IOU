/*
Fixture: clients who have each other as accepted friends with no outstanding
debt, pending requests, or outbox items. Used by scenarios that want to skip
the welcome + friend-pairing setup and go straight to testing post-onboarding
behavior.

All keypairs are real secp256k1 / nostr keys so peer-message encryption works
identically to a real user. They are fixed (not regenerated) so the fixture is
deterministic across runs.

These keypairs are shared with client/js/dev/seed.js so that the preview
browser (Alice) and peer-helper (Bob / Carol) can actually establish WebRTC
connections — they must use the same public keys to find each other via the
signaling server.
*/

const ALICE = {
  publicKeyNpub: "npub10c0r3r9u0qfyk5q58r5zm73cgj7p23erlmyyppq2wj26quksp45s5xf43v",
  publicKeyHex: "7e1e388cbc78124b501438e82dfa3844bc154723fec840840a7495a072d00d69",
  privateKeyNsec: "nsec1s9ervmd04ueyp7km3qphq3skaejtsuf546kw47f8yp96mz6qmmxqvpcdde",
  privateKeyHex: "8172366dafaf3240fadb8803704616ee64b87134aeaceaf927204bad8b40decc",
  name: "Alice",
};

const BOB = {
  publicKeyNpub: "npub1l7vvz68z2405e5zfz85z76ecn942vmevzevgcmapdqyd4zlqvmns7zhjhj",
  publicKeyHex: "ff98c168e2555f4cd04911e82f6b38996aa66f2c16588c6fa16808da8be066e7",
  privateKeyNsec: "nsec1rewgmu4zkssflszcz5q230sc5d349kzcrjqg44pdq8nkaudjk9lqhkjyvd",
  privateKeyHex: "1e5c8df2a2b4209fc0581500a8be18a36352d8581c808ad42d01e76ef1b2b17e",
  name: "Bob",
};

const CAROL = {
  publicKeyNpub: "npub1n9890qe5nvt4n3hp6pvdruela4xmtdjda6wqac3ayl2r627feqssxm6cvp",
  publicKeyHex: "994e5783349b1759c6e1d058d1f33fed4db5b64dee9c0ee23d27d43d2bc9c821",
  privateKeyNsec: "nsec1up74jyx7us6ad3efxqejxnx43jhq665ls65k7ku7me2c374dp9gqj28uck",
  privateKeyHex: "e07d5910dee435d6c7293033234cd58cae0d6a9f86a96f5b9ede5588faad0950",
  name: "Carol",
};

const DATA_MODEL_VERSION = 3;

const buildState = (self, peers) => ({
  model_version: DATA_MODEL_VERSION,
  user: {
    id: self.publicKeyNpub,
    name: self.name,
    public_key: self.publicKeyNpub,
    public_key_hex: self.publicKeyHex,
    private_key: self.privateKeyNsec,
    private_key_hex: self.privateKeyHex,
    connections: peers.map((peer) => ({
      person_id: peer.publicKeyNpub,
      person_name: peer.name,
      friendship_status: "accepted",
      debt_eur: 0,
      trust_credit_limit_eur: 100,
      recent_transactions: [],
      last_synced_at: "",
    })),
  },
  contacts: Object.fromEntries(
    peers.map((peer) => [
      peer.publicKeyNpub,
      { id: peer.publicKeyNpub, public_key: peer.publicKeyNpub, public_key_hex: peer.publicKeyHex, name: peer.name },
    ])
  ),
  ledger: [],
  outbox: [],
  processed_peer_message_ids: [],
});

const buildSoloState = (self) => ({
  model_version: DATA_MODEL_VERSION,
  user: {
    id: self.publicKeyNpub,
    name: self.name,
    public_key: self.publicKeyNpub,
    public_key_hex: self.publicKeyHex,
    private_key: self.privateKeyNsec,
    private_key_hex: self.privateKeyHex,
    connections: [],
  },
  contacts: {},
  ledger: [],
  outbox: [],
  processed_peer_message_ids: [],
});

module.exports = {
  ALICE,
  BOB,
  CAROL,
  buildPairedFriendsFixtures: () => ({
    alice: buildState(ALICE, [BOB]),
    bob: buildState(BOB, [ALICE]),
  }),
  buildSoloFixtures: () => ({
    alice: buildSoloState(ALICE),
    bob: buildSoloState(BOB),
  }),
  buildTrioFixtures: () => ({
    alice: buildState(ALICE, [BOB, CAROL]),
    bob: buildState(BOB, [ALICE, CAROL]),
    carol: buildState(CAROL, [ALICE, BOB]),
  }),
};
