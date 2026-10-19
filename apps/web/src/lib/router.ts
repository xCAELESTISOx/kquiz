import { useEffect, useState } from "react";

// A handful of screens doesn't justify a router dependency. Screens live in the hash, so the PWA works
// from any static host; /login is a real path because the MCP OAuth consent links to it.
export type Route = "today" | "add" | "review" | "speech" | "shadow" | "sounds" | "login";

function parse(): Route {
  if (location.pathname === "/login") return "login";
  const path = location.hash.replace(/^#\/?/, "");
  return path === "add" || path === "review" || path === "speech" || path === "shadow" || path === "sounds" ? path : "today";
}

export function navigate(route: Exclude<Route, "login">) {
  location.hash = route === "today" ? "/" : `/${route}`;
}

/**
 * Only same-origin paths: "/x", but not "//evil.example". Backslashes and control characters are refused
 * outright, since browsers turn "/\\evil" and "/\t/evil" into protocol-relative URLs.
 */
export function safeReturnTo(value: string | null): string {
  return value && /^\/(?!\/)[^\\\x00-\x1f]*$/.test(value) ? value : "/";
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    addEventListener("hashchange", onChange);
    addEventListener("popstate", onChange);
    return () => {
      removeEventListener("hashchange", onChange);
      removeEventListener("popstate", onChange);
    };
  }, []);
  return route;
}
