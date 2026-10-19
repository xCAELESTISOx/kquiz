import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState, type FormEvent } from "react";
import { auth, setCsrfToken } from "../lib/api";
import { safeReturnTo } from "../lib/router";
import { Spinner } from "../ui/Spinner";

type Phase = "checking" | "login" | "setup";

const SERVER_ERRORS: Record<string, string> = {
  forbidden: "Код настройки не подошёл. Он напечатан в логе сервера при первом запуске.",
  challenge_expired: "Запрос устарел. Нажми кнопку ещё раз.",
  verification_failed: "Passkey не подошёл. Попробуй ещё раз.",
  setup_required: "Сначала нужно привязать passkey.",
};

function errorText(error: unknown): string {
  const { name, message } = (error ?? {}) as Partial<Error>;
  if (name === "NotAllowedError" || name === "AbortError") return "Вход отменён. Нажми кнопку ещё раз.";
  if (name === "InvalidStateError") return "Этот passkey уже привязан.";
  return (message ? SERVER_ERRORS[message] : undefined) ?? (message ? `Не получилось: ${message}` : "Не получилось войти.");
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
    document.title = "Вход · KQuiz";
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
    if (!code) return setError("Впиши код настройки из лога сервера.");
    setBusy(true);
    setError(undefined);
    try {
      const optionsJSON = (await auth.registerOptions(code)) as unknown as Parameters<typeof startRegistration>[0]["optionsJSON"];
      const response = await startRegistration({ optionsJSON });
      const result = await auth.registerVerify(code, response);
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
            {fresh ? "Подтверди, что это ты, чтобы дать Claude доступ к карточкам." : "Вход по passkey: Face ID или код телефона."}
          </p>
          <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
          <button type="button" className="button primary" disabled={busy} onClick={login}>
            {busy && <Spinner />}
            Войти с Face ID
          </button>
        </div>
      )}

      {phase === "setup" && (
        <form className="login-body" onSubmit={register}>
          <p className="muted">Первый запуск. Введи код настройки из лога сервера, и этот телефон станет ключом входа.</p>
          <label className="field">
            <span className="field-label">Код настройки</span>
            <input
              className="input"
              name="setupCode"
              autoComplete="one-time-code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="например: 4F9K-2QX7…"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
            />
          </label>
          <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>
          <button type="submit" className="button primary" disabled={busy}>
            {busy && <Spinner />}
            Создать passkey
          </button>
        </form>
      )}
    </main>
  );
}
