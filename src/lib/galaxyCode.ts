// The galaxy this browser wants to be in, remembered so a refresh (or coming back later) rejoins it.
// Galaxies themselves live in the database as temporary rooms (migration 003); this is only the code.
// A URL like /?galaxy=NOTTS also sets it.

export const GALAXY_MAX = 5;
const KEY = "arda-galaxy";

// Codes are 3 to 12 letters or digits, upper case. Anything else is not a code.
export function cleanCode(x: string | null | undefined) {
  const g = (x ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(g) ? g : null;
}

// What to keep while typing: letters and digits only, upper case, at most 12.
export const typeCode = (x: string) => x.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

export const CODE_RULE = "Codes are 3 to 12 letters or numbers.";

export function wantedGalaxy() {
  try {
    // A shared link's code is taken once, then dropped from the address bar, so leaving
    // (or playing alone) isn't undone by the next refresh.
    const url = new URL(window.location.href);
    const fromUrl = cleanCode(url.searchParams.get("galaxy"));
    if (url.searchParams.has("galaxy")) {
      url.searchParams.delete("galaxy");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
    if (fromUrl) localStorage.setItem(KEY, fromUrl);
    return cleanCode(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function setWantedGalaxy(code: string | null) {
  try {
    if (code) localStorage.setItem(KEY, code);
    else localStorage.removeItem(KEY);
  } catch {}
}

// The message for a failed join, worded like a form error.
export function joinError(reason: string | undefined, code: string, members?: number) {
  if (reason === "full") return `Galaxy ${code} is full (${members ?? GALAXY_MAX}/${GALAXY_MAX} gods). Try another code.`;
  if (reason === "invalid") return CODE_RULE;
  if (reason === "not_migrated") return "Galaxy rooms aren't set up yet: run migration 003 in Supabase.";
  return "Couldn't reach the galaxy. Try again.";
}
