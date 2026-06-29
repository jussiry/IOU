/*
This module lazily injects the SVG icon sprite into the document once and reuses the same promise for concurrent callers.

Keeping this logic centralized avoids duplicated network fetches and guarantees all icon-based components can resolve <use> references reliably.
@category ui
*/

const ICON_SPRITE_PATH = "ui-modules/components/icons.html";
let spritePromise = null;

export const ensureIconSprite = async () => {
  if (document.getElementById("icon-sprite")) return;
  if (!spritePromise) {
    spritePromise = fetch(ICON_SPRITE_PATH, { cache: "no-store" })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (!html) return;
        if (document.getElementById("icon-sprite")) return;
        document.body.insertAdjacentHTML("afterbegin", html);
      })
      .catch(() => null);
  }
  return spritePromise;
};
