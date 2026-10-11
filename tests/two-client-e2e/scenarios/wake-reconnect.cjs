/*
Wake-from-suspend reconnect scenario.

Setup:
  Alice runs on two devices ("alice-phone" and "alice-laptop") and is paired
  with Bob. All three clients connect to the same relay, so the laptop holds a
  self-mesh peer to the phone and a friend-mesh peer to Bob.

Trigger:
  The laptop's main thread is blocked for longer than the mesh's wake-gap
  threshold. The wake detector treats that as a suspend and tears down every
  WebRTC peer — exactly what happens when a phone screen turns off or a laptop
  lid closes, while the relay websockets stay up.

Assertions:
  Both the self-device connection and the friend connection come back on
  their own. This guards against the relay pool swallowing repeat
  peer_connect messages for peers it already considers present, and against
  the self-mesh never asking the relay to re-pair after a drop.
*/

const { buildPairedFriendsFixtures } = require("../fixtures/paired-friends.cjs");

const SUSPEND_MS = 6500;
const RECOVERY_TIMEOUT_MS = 20000;

const readCounts = (client) =>
  client.page.evaluate(async () => {
    const status = await import("/dist/js/peer/status.js");
    return {
      peers: status.getConnectedPeerIds().length,
      selfDevices: status.getConnectedSelfDeviceIds().length,
    };
  });

const waitForCounts = async (harness, client, expected) => {
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  let counts;
  while (Date.now() < deadline) {
    counts = await readCounts(client);
    if (Object.entries(expected).every(([key, value]) => counts[key] === value)) {
      return counts;
    }
    await harness.delay(250);
  }
  throw new Error(
    `${client.label}: expected ${JSON.stringify(expected)}, last ${JSON.stringify(counts)}`
  );
};

module.exports = {
  name: "wake-reconnect",
  run: async ({ createSeededClient, harness }) => {
    const fixtures = buildPairedFriendsFixtures();
    const phone = await createSeededClient({ label: "alice-phone", seed: fixtures.alice });
    const laptop = await createSeededClient({ label: "alice-laptop", seed: fixtures.alice });
    const bob = await createSeededClient({ label: "bob", seed: fixtures.bob });

    await waitForCounts(harness, laptop, { peers: 1, selfDevices: 1 });
    await waitForCounts(harness, phone, { selfDevices: 1 });

    await laptop.page.evaluate((ms) => {
      const start = Date.now();
      while (Date.now() - start < ms) {
        // busy-wait: freezes timers like an OS suspend would
      }
    }, SUSPEND_MS);

    // Make sure the laptop really tore its peers down before measuring
    // recovery, so a pass can't come from reading pre-suspend counts.
    const wasReset = () =>
      laptop.consoleEntries.some((entry) => /Wake from suspend/.test(entry.text || ""));
    const resetDeadline = Date.now() + 5000;
    while (!wasReset() && Date.now() < resetDeadline) await harness.delay(50);
    if (!wasReset()) throw new Error("alice-laptop never logged a wake-from-suspend reset");

    const recoveryStart = Date.now();
    const laptopCounts = await waitForCounts(harness, laptop, { peers: 1, selfDevices: 1 });
    const phoneCounts = await waitForCounts(harness, phone, { selfDevices: 1 });
    const bobCounts = await waitForCounts(harness, bob, { peers: 1 });

    return {
      recoveryMs: Date.now() - recoveryStart,
      laptop: laptopCounts,
      phone: phoneCounts,
      bob: bobCounts,
    };
  },
};
