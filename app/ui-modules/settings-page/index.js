/*
This module binds settings interactions for the app. It renders user/version metadata and wires actions for renaming the user and removing local app data.

By centralizing settings behavior here, the app shell only needs to pass data and version context without owning button logic.
*/

import { resetState } from "../../js/app-state.js";
import { updateUserName } from "../../js/commands/user.js";
import { isAcceptedFriendshipStatus } from "../../js/utils/friendships.js";
import { formatCurrency } from "../../js/ui/format.js";
import { showConfirmModal } from "../components/confirm-modal.js";

export const bindSettings = (root, data, appVersion) => {
  const userNameEl = root.querySelector('[data-bind="user-name"]');
  const editNameButton = root.querySelector('[data-action="edit-user-name"]');
  if (userNameEl) {
    userNameEl.textContent = data?.you?.name || "You";
  }
  const nameView = root.querySelector("[data-name-view]");
  const nameEdit = root.querySelector("[data-name-edit]");
  const nameInput = root.querySelector("[data-action='name-input']");

  const enterEdit = () => {
    nameInput.value = data?.you?.name || "";
    nameView.hidden = true;
    if (editNameButton) editNameButton.hidden = true;
    nameEdit.hidden = false;
    nameInput.focus();
    nameInput.select();
  };

  const exitEdit = () => {
    nameEdit.hidden = true;
    nameView.hidden = false;
    if (editNameButton) editNameButton.hidden = false;
  };

  if (editNameButton) {
    editNameButton.addEventListener("click", enterEdit);
  }

  if (nameEdit) {
    nameEdit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const nextName = nameInput.value.trim();
      if (nextName) await updateUserName(nextName);
      exitEdit();
    });

    const cancelBtn = nameEdit.querySelector("[data-action='cancel-edit-name']");
    if (cancelBtn) cancelBtn.addEventListener("click", exitEdit);
  }

  const versionEl = root.querySelector('[data-bind="app-version"]');
  if (versionEl && appVersion) {
    versionEl.textContent = `Version ${appVersion}`;
  }
  const transferButton = root.querySelector('[data-action="transfer-user"]');
  if (transferButton) {
    transferButton.addEventListener("click", () => {
      window.location.hash = "transfer";
    });
  }

  const removeUserButton = root.querySelector('[data-action="remove-user"]');
  if (!removeUserButton) return;
  removeUserButton.addEventListener("click", async () => {
    const friends = Array.isArray(data?.friends) ? data.friends : [];
    const unresolvedTallies = friends.filter(
      (friend) => isAcceptedFriendshipStatus(friend.friendship_status) && friend.debt_eur !== 0
    );
    const negativeTallies = unresolvedTallies.filter((friend) => friend.debt_eur < 0);

    let tallyWarning = "";
    if (unresolvedTallies.length > 0) {
      const lines = unresolvedTallies.map((friend) => {
        const amount = formatCurrency(friend.debt_eur);
        const direction = friend.debt_eur > 0 ? `owes you ${amount}` : `you owe ${amount}`;
        return `• ${friend.person_name}: ${direction}`;
      });
      tallyWarning = `\n\nUnresolved tallies:\n${lines.join("\n")}\n`;
      if (negativeTallies.length > 0) {
        const totalOwed = negativeTallies.reduce(
          (sum, friend) => sum + Math.abs(friend.debt_eur || 0),
          0
        );
        tallyWarning += `\nIf you have not transferred your user to another device, you are in practice defaulting on a tally totalling **${formatCurrency(totalOwed)}**. This can have serious consequences.\n`;
      }
    }

    const body = `This is a serious step. This will permanently remove all local data. Unless you have **transferred your user** to another device, you will not be able to retrieve your user.${tallyWarning}\nDo you still want to remove your user data?`;
    const isConfirmed = await showConfirmModal({
      title: "Remove user data",
      body,
      confirmLabel: "Remove",
    });
    if (!isConfirmed) return;
    await resetState();
    window.location.hash = "welcome";
    window.location.reload();
  });
};
