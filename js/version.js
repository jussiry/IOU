/*
This module reads the app version metadata from static JSON and caches it in memory for the current runtime session.

Other modules use this value to compare against stored version information and decide when local cached state should be reset.
*/

let cachedVersion = null;

export const getAppVersion = async () => {
  if (cachedVersion) return cachedVersion;
  try {
    const response = await fetch("data/version.json", { cache: "no-store" });
    const data = await response.json();
    cachedVersion = data?.version || "0.0.0";
  } catch (error) {
    cachedVersion = "0.0.0";
  }
  return cachedVersion;
};

export const getCachedVersion = () => cachedVersion;
