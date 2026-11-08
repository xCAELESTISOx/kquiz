import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState, type FormEvent } from "react";
import { auth, setCsrfToken } from "../lib/api";
import { safeReturnTo } from "../lib/router";
import { Spinner } from "../ui/Spinner";

type Phase = "checking" | "login" | "setup";

const SERVER_ERRORS: Record<string, string> = {
  forbidden: "Wrong setup code. The server prints it to its log on first start.",
  challenge_expired: "The request expired. Tap the button again.",
  verification_failed: "That passkey didn't work. Try again.",
  setup_required: "Set up a passkey first.",
};

function errorText(error: unknown): string {
  const { name, message } = (error ?? {}) as Partial<Error>;
  if (name === "NotAllowedError" || name === "AbortError") return "Sign-in canceled. Tap the button again.";
  if (name === "InvalidStateError") return "This passkey is already set up.";
  return (message ? SERVER_ERRORS[message] : undefined) ?? (message ? `Something went wrong: ${message}` : "Couldn't sign in.");
}

export function LoginScreen() {
  const params = new URLSearchParams(location.search);
  // fresh=1 comes from the OAuth consent for Claude: ask for the passkey even with a live session.
  const fresh = params.get("fresh") === "1";
  const returnTo = safeReturnTo(params.get("return_to"));

  const [phase, setPhase] = useState<Phase>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [setupCode, setSetupCode] = useState("");

  useEffect(() => {
    document.title = "Sign in · KQuiz";
    auth.status().then(
      (status) => {
        if (status.setupRequired) setPhase("setup");
        else if (status.authenticated && !fresh) location.replace(returnTo);
        else setPhase("login");
      },
      (e) => {
        setError(errorText(e));
        setPhase("login");
      },
    );
  }, [fresh, returnTo]);

  async function login() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const optionsJSON = (await auth.loginOptions()) as unknown as Parameters<typeof startAuthentication>[0]["optionsJSON"];
      const response = await startAuthentication({ optionsJSON });
      const result = await auth.loginVerify(response);
      setCsrfToken(result.csrfToken);
      location.replace(returnTo);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const code = setupCode.trim();
    if (!code) return setError("Enter the setup code from the server log.");
    setBusy(true);
    setError(undefined);
    try {
      const optionsJSON = (await auth.registerOptions({ setupCode: code })) as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"];
      const response = await startRegistration({ optionsJSON });
      const result = await auth.registerVerify({ setupCode: code }, response);
      setCsrfToken(result.csrfToken);
      location.replace(returnTo);
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

      {phase === "checking" && <div className="login-body" aria-busy="true" />}

      {phase === "login" && (
        <div className="login-body">
          <p className="muted">
            {fresh ? "Confirm it's you to give Claude access to your cards." : "Sign in with a passkey: Face ID or your phone's passcode."}
          </p>
          <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
          <button type="button" className="button primary" disabled={busy} onClick={login}>
            {busy && <Spinner />}
            Sign in with Face ID
          </button>
        </div>
      )}

      {phase === "setup" && (
        <form className="login-body" onSubmit={register}>
          <p className="muted">First start. Enter the setup code from the server log, and this phone becomes your sign-in key.</p>
          <label className="field">
            <span className="field-label">Setup code</span>
            <input
              className="input"
              name="setupCode"
              autoComplete="one-time-code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. 4F9K-2QX7…"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
            />
          </label>
          <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
          <button type="submit" className="button primary" disabled={busy}>
            {busy && <Spinner />}
            Create passkey
          </button>
        </form>
      )}
    </main>
  );
}
