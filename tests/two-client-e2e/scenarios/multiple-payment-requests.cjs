/*
Regression test for several payment requests open between the same two friends
at once. The friend record used to hold a single request slot: the requester
kept only the first request and the recipient only the latest, so the rest
could neither be answered nor cancelled even though all of them were in the
ledger. Open requests are now derived from the ledger.

Alice sends Bob three requests in a row. Both friend pages must show all three.
Bob then answers two of them out of order through the UI — paying the middle
one, declining the first — and Alice cancels the last, which must reach Bob
too. Every request ends closed on both sides, and only the paid one moves the
tally.

Uses pre-seeded paired fixtures (already friends) so the scenario spends its
time on the requests rather than the friend handshake.
*/

const { ALICE, BOB, buildPairedFriendsFixtures } = require("../fixtures/paired-friends.cjs");

const ACTIVE_BOX = '.page-view.is-active [data-section="payment-request"]';

// Commands are called in-page so the scenario drives the real code path without
// depending on the send/request form's layout.
const requestPayment = (client, friendId, amount, message) =>
  client.page.evaluate(
    async ([id, value, note]) => {
      const { requestPayment } = await import("/dist/js/commands/payment-request.js");
      await requestPayment({ friendId: id, amount: value, message: note });
    },
    [friendId, amount, message]
  );

// Wait until this client's view shows exactly `labels` as its open requests
// with `friendId` — direction and amount, newest first, as the view orders them.
const waitForOpenRequests = (client, friendId, labels, timeout) =>
  client.page.waitForFunction(
    async ([id, expected]) => {
      const { loadData } = await import("/dist/js/app-state.js");
      const friend = (await loadData())?.friends.find((f) => f.person_id === id);
      const actual = (friend?.pending_payment_requests ?? []).map(
        (request) => `${request.is_incoming ? "in" : "out"} ${request.amount_eur}`
      );
      return JSON.stringify(actual) === JSON.stringify(expected);
    },
    [friendId, labels],
    { timeout, polling: 250 }
  );

const readBoxLabels = (client) =>
  client.page.$$eval(ACTIVE_BOX, (boxes) =>
    // innerText, not textContent: each box carries both action groups and
    // hides the one that doesn't apply, so only rendered text is meaningful.
    boxes.filter((box) => !box.hidden).map((box) => box.innerText.replace(/\s+/g, " ").trim())
  );

const clickInBox = (client, amountText, action) =>
  client.page
    .locator(ACTIVE_BOX, { hasText: amountText })
    .locator(`[data-action="${action}"]`)
    .click();

const readDebt = (client, friendId) =>
  client.page.evaluate(async (id) => {
    const { loadData } = await import("/dist/js/app-state.js");
    return (await loadData()).friends.find((f) => f.person_id === id).debt_eur;
  }, friendId);

module.exports = {
  name: "multiple-payment-requests",
  run: async ({ assert, createSeededClient, helpers, harness }) => {
    const fixtures = buildPairedFriendsFixtures();
    const alice = await createSeededClient({ label: "alice", seed: fixtures.alice });
    const bob = await createSeededClient({ label: "bob", seed: fixtures.bob });
    const timeout = harness.waitMs ?? 20000;

    await helpers.waitForPeerConnectionCount(alice, "1");

    for (const amount of [1, 2, 3]) {
      await requestPayment(alice, BOB.publicKeyNpub, amount, `request ${amount}`);
    }

    // Both sides see all three — the old code showed Alice only "out 1" and
    // Bob only "in 3".
    await waitForOpenRequests(alice, BOB.publicKeyNpub, ["out 3", "out 2", "out 1"], timeout);
    await waitForOpenRequests(bob, ALICE.publicKeyNpub, ["in 3", "in 2", "in 1"], timeout);

    await helpers.navigateHash(alice, `friend/${BOB.publicKeyNpub}`, ACTIVE_BOX);
    await helpers.navigateHash(bob, `friend/${ALICE.publicKeyNpub}`, ACTIVE_BOX);
    const aliceBoxes = await readBoxLabels(alice);
    const bobBoxes = await readBoxLabels(bob);
    assert.equal(aliceBoxes.length, 3, `Alice should see 3 requests, saw: ${aliceBoxes}`);
    assert.equal(bobBoxes.length, 3, `Bob should see 3 requests, saw: ${bobBoxes}`);
    assert.ok(
      aliceBoxes.every((text) => /Cancel request$/.test(text) && !/Decline/.test(text)),
      `Alice's boxes should offer only Cancel: ${aliceBoxes}`
    );
    assert.ok(
      bobBoxes.every((text) => /Pay Decline$/.test(text) && !/Cancel/.test(text)),
      `Bob's boxes should offer only Pay/Decline: ${bobBoxes}`
    );

    // Answer out of order, through the per-request buttons.
    await clickInBox(bob, "€2.00", "accept-payment-request");
    await waitForOpenRequests(bob, ALICE.publicKeyNpub, ["in 3", "in 1"], timeout);
    await clickInBox(bob, "€1.00", "decline-payment-request");
    await waitForOpenRequests(bob, ALICE.publicKeyNpub, ["in 3"], timeout);
    await waitForOpenRequests(alice, BOB.publicKeyNpub, ["out 3"], timeout);

    // Cancelling is a real message now, so it closes Bob's copy as well.
    await clickInBox(alice, "€3.00", "cancel-payment-request");
    await waitForOpenRequests(alice, BOB.publicKeyNpub, [], timeout);
    await waitForOpenRequests(bob, ALICE.publicKeyNpub, [], timeout);

    // Only the paid request moved money: Bob sent Alice an IOU for €2.
    await harness.delay(1000);
    const debts = {
      alice: await readDebt(alice, BOB.publicKeyNpub),
      bob: await readDebt(bob, ALICE.publicKeyNpub),
    };
    assert.equal(debts.alice, 2);
    assert.equal(debts.bob, -2);

    return { aliceBoxes, bobBoxes, debts };
  },
};
