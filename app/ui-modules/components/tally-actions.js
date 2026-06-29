/*
This module binds shared action buttons used across pages. It currently handles send navigation and derives the correct route for generic and friend-specific contexts.

Keeping this behavior as a component module allows tally and subpage views to reuse the same action markup and click wiring.
@category ui
*/

export const initTallyActions = (root, friendId) => {
  const sendButton = root.querySelector('[data-action="send"]');
  if (sendButton) {
    sendButton.addEventListener("click", () => {
      const target = friendId ? `record/${friendId}` : "record";
      window.location.hash = target;
    });
  }

  const requestButton = root.querySelector('[data-action="request"]');
  if (requestButton) {
    requestButton.addEventListener("click", () => {
      window.location.hash = "request";
    });
  }
};
