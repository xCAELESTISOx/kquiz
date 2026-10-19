import { useEffect, useState } from "react";

// Three screens don't justify a router dependency; hash routes keep the PWA working from any static host.
export type Route = "today" | "add" | "review";

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  return path === "add" || path === "review" ? path : "today";
}

export function navigate(route: Route) {
  location.hash = route === "today" ? "/" : `/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    addEventListener("hashchange", onChange);
    return () => removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
