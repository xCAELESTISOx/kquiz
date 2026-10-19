import type { Route } from "../lib/router";
import { HomeIcon, PlusIcon } from "./icons";

export function TabBar({ route }: { route: Route }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      <div className="tabbar-inner" data-active={route === "add" ? "add" : "today"}>
        {/* One pill that slides between tabs, so the eye follows the switch. */}
        <span className="tab-indicator" aria-hidden="true" />
        <a className="tab" href="#/" aria-current={route === "today" ? "page" : undefined}>
          <HomeIcon />
          <span>Сегодня</span>
        </a>
        <a className="tab" href="#/add" aria-current={route === "add" ? "page" : undefined}>
          <PlusIcon />
          <span>Добавить</span>
        </a>
      </div>
    </nav>
  );
}
