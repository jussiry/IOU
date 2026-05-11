/*
owes-sentence component helpers.

Wires up the live preview amounts in an `.owes-sentence` block: as the user
types into the amount input, the −€X / +€X spans under each name update in
sync and become visible. When the amount is 0/empty the spans stay in the
layout (visibility: hidden) so the form below never jumps.

`bindOwesPreview` returns the update function so callers can re-run it after
programmatic value changes (e.g. when a QR scan fills the form).
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
