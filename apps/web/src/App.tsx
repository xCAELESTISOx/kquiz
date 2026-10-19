import { useEffect } from "react";
import { flushPendingReviews } from "./lib/api";
import { useRoute } from "./lib/router";
import { AddScreen } from "./screens/Add";
import { ReviewScreen } from "./screens/Review";
import { TodayScreen } from "./screens/Today";
import { TabBar } from "./ui/TabBar";

export function App() {
  const route = useRoute();

  useEffect(() => {
    void flushPendingReviews();
    const onOnline = () => void flushPendingReviews();
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  if (route === "review") return <ReviewScreen />;

  return (
    <div className="shell">
      {route === "add" ? <AddScreen /> : <TodayScreen />}
      <TabBar route={route} />
    </div>
  );
}
