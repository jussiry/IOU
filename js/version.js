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
