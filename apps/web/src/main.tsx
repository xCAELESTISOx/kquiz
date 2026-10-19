import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { scheduleSplashTimeout } from "./lib/splash";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./theme.css";

scheduleSplashTimeout();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
