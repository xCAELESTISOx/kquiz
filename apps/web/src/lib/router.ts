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
  | "choose"
  | "listen"
  | "mix"
  | "cards"
  | "card"
  | "learn"
  | "leeches"
  | "shadow"
  | "sounds"
  | "access"
  | "invite"
  | "login";

export interface Location {
  route: Route;
  /** The card id on "card" and "learn", the filter on "cards" ("queued", "paused", "phrases"), the code on "invite". */
  param?: string;
  /** A group picked on the cards screen, reviewed instead of the day's queue: `#/review?tag=еда`. */
  group?: GroupFilter;
  /** On "cards": the hanja whose word family is shown, `#/cards?root=學`. */
  root?: string;
}

type GroupRoute = "review" | "speech" | "choose" | "listen" | "mix";

export function groupHash(route: GroupRoute, filter: GroupFilter): string {
  const params = new URLSearchParams();
  if (filter.q) params.set("q", filter.q);
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.root) params.set("root", filter.root);
  if (filter.status) params.set("status", filter.status);
  if (filter.kind) params.set("kind", filter.kind);
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
  const root = params.get("root")?.trim();
  if (root) group.root = root;
  if (params.get("status") === "queued") group.status = "queued";
  if (params.get("kind") === "phrase") group.kind = "phrase";
  return group;
}

/** `#/cards` is the list, `#/cards/queued` a filter of it, `#/cards/12` one card. */
export function parseHash(hash: string): Location {
  const [path, search] = hash.replace(/^#\/?/, "").split("?");
  const [head, param] = path!.split("/");
  if (head === "review" || head === "speech" || head === "choose" || head === "listen" || head === "mix") {
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
  // "Учить" from a card's menu: that one word in every mode, #/learn/<id>.
  if (head === "learn" && param && /^\d+$/.test(param)) return { route: "learn", param };
  // A friend's invite link: #/invite/<code>.
  if (head === "invite" && param) return { route: "invite", param };
  if (head === "cards") {
    if (param && /^\d+$/.test(param)) return { route: "card", param };
    const root = new URLSearchParams(search ?? "").get("root")?.trim();
    return { route: "cards", param: param || undefined, ...(root && { root }) };
  }
  return { route: "today" };
}

function parse(): Location {
  if (location.pathname === "/login") return { route: "login" };
  return parseHash(location.hash);
}

export function navigate(route: Exclude<Route, "login" | "card" | "learn" | "invite">) {
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
