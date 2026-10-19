import type { CSSProperties } from "react";
import type { Route } from "../lib/router";
import { ChartIcon, HomeIcon, PlusIcon } from "./icons";

const TABS = [
  { route: "today", href: "#/", label: "Сегодня", Icon: HomeIcon },
  { route: "add", href: "#/add", label: "Добавить", Icon: PlusIcon },
  { route: "stats", href: "#/stats", label: "Статистика", Icon: ChartIcon },
] as const;

export function TabBar({ route }: { route: Route }) {
  const active = Math.max(
    TABS.findIndex((t) => t.route === route),
    0,
  );
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="tabbar-inner" style={{ "--tabs": TABS.length, "--active": active } as CSSProperties}>
        {/* One pill that slides between tabs, so the eye follows the switch. */}
        <span className="tab-indicator" aria-hidden="true" />
        {TABS.map(({ route: r, href, label, Icon }) => (
          <a key={r} className="tab" href={href} aria-current={route === r ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
