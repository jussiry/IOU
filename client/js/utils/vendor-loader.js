/*
Lazy-loads a vendor script (IIFE/UMD) and returns the global it exposes.

Vendor libraries are not ES modules, so they must be loaded via script tags.
This utility deduplicates requests and caches the result so each library is
loaded at most once per page session.
*/

const loaded = new Map();

export const loadVendorScript = (src, globalName) => {
  if (loaded.has(src)) {
    return loaded.get(src);
  }

  const promise = new Promise((resolve, reject) => {
    if (window[globalName]) {
      resolve(window[globalName]);
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(window[globalName]);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  loaded.set(src, promise);
  return promise;
};
