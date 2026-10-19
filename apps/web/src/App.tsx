import { useEffect } from "react";
import { flushPendingReviews } from "./lib/api";
import { useRoute } from "./lib/router";
import { hideSplash } from "./lib/splash";
import { AddScreen } from "./screens/Add";
import { LoginScreen } from "./screens/Login";
import { ReviewScreen } from "./screens/Review";
import { ShadowingScreen } from "./screens/Shadowing";
import { SoundsScreen } from "./screens/Sounds";
import { SpeechScreen } from "./screens/Speech";
import { TodayScreen } from "./screens/Today";
import { TabBar } from "./ui/TabBar";

export function App() {
  const route = useRoute();

  // Today lifts the splash itself once its numbers are in.
  useEffect(() => {
    if (route !== "today") hideSplash();
  }, [route]);

  useEffect(() => {
    if (location.pathname === "/login") return;
    void flushPendingReviews();
    const onOnline = () => void flushPendingReviews();
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  if (route === "login") return <LoginScreen />;
  if (route === "review") return <ReviewScreen key="meaning" mode="meaning" />;
  if (route === "listen") return <ReviewScreen key="listening" mode="listening" />;
  if (route === "speech") return <SpeechScreen />;
  if (route === "shadow") return <ShadowingScreen />;
  if (route === "sounds") return <SoundsScreen />;

  return (
    <div className="shell">
      {route === "add" ? <AddScreen /> : <TodayScreen />}
      <TabBar route={route} />
    </div>
  );
}
