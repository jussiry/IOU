/*
Fixture: two clients (Alice and Bob) who have each other as accepted friends
with no outstanding debt, pending requests, or outbox items. Used by scenarios
that want to skip the welcome + friend-pairing setup and go straight to
testing post-onboarding behavior.

Both keypairs are real secp256k1 / nostr keys so peer-message encryption works
identically to a real user. They are fixed (not regenerated) so the fixture is
deterministic across runs.
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

const DATA_MODEL_VERSION = 2;

const buildState = (self, peer) => ({
  model_version: DATA_MODEL_VERSION,
  user: {
    id: self.publicKeyNpub,
    name: self.name,
    public_key: self.publicKeyNpub,
    public_key_hex: self.publicKeyHex,
    private_key: self.privateKeyNsec,
    private_key_hex: self.privateKeyHex,
    connections: [
      {
        person_id: peer.publicKeyNpub,
        person_name: peer.name,
        friendship_status: "accepted",
        debt_eur: 0,
        trust_credit_limit_eur: 100,
        recent_transactions: [],
        last_synced_at: "",
      },
    ],
  },
  contacts: {
    [peer.publicKeyNpub]: {
      id: peer.publicKeyNpub,
      public_key: peer.publicKeyNpub,
      public_key_hex: peer.publicKeyHex,
      name: peer.name,
    },
  },
  logs: [],
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
  logs: [],
  outbox: [],
  processed_peer_message_ids: [],
});

module.exports = {
  ALICE,
  BOB,
  buildPairedFriendsFixtures: () => ({
    alice: buildState(ALICE, BOB),
    bob: buildState(BOB, ALICE),
  }),
  buildSoloFixtures: () => ({
    alice: buildSoloState(ALICE),
    bob: buildSoloState(BOB),
  }),
};
