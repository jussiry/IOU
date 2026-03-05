/*
This module enables lightweight live reload during local development. It listens to a server-sent event stream and reloads the page shortly after the backend announces a restart.

The module is loaded only in dev mode by appending an import line to `app.js` from the backend server, so production builds are unaffected.
*/

if (window.EventSource) {
  const reloadEvents = new window.EventSource("/__dev/reload");

  reloadEvents.onmessage = (event) => {
    if (event.data !== "reload") return;
    reloadEvents.close();
    window.setTimeout(() => {
      window.location.reload();
    }, 1000);
  };
}
