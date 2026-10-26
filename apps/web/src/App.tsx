import { useEffect } from "react";
import { flushPendingReviews, releaseHeldReview } from "./lib/api";
import { useLocation } from "./lib/router";
import { hideSplash } from "./lib/splash";
import { AccessScreen } from "./screens/Access";
import { AddScreen } from "./screens/Add";
import { InviteScreen } from "./screens/Invite";
import { LearnScreen } from "./screens/Learn";
import { LeechesScreen } from "./screens/Leeches";
import { CardScreen } from "./screens/Card";
import { CardsScreen } from "./screens/Cards";
import { ChoiceScreen } from "./screens/Choice";
import { LoginScreen } from "./screens/Login";
import { ReviewScreen } from "./screens/Review";
import { ShadowingScreen } from "./screens/Shadowing";
import { SoundsScreen } from "./screens/Sounds";
import { SpeechScreen } from "./screens/Speech";
import { StatsScreen } from "./screens/Stats";
import { TodayScreen } from "./screens/Today";
import { TabBar } from "./ui/TabBar";

export function App() {
  const { route, param, group, root } = useLocation();

  // Today lifts the splash itself once its numbers are in.
  useEffect(() => {
    if (route !== "today") hideSplash();
  }, [route]);

  useEffect(() => {
    // Nobody is signed in yet on these, and a stored review would send the browser to /login.
    if (location.pathname === "/login" || location.hash.startsWith("#/invite/")) return;
    // A rating held for going back that the closed app never sent.
    void releaseHeldReview();
    const onOnline = () => void flushPendingReviews();
    addEventListener("online", onOnline);
    return () => removeEventListener("online", onOnline);
  }, []);

  if (route === "login") return <LoginScreen />;
  if (route === "invite") return <InviteScreen code={param!} />;
  // A group gets a fresh screen per filter, so going from one tag to another starts over.
  const groupKey = group && JSON.stringify(group);
  if (route === "review") return <ReviewScreen key={`meaning${groupKey}`} mode="meaning" group={group} />;
  if (route === "listen") return <ReviewScreen key={`listening${groupKey}`} mode="listening" group={group} />;
  if (route === "learn") return <LearnScreen key={param} id={Number(param)} />;
  if (route === "mix") return <ReviewScreen key={`mixed${groupKey}`} mode="mixed" group={group} />;
  if (route === "speech") return <SpeechScreen key={`speech${groupKey}`} group={group} />;
  if (route === "choose") return <ChoiceScreen key={`choose${groupKey}`} group={group} />;
  if (route === "shadow") return <ShadowingScreen />;
  if (route === "sounds") return <SoundsScreen />;

  return (
    <div className="shell">
      {route === "add" ? (
        <AddScreen />
      ) : route === "cards" ? (
        <CardsScreen key="cards" filter={param === "queued" || param === "paused" ? param : undefined} root={root} />
      ) : route === "card" ? (
        <CardScreen key={param} id={Number(param)} />
      ) : route === "stats" ? (
        <StatsScreen />
      ) : route === "leeches" ? (
        <LeechesScreen />
      ) : route === "access" ? (
        <AccessScreen />
      ) : (
        <TodayScreen />
      )}
      <TabBar route={route} />
    </div>
  );
}
