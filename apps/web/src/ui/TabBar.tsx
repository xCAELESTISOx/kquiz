import type { Route } from "../lib/router";
import { CardsIcon, HomeIcon, PlusIcon } from "./icons";

const TABS = [
  { id: "today", href: "#/", label: "Сегодня", Icon: HomeIcon },
  { id: "cards", href: "#/cards", label: "Карточки", Icon: CardsIcon },
  { id: "add", href: "#/add", label: "Добавить", Icon: PlusIcon },
] as const;

export function TabBar({ route }: { route: Route }) {
  const active = route === "card" ? "cards" : route;
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="tabbar-inner" data-active={active}>
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
