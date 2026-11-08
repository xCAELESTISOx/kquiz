import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState, type FormEvent } from "react";
import { auth, setCsrfToken } from "../lib/api";
import type { InviteStatus } from "../lib/types";
import { Spinner } from "../ui/Spinner";

// A friend opens the owner's one-time link, gives a name and makes a passkey: that is their account.
const SERVER_ERRORS: Record<string, string> = {
  forbidden: "This link no longer works. Ask for a new one.",
  challenge_expired: "The request expired. Tap the button again.",
  verification_failed: "The passkey wasn't created. Try again.",
};

function errorText(error: unknown): string {
  const { name, message } = (error ?? {}) as Partial<Error>;
  if (name === "NotAllowedError" || name === "AbortError") return "Canceled. Tap the button again.";
  if (name === "InvalidStateError") return "This phone already has a KQuiz passkey. Sign in with it.";
  return (message ? SERVER_ERRORS[message] : undefined) ?? (message ? `Something went wrong: ${message}` : "Something went wrong.");
}

export function InviteScreen({ code }: { code: string }) {
  const [status, setStatus] = useState<InviteStatus>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Invite · KQuiz";
    auth.invite(code).then(
      ({ status }) => setStatus(status),
      (e) => {
        setError(errorText(e));
        setStatus("invalid");
      },
    );
  }, [code]);

  async function join(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const userName = name.trim();
    if (!userName) return setError("Enter your name.");
    setBusy(true);
    setError(undefined);
    const who = { invite: code, userName };
    try {
      const optionsJSON = (await auth.registerOptions(who)) as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"];
      const response = await startRegistration({ optionsJSON });
      const result = await auth.registerVerify(who, response);
      setCsrfToken(result.csrfToken);
      // The code is spent: drop it from the address and history.
      location.replace("/#/");
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-mark" lang="ko" aria-hidden="true">
        한
      </div>
      <h1 className="login-title">KQuiz</h1>

      {status === undefined && <div className="login-body" aria-busy="true" />}

      {status === "ok" && (
        <form className="login-body" onSubmit={join}>
          <p className="muted">
            You're invited to learn Korean in KQuiz. Your cards, reviews and stats are yours alone; no one else sees them.
            You sign in with a passkey: Face ID or your phone's passcode.
          </p>
          <label className="field">
            <span className="field-label">Your name</span>
            <input
              className="input"
              name="name"
              autoComplete="given-name"
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
          <button type="submit" className="button primary" disabled={busy}>
            {busy && <Spinner />}
            Create passkey
          </button>
        </form>
      )}

      {(status === "invalid" || status === "full") && (
        <div className="login-body">
          <p className="notice">
            {status === "full"
              ? "There are no places left. Message the person who invited you."
              : "This link was already used or has expired. Ask for a new one."}
          </p>
          {error && <p className="notice notice-error">{error}</p>}
          <a className="button" href="/login">
            I already have an account
          </a>
        </div>
      )}
    </main>
  );
}
