import { useEffect, useState, type CSSProperties } from "react";
import { access } from "../lib/api";
import { cardsCount } from "../lib/plural";
import type { AccessInfo, AccessUser } from "../lib/types";
import { Spinner } from "../ui/Spinner";

// The owner's screen: invite a friend by a one-time link, see who uses the app, switch someone off.

function ago(iso: string | null): string {
  if (!iso) return "never signed in";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "signed in today";
  if (days === 1) return "signed in yesterday";
  return `signed in ${days} days ago`;
}

function userLine(user: AccessUser): string {
  const cards = cardsCount(user.cards);
  return user.disabled ? `${cards} · switched off` : `${cards} · ${ago(user.lastSignInAt)}`;
}

export function AccessScreen() {
  const [info, setInfo] = useState<AccessInfo>();
  const [link, setLink] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const load = () =>
    access.get().then(
      (data) => setInfo(data),
      (e: Error) => setError(e.message === "forbidden" ? "This section is for the owner only." : e.message),
    );

  useEffect(() => {
    document.title = "Friends' access · KQuiz";
    void load();
  }, []);

  async function run(key: string, action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    setError(undefined);
    try {
      await action();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  const invite = () =>
    run("invite", async () => {
      setCopied(false);
      setLink((await access.invite()).url);
    });

  async function share() {
    if (!link) return;
    const text = "Learn Korean with me in KQuiz. The link works once, within 24 hours:";
    try {
      if (navigator.share) await navigator.share({ title: "KQuiz", text, url: link });
      else {
        await navigator.clipboard.writeText(link);
        setCopied(true);
      }
    } catch {
      // The share sheet was closed; the link stays on screen.
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const remove = (user: AccessUser) => {
    if (!confirm(`Delete ${user.name} with all their cards, reviews and stats? This can't be undone.`)) return;
    void run(`remove-${user.id}`, () => access.remove(user.id));
  };

  const full = info ? info.users.length >= info.maxUsers : false;

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title">Friends' access</h1>
        <p className="subtitle">Who else learns with KQuiz</p>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      {!info && !error && <div className="skeleton" aria-busy="true" />}

      {info && (
        <>
          <ul className="access-list">
            {info.users.map((user, i) => (
              <li key={user.id} className="access-item" style={{ "--i": i } as CSSProperties}>
                <div className="access-who">
                  <span className="access-name">
                    {user.name}
                    {user.role === "owner" && <span className="muted"> · you</span>}
                  </span>
                  <span className="muted small">{userLine(user)}</span>
                </div>
                {user.role === "member" && (
                  <div className="access-actions">
                    {user.disabled ? (
                      <>
                        <button
                          type="button"
                          className="chip-button"
                          disabled={Boolean(busy)}
                          onClick={() => void run(`enable-${user.id}`, () => access.enable(user.id))}
                        >
                          Switch on
                        </button>
                        <button type="button" className="chip-button danger" disabled={Boolean(busy)} onClick={() => remove(user)}>
                          Delete
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="chip-button"
                        disabled={Boolean(busy)}
                        onClick={() => void run(`disable-${user.id}`, () => access.disable(user.id))}
                      >
                        Switch off
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>

          <section className="access-invite">
            {link ? (
              <>
                <p>A link for a friend. It works once, within 24 hours; after that you need a new one.</p>
                <code className="access-link">{link}</code>
                <div className="action-pair">
                  <button type="button" className="button primary" onClick={() => void share()}>
                    Share
                  </button>
                  <button type="button" className="button" onClick={() => void copy()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {full
                    ? `The server allows at most ${info.maxUsers} people. To invite someone else, delete a switched-off person.`
                    : "Your friend opens the link on their phone, enters a name and creates a passkey. You don't see their cards and stats, and they don't see yours."}
                </p>
                <button type="button" className="button primary" disabled={full || Boolean(busy)} onClick={() => void invite()}>
                  {busy === "invite" && <Spinner />}
                  Invite
                </button>
              </>
            )}
            {info.invites.length > 0 && (
              <p className="muted small">
                Unused links: {info.invites.length}.{" "}
                <button
                  type="button"
                  className="link-button inline"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    void run("cancel", async () => {
                      await access.cancelInvites();
                      setLink(undefined);
                    })
                  }
                >
                  Cancel
                </button>
              </p>
            )}
          </section>

          <section className="access-notes muted small">
            <p>
              Friends have limits so the server isn't overloaded: {info.memberLimits.cardsPerDay} new cards and{" "}
              {info.memberLimits.scoresPerDay} pronunciation checks a day. You have no limits.
            </p>
            <p>
              A friend can connect their own Claude: the connector is at <code>{location.origin}/mcp</code>. Claude
              will see only their cards.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
