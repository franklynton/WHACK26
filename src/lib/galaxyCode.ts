// The galaxy code this browser plays in. Planets only meet planets with the same code, so a demo
// (or a group of friends) can have its own galaxy. "PUBLIC" is the open galaxy everyone shares.
// A link like /?galaxy=NOTTS sets it, so a code is easy to share.

const KEY = "arda-galaxy";
export const PUBLIC = "PUBLIC";

export function cleanGalaxy(x: string | null | undefined) {
  const g = (x ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{1,12}$/.test(g) ? g : PUBLIC;
}

export function getGalaxy() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("galaxy");
    if (fromUrl) localStorage.setItem(KEY, cleanGalaxy(fromUrl));
    return cleanGalaxy(localStorage.getItem(KEY));
  } catch {
    return PUBLIC;
  }
}

export function setGalaxy(code: string) {
  const g = cleanGalaxy(code);
  try {
    localStorage.setItem(KEY, g);
  } catch {}
  return g;
}

export function shareLink(code: string) {
  return `${window.location.origin}/?galaxy=${encodeURIComponent(code)}`;
}
