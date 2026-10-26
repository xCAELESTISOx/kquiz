import { useEffect, useState } from "react";
import type { GroupFilter } from "./types";

// A handful of screens doesn't justify a router dependency. Screens live in the hash, so the PWA works
// from any static host; /login is a real path because the MCP OAuth consent links to it.
export type Route =
  | "today"
  | "add"
  | "stats"
  | "review"
  | "speech"
  | "listen"
  | "mix"
  | "cards"
  | "card"
  | "leeches"
  | "shadow"
  | "sounds"
  | "access"
  | "invite"
  | "login";

export interface Location {
  route: Route;
  /** The card id on "card", the filter on "cards" ("queued", "paused"), the code on "invite". */
  param?: string;
  /** A group picked on the cards screen, reviewed instead of the day's queue: `#/review?tag=еда`. */
  group?: GroupFilter;
}

type GroupRoute = "review" | "speech" | "listen" | "mix";

export function groupHash(route: GroupRoute, filter: GroupFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.status) params.set("status", filter.status);
  return `#/${route}?${params}`;
}

function parseGroup(search: string | undefined): GroupFilter | undefined {
  if (search === undefined) return undefined;
  const params = new URLSearchParams(search);
  const group: GroupFilter = {};
  const q = params.get("q")?.trim();
  const tag = params.get("tag")?.trim();
  if (q) group.q = q;
  if (tag) group.tag = tag;
  if (params.get("status") === "queued") group.status = "queued";
  return group;
}

/** `#/cards` is the list, `#/cards/queued` a filter of it, `#/cards/12` one card. */
export function parseHash(hash: string): Location {
  const [path, search] = hash.replace(/^#\/?/, "").split("?");
  const [head, param] = path!.split("/");
  if (head === "review" || head === "speech" || head === "listen" || head === "mix") {
    const group = parseGroup(search);
    return group ? { route: head, group } : { route: head };
  }
  if (
    head === "add" ||
    head === "stats" ||
    head === "leeches" ||
    head === "shadow" ||
    head === "sounds" ||
    head === "access"
  ) {
    return { route: head };
  }
  // A friend's invite link: #/invite/<code>.
  if (head === "invite" && param) return { route: "invite", param };
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

export function navigate(route: Exclude<Route, "login" | "card" | "invite">) {
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
