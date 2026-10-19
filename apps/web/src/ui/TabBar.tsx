import type { Route } from "../lib/router";
import { HomeIcon, PlusIcon } from "./icons";

export function TabBar({ route }: { route: Route }) {
  return (
    <nav className="tabbar" aria-label="Разделы">
      <a className="tab" href="#/" aria-current={route === "today" ? "page" : undefined}>
        <HomeIcon />
        <span>Сегодня</span>
      </a>
      <a className="tab" href="#/add" aria-current={route === "add" ? "page" : undefined}>
        <PlusIcon />
        <span>Добавить</span>
      </a>
    </nav>
  );
}
