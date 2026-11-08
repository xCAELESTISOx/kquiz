import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { registerServiceWorker } from "./lib/serviceWorker";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./theme.css";
import { scheduleSplashTimeout } from "./lib/splash";
import { watchKeyboard } from "./lib/keyboard";
import { watchAppHeight } from "./lib/viewport";

scheduleSplashTimeout();
watchAppHeight();
watchKeyboard();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
