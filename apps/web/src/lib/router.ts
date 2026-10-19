import { useEffect, useState } from "react";

// A handful of screens doesn't justify a router dependency. Screens live in the hash, so the PWA works
// from any static host; /login is a real path because the MCP OAuth consent links to it.
export type Route = "today" | "add" | "review" | "speech" | "listen" | "cards" | "card" | "login";

export interface Location {
  route: Route;
  /** The card id on "card", the filter on "cards" ("queued", "paused"). */
  param?: string;
}

/** `#/cards` is the list, `#/cards/queued` a filter of it, `#/cards/12` one card. */
export function parseHash(hash: string): Location {
  const [head, param] = hash.replace(/^#\/?/, "").split("/");
  if (head === "add" || head === "review" || head === "speech" || head === "listen") return { route: head };
  if (head === "cards") {
    if (param && /^\d+$/.test(param)) return { route: "card", param };
    return { route: "cards", param: param || undefined };
  }
  return { route: "today" };
}

function parse(): Location {
  if (location.pathname === "/login") return { route: "login" };
  return parseHash(location.hash);
}

export function navigate(route: Exclude<Route, "login" | "card">) {
  location.hash = route === "today" ? "/" : `/${route}`;
}

/**
 * Only same-origin paths: "/x", but not "//evil.example". Backslashes and control characters are refused
 * outright, since browsers turn "/\\evil" and "/\t/evil" into protocol-relative URLs.
 */
export function safeReturnTo(value: string | null): string {
  return value && /^\/(?!\/)[^\\\x00-\x1f]*$/.test(value) ? value : "/";
}

export function useLocation(): Location {
  const [loc, setLoc] = useState(parse);
  useEffect(() => {
    const onChange = () => setLoc(parse());
    addEventListener("hashchange", onChange);
    addEventListener("popstate", onChange);
    return () => {
      removeEventListener("hashchange", onChange);
      removeEventListener("popstate", onChange);
    };
  }, []);
  return loc;
}
