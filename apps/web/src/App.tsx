import { useEffect } from "react";
import { flushPendingReviews } from "./lib/api";
import { useLocation } from "./lib/router";
import { AddScreen } from "./screens/Add";
import { CardScreen } from "./screens/Card";
import { CardsScreen } from "./screens/Cards";
import { LoginScreen } from "./screens/Login";
import { ReviewScreen } from "./screens/Review";
import { SpeechScreen } from "./screens/Speech";
import { TodayScreen } from "./screens/Today";
import { TabBar } from "./ui/TabBar";

export function App() {
  const { route, param } = useLocation();

  useEffect(() => {
    if (location.pathname === "/login") return;
    void flushPendingReviews();
    const onOnline = () => void flushPendingReviews();
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  if (route === "login") return <LoginScreen />;
  if (route === "review") return <ReviewScreen />;
  if (route === "speech") return <SpeechScreen />;

  return (
    <div className="shell">
      {route === "add" ? (
        <AddScreen />
      ) : route === "cards" ? (
        <CardsScreen key="cards" filter={param === "queued" || param === "paused" ? param : undefined} />
      ) : route === "card" ? (
        <CardScreen key={param} id={Number(param)} />
      ) : (
        <TodayScreen />
      )}
      <TabBar route={route} />
    </div>
  );
}
