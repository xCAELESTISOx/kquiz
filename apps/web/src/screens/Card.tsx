import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api, remembered } from "../lib/api";
import { isKoreanOnly } from "../lib/korean";
import { canSpeak, speak } from "../lib/speech";
import { REGISTER_LABELS } from "../lib/phrase";
import type { Card, CardPatch, Example, Register } from "../lib/types";
import { BackIcon, LearnIcon, SpeakerIcon } from "../ui/icons";
import { Menu, MenuItem } from "../ui/Menu";
import { Spinner } from "../ui/Spinner";
import { PhraseParts } from "../ui/PhraseParts";
import { useFamily, WordFamily } from "../ui/WordFamily";
import { lastCardsHash } from "./Cards";

const EXAMPLES = 3;

interface Draft {
  korean: string;
  meaning: string;
  pronunciation: string;
  romanization: string;
  notes: string;
  tags: string;
  examples: Example[];
  speakable: boolean;
  suspended: boolean;
  register: Register | null;
}

function toDraft(card: Card): Draft {
  return {
    korean: card.korean,
    meaning: card.meaning,
    pronunciation: card.pronunciation ?? "",
    romanization: card.romanization ?? "",
    notes: card.notes ?? "",
    tags: card.tags.join(", "),
    examples: Array.from({ length: EXAMPLES }, (_, i) => card.examples[i] ?? { ko: "", ru: "" }),
    speakable: card.speakable,
    suspended: card.suspended,
    register: card.register,
  };
}

const splitTags = (text: string) => [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];
const fullExamples = (list: Example[]) =>
  list.map((e) => ({ ko: e.ko.trim(), ru: e.ru.trim() })).filter((e) => e.ko || e.ru);

/** Only what changed, so an edit never overwrites a field Claude updated meanwhile. */
function diff(card: Card, draft: Draft): CardPatch {
  const before = toDraft(card);
  const patch: CardPatch = {};
  for (const key of ["korean", "meaning", "pronunciation", "romanization", "notes"] as const) {
    if (draft[key].trim() !== before[key].trim()) patch[key] = draft[key].trim();
  }
  if (splitTags(draft.tags).join("\n") !== card.tags.join("\n")) patch.tags = splitTags(draft.tags);
  const examples = fullExamples(draft.examples);
  if (JSON.stringify(examples) !== JSON.stringify(card.examples)) patch.examples = examples;
  if (draft.speakable !== card.speakable) patch.speakable = draft.speakable;
  if (draft.suspended !== card.suspended) patch.suspended = draft.suspended;
  if (draft.register && draft.register !== card.register) patch.register = draft.register;
  return patch;
}

function back() {
  location.hash = lastCardsHash;
}

export function CardScreen({ id }: { id: number }) {
  // The card as seen in the list shows at once; the server's copy follows.
  const [seen] = useState(() => remembered.card(id));
  const [card, setCard] = useState<Card | undefined>(seen);
  const [draft, setDraft] = useState<Draft | undefined>(() => seen && toDraft(seen));
  const [busy, setBusy] = useState<"save" | "delete" | "introduce">();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const families = useFamily(card);

  useEffect(() => {
    api.card(id).then(
      ({ card }) => {
        setCard(card);
        // Edits already begun on the early copy are kept.
        setDraft((d) => (d && seen && Object.keys(diff(seen, d)).length > 0 ? d : toDraft(card)));
        document.title = `${card.korean} · KQuiz`;
      },
      (e: Error) => setError(e.message === "not_found" ? "Такой карточки нет. Может, её уже удалили." : e.message),
    );
  }, [id]);

  const patch = useMemo(() => (card && draft ? diff(card, draft) : {}), [card, draft]);
  const dirty = Object.keys(patch).length > 0;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => d && { ...d, [key]: value });
    setSaved(false);
  }

  function setExample(index: number, side: keyof Example, value: string) {
    setDraft((d) => d && { ...d, examples: d.examples.map((e, i) => (i === index ? { ...e, [side]: value } : e)) });
    setSaved(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!card || !draft || !dirty || busy) return;
    if (!draft.korean.trim() || !draft.meaning.trim()) return setError(`${card.kind === "phrase" ? "Фраза" : "Слово"} и перевод не могут быть пустыми`);
    if (fullExamples(draft.examples).some((e) => !e.ko || !e.ru)) return setError("У каждого примера нужен и перевод");
    setBusy("save");
    setError(undefined);
    try {
      const result = await api.updateCard(card.id, patch);
      if (result.status === "duplicate") {
        setError(`Карточка «${draft.korean.trim()}» уже есть`);
      } else {
        setCard(result.card);
        setDraft(toDraft(result.card));
        setSaved(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  async function remove() {
    if (!card || busy) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy("delete");
    try {
      await api.deleteCard(card.id);
      back();
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  }

  async function introduce() {
    if (!card || busy) return;
    setBusy("introduce");
    try {
      const res = await api.introduceCard(card.id);
      setCard(res.card);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  const readyForSpeech = draft ? isKoreanOnly(draft.korean.trim()) : true;

  return (
    <main className="screen card-screen">
      <header className="card-top">
        <a
          className="icon-button"
          href={lastCardsHash}
          aria-label="К списку карточек"
          onClick={(e) => {
            e.preventDefault();
            back();
          }}
        >
          <BackIcon />
        </a>
        {card && (
          <div className="card-top-actions">
            {canSpeak() && (
              <button type="button" className="icon-button" aria-label="Послушать" onClick={() => speak(card)}>
                <SpeakerIcon />
              </button>
            )}
            {card.kind === "word" && (
              <Menu label="Ещё">
                <MenuItem href={`#/learn/${card.id}`} icon={<LearnIcon />} hint="Заучить слово по шагам, не трогая статистику">
                  Учить
                </MenuItem>
              </Menu>
            )}
          </div>
        )}
      </header>

      {!card && !error && <div className="skeleton" aria-busy="true" />}
      {!card && error && <p className="notice notice-error">{error}</p>}

      {card && draft && (
        <form className="form" onSubmit={save}>
          {card.queued && (
            <div className="queue-note">
              <p>
                <strong>Ждёт в очереди новых.</strong>
                <span className="muted"> Войдёт в повторение сама, в свой день.</span>
              </p>
              <button type="button" className="chip-button" disabled={!!busy} onClick={() => void introduce()}>
                {busy === "introduce" && <Spinner />}
                Учить сейчас
              </button>
            </div>
          )}

          {card.roots && card.roots.length > 0 && (
            <div className="field">
              <span className="field-label">Корни</span>
              <WordFamily card={card} families={families} />
            </div>
          )}

          {card.kind === "phrase" && (
            <div className="field">
              <span className="field-label">Фраза по частям</span>
              {card.parts?.length ? (
                <PhraseParts card={card} />
              ) : (
                <p className="muted small">Разбора пока нет. Попроси Claude разобрать фразу.</p>
              )}
            </div>
          )}

          <label className="field">
            <span className="field-label">{card.kind === "phrase" ? "Фраза по-корейски" : "По-корейски"}</span>
            <input
              className="input input-korean"
              lang="ko"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={draft.korean}
              onChange={(e) => set("korean", e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Перевод</span>
            <input className="input" autoComplete="off" value={draft.meaning} onChange={(e) => set("meaning", e.target.value)} />
          </label>

          <div className="field-pair">
            <label className="field">
              <span className="field-label">Произношение</span>
              <input
                className="input"
                lang="ko"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="как пишется"
                value={draft.pronunciation}
                onChange={(e) => set("pronunciation", e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Латиницей</span>
              <input
                className="input"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={draft.romanization}
                onChange={(e) => set("romanization", e.target.value)}
              />
            </label>
          </div>

          {card.kind === "phrase" && (
            <fieldset className="register-edit">
              <legend className="field-label">Вежливость</legend>
              <div className="register-options">
                {(Object.keys(REGISTER_LABELS) as Register[]).map((r) => (
                  <button key={r} type="button" className="chip" aria-pressed={draft.register === r} onClick={() => set("register", r)}>
                    {REGISTER_LABELS[r]}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {card.kind === "word" && (
            <fieldset className="examples-edit">
              <legend className="field-label">Примеры</legend>
              {draft.examples.map((example, i) => (
                <div key={i} className="example-edit">
                  <input
                    className="input"
                    lang="ko"
                    autoComplete="off"
                    aria-label={`Пример ${i + 1}`}
                    placeholder={`Пример ${i + 1}`}
                    value={example.ko}
                    onChange={(e) => setExample(i, "ko", e.target.value)}
                  />
                  <input
                    className="input input-sub"
                    autoComplete="off"
                    aria-label={`Перевод примера ${i + 1}`}
                    placeholder="перевод"
                    value={example.ru}
                    onChange={(e) => setExample(i, "ru", e.target.value)}
                  />
                </div>
              ))}
            </fieldset>
          )}

          <label className="field">
            <span className="field-label">{card.kind === "phrase" ? "Когда говорят" : "Заметка"}</span>
            <textarea className="input textarea" rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Теги через запятую</span>
            <input
              className="input"
              autoComplete="off"
              autoCapitalize="off"
              value={draft.tags}
              onChange={(e) => set("tags", e.target.value)}
            />
          </label>

          <div className="toggles">
            {card.kind === "word" && (
              <Toggle
                checked={draft.speakable && readyForSpeech}
                disabled={!readyForSpeech}
                onChange={(v) => set("speakable", v)}
                label="Тренировать произношение"
                hint={readyForSpeech ? "Карточка попадает в «Произношение»" : "Только для слов из одного хангыля"}
              />
            )}
            <Toggle
              checked={draft.suspended}
              onChange={(v) => set("suspended", v)}
              label="На паузе"
              hint="Не показывается в повторении, расписание сохраняется"
            />
          </div>

          <div aria-live="polite">
            {error && <p className="notice notice-error">{error}</p>}
            {saved && !dirty && <p className="notice notice-ok">Сохранено</p>}
          </div>

          <button type="button" className={`danger-button${confirmDelete ? " is-armed" : ""}`} disabled={!!busy} onClick={() => void remove()}>
            {busy === "delete" && <Spinner />}
            {confirmDelete ? "Точно удалить? Нажми ещё раз" : "Удалить карточку"}
          </button>

          <div className="bottom-actions">
            <button className="button primary" type="submit" disabled={!dirty || !!busy}>
              {busy === "save" && <Spinner />}
              Сохранить
            </button>
          </div>
        </form>
      )}
    </main>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: ReactNode;
}) {
  return (
    <label className={`toggle${disabled ? " is-disabled" : ""}`}>
      <span className="toggle-text">
        <span>{label}</span>
        <span className="muted small">{hint}</span>
      </span>
      <input type="checkbox" role="switch" className="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
