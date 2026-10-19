import { useEffect, useState, type CSSProperties } from "react";
import { access } from "../lib/api";
import { cardsCount } from "../lib/plural";
import type { AccessInfo, AccessUser } from "../lib/types";
import { Spinner } from "../ui/Spinner";

// The owner's screen: invite a friend by a one-time link, see who uses the app, switch someone off.

function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "дня" : "дней";
}

function ago(iso: string | null): string {
  if (!iso) return "ещё не входил";
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "входил сегодня";
  if (days === 1) return "входил вчера";
  return `входил ${days} ${daysWord(days)} назад`;
}

function userLine(user: AccessUser): string {
  const cards = cardsCount(user.cards);
  return user.disabled ? `${cards} · отключён` : `${cards} · ${ago(user.lastSignInAt)}`;
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
      (e: Error) => setError(e.message === "forbidden" ? "Этот раздел только для владельца." : e.message),
    );

  useEffect(() => {
    document.title = "Доступ · KQuiz";
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
    const text = "Учи корейский со мной в KQuiz. Ссылка работает один раз в течение суток:";
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
    if (!confirm(`Удалить ${user.name} и все его карточки, повторения и статистику? Вернуть будет нельзя.`)) return;
    void run(`remove-${user.id}`, () => access.remove(user.id));
  };

  const full = info ? info.users.length >= info.maxUsers : false;

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title">Доступ</h1>
        <p className="subtitle">Кто ещё учится в KQuiz</p>
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
                    {user.role === "owner" && <span className="muted"> · ты</span>}
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
                          Включить
                        </button>
                        <button type="button" className="chip-button danger" disabled={Boolean(busy)} onClick={() => remove(user)}>
                          Удалить
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="chip-button"
                        disabled={Boolean(busy)}
                        onClick={() => void run(`disable-${user.id}`, () => access.disable(user.id))}
                      >
                        Отключить
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
                <p>Ссылка для друга. Она сработает один раз в течение суток, потом нужна новая.</p>
                <code className="access-link">{link}</code>
                <div className="action-pair">
                  <button type="button" className="button primary" onClick={() => void share()}>
                    Отправить
                  </button>
                  <button type="button" className="button" onClick={() => void copy()}>
                    {copied ? "Скопировано" : "Скопировать"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  {full
                    ? `Больше ${info.maxUsers} человек сервер не пускает. Чтобы пригласить ещё кого-то, удали отключённого.`
                    : "Друг откроет ссылку на своём телефоне, напишет имя и создаст passkey. Его карточки и статистику не видишь ты, а он не видит твои."}
                </p>
                <button type="button" className="button primary" disabled={full || Boolean(busy)} onClick={() => void invite()}>
                  {busy === "invite" && <Spinner />}
                  Пригласить
                </button>
              </>
            )}
            {info.invites.length > 0 && (
              <p className="muted small">
                Неиспользованных ссылок: {info.invites.length}.{" "}
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
                  Отменить
                </button>
              </p>
            )}
          </section>

          <section className="access-notes muted small">
            <p>
              У друзей есть лимиты, чтобы сервер не перегружался: {info.memberLimits.cardsPerDay} новых карточек и{" "}
              {info.memberLimits.scoresPerDay} проверок произношения в сутки. У тебя лимитов нет.
            </p>
            <p>
              Свой Claude друг может подключить сам: коннектор по адресу <code>{location.origin}/mcp</code>. Claude
              увидит только его карточки.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
