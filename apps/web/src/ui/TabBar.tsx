import type { CSSProperties } from "react";
import type { Route } from "../lib/router";
import { CardsIcon, ChartIcon, HomeIcon, PlusIcon } from "./icons";

const TABS = [
  { id: "today", href: "#/", label: "Сегодня", Icon: HomeIcon },
  { id: "add", href: "#/add", label: "Добавить", Icon: PlusIcon },
  { id: "cards", href: "#/cards", label: "Карточки", Icon: CardsIcon },
  { id: "stats", href: "#/stats", label: "Статистика", Icon: ChartIcon },
] as const;

export function TabBar({ route }: { route: Route }) {
  const active = route === "card" ? "cards" : route;
  const index = Math.max(
    TABS.findIndex((t) => t.id === active),
    0,
  );
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="tabbar-inner" style={{ "--tabs": TABS.length, "--active": index } as CSSProperties}>
        {/* One pill that slides between tabs, so the eye follows the switch. */}
        <span className="tab-indicator" aria-hidden="true" />
        {TABS.map(({ id, href, label, Icon }) => (
          <a key={id} className="tab" href={href} aria-current={active === id ? "page" : undefined}>
            <Icon />
            <span>{label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
