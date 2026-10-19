import { useEffect } from "react";
import { flushPendingReviews } from "./lib/api";
import { useRoute } from "./lib/router";
import { AddScreen } from "./screens/Add";
import { LoginScreen } from "./screens/Login";
import { ReviewScreen } from "./screens/Review";
import { SpeechScreen } from "./screens/Speech";
import { TodayScreen } from "./screens/Today";
import { TabBar } from "./ui/TabBar";

export function App() {
  const route = useRoute();

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
      {route === "add" ? <AddScreen /> : <TodayScreen />}
      <TabBar route={route} />
    </div>
  );
}
