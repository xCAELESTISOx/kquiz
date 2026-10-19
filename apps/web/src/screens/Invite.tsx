import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState, type FormEvent } from "react";
import { auth, setCsrfToken } from "../lib/api";
import type { InviteStatus } from "../lib/types";
import { Spinner } from "../ui/Spinner";

// A friend opens the owner's one-time link, gives a name and makes a passkey: that is their account.
const SERVER_ERRORS: Record<string, string> = {
  forbidden: "Ссылка уже не работает. Попроси новую.",
  challenge_expired: "Запрос устарел. Нажми кнопку ещё раз.",
  verification_failed: "Passkey не создался. Попробуй ещё раз.",
};

function errorText(error: unknown): string {
  const { name, message } = (error ?? {}) as Partial<Error>;
  if (name === "NotAllowedError" || name === "AbortError") return "Отменено. Нажми кнопку ещё раз.";
  if (name === "InvalidStateError") return "На этом телефоне уже есть passkey для KQuiz. Войди им.";
  return (message ? SERVER_ERRORS[message] : undefined) ?? (message ? `Не получилось: ${message}` : "Не получилось.");
}

export function InviteScreen({ code }: { code: string }) {
  const [status, setStatus] = useState<InviteStatus>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    document.title = "Приглашение · KQuiz";
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
    if (!userName) return setError("Напиши, как тебя зовут.");
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
            Тебя пригласили учить корейский в KQuiz. Карточки, повторения и статистика будут твои, их никто не увидит.
            Вход по passkey: Face ID или код телефона.
          </p>
          <label className="field">
            <span className="field-label">Как тебя зовут</span>
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
            Создать passkey
          </button>
        </form>
      )}

      {(status === "invalid" || status === "full") && (
        <div className="login-body">
          <p className="notice">
            {status === "full"
              ? "Мест больше нет. Напиши тому, кто тебя пригласил."
              : "Эта ссылка уже использована или устарела. Попроси новую."}
          </p>
          {error && <p className="notice notice-error">{error}</p>}
          <a className="button" href="/login">
            У меня уже есть вход
          </a>
        </div>
      )}
    </main>
  );
}
