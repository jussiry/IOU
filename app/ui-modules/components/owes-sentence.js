/*
owes-sentence component helpers.

Wires up the live preview amounts in an `.owes-sentence` block: as the user
types into the amount input, the −€X / +€X spans under each name update in
sync and become visible. When the amount is 0/empty the spans stay in the
layout (visibility: hidden) so the form below never jumps.

`bindOwesPreview` returns the update function so callers can re-run it after
programmatic value changes (e.g. when a QR scan fills the form).

`bindFriendSelect` fills the friend <select> of the sentence and gates the
submit button. With a preselected friend (page opened from a friend page) that
friend is chosen; otherwise a "Choose friend…" placeholder is shown and nothing
is chosen until the user picks someone. The submit button stays disabled
(`is-disabled`, the same gray as other forms) until a friend is chosen and the
amount is positive.
@category ui
*/

const formatAmount = (parsed) =>
  parsed % 1 === 0 ? String(parsed) : parsed.toFixed(2);

export const bindOwesPreview = ({
  amountEl,
  debtorAmountEl,
  creditorAmountEl,
}) => {
  const update = () => {
    const parsed = parseFloat(amountEl?.value);
    const hasAmount = Number.isFinite(parsed) && parsed > 0;
    const formatted = hasAmount ? formatAmount(parsed) : "0";
    if (debtorAmountEl) {
      debtorAmountEl.textContent = `−€${formatted}`;
      debtorAmountEl.classList.toggle("is-visible", hasAmount);
    }
    if (creditorAmountEl) {
      creditorAmountEl.textContent = `+€${formatted}`;
      creditorAmountEl.classList.toggle("is-visible", hasAmount);
    }
  };
  amountEl?.addEventListener("input", update);
  update();
  return update;
};

export const bindFriendSelect = ({
  selectEl,
  friends,
  friendId,
  amountEl,
  submitEl,
  onChange,
}) => {
  const getSelected = () =>
    friends.find((friend) => friend.person_id === selectEl?.value) || null;

  const sync = () => {
    const amount = parseFloat(amountEl?.value);
    const canSubmit = Boolean(getSelected()) && Number.isFinite(amount) && amount > 0;
    selectEl?.classList.toggle("is-placeholder", !getSelected());
    submitEl?.classList.toggle("is-disabled", !canSubmit);
    submitEl?.setAttribute("aria-disabled", String(!canSubmit));
  };

  if (selectEl) {
    const hasPreselection = friends.some((friend) => friend.person_id === friendId);
    selectEl.innerHTML = hasPreselection
      ? ""
      : '<option value="" disabled selected>Choose friend…</option>';
    friends.forEach((friend) => {
      const option = document.createElement("option");
      option.value = friend.person_id;
      option.textContent = friend.person_name || friend.person_id;
      selectEl.appendChild(option);
    });
    if (hasPreselection) selectEl.value = friendId;
    selectEl.addEventListener("change", () => {
      sync();
      onChange?.(getSelected());
    });
  }
  amountEl?.addEventListener("input", sync);

  sync();
  onChange?.(getSelected());
  return { getSelected, sync };
};
