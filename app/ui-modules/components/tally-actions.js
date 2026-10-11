/*
This module binds shared action buttons used across pages: Send and Request. Each derives its route from the context — on a friend page the friend is passed along (`record/<friendId>`, `request/<friendId>`) so the form opens with that friend preselected; on the Tally page the bare route opens the form with no friend chosen.

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
      window.location.hash = friendId ? `request/${friendId}` : "request";
    });
  }
};
