// Runs before first paint. chrome.storage is async, which would flash the wrong
// theme, so the resolved preference is mirrored into localStorage and read
// synchronously here. chrome.storage.sync stays the source of truth.
(() => {
  const KEY = "dr-theme";
  const stored = (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  })();

  const preference = ["auto", "light", "dark"].includes(stored)
    ? stored
    : "auto";

  const resolve = (pref) =>
    pref === "auto"
      ? matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : pref;

  document.documentElement.dataset.theme = resolve(preference);
  document.documentElement.dataset.themePref = preference;
})();
