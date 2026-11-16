import { useEffect, useRef, useState } from "react";
import { forgetRemembered, pictureLibrary } from "../lib/api";
import { batches, fitForUpload, readPack, toBase64 } from "../lib/picturePack";
import type { PictureImportResult } from "../lib/types";
import "../ui/card-image.css";
import { Spinner } from "../ui/Spinner";

// The owner's picture library: a pack of words with a picture each. A card whose word is in the
// library shows that picture; importing a pack again with new pictures replaces them everywhere.

type Progress = { done: number; total: number };

export function PicturesScreen() {
  const [total, setTotal] = useState<number>();
  const [error, setError] = useState<string>();
  const [progress, setProgress] = useState<Progress>();
  const [result, setResult] = useState<PictureImportResult & { skipped: string[] }>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "Pictures · KQuiz";
    pictureLibrary.get().then(
      (r) => setTotal(r.total),
      (e: Error) => setError(e.message),
    );
  }, []);

  async function importPack(file: File) {
    setError(undefined);
    setResult(undefined);
    try {
      const { words, skipped } = readPack(new Uint8Array(await file.arrayBuffer()));
      if (!words.length) throw new Error("No words with pictures in this pack.");
      const sum: PictureImportResult & { skipped: string[] } = { added: 0, updated: 0, unchanged: 0, rejected: [], cardsUpdated: 0, total: 0, skipped };
      setProgress({ done: 0, total: words.length });
      for (const batch of batches(words)) {
        const entries = await Promise.all(
          batch.map(async ({ file: picture, ...word }) => ({ ...word, data: toBase64(await fitForUpload(picture)) })),
        );
        const r = await pictureLibrary.add(entries);
        sum.added += r.added;
        sum.updated += r.updated;
        sum.unchanged += r.unchanged;
        sum.cardsUpdated += r.cardsUpdated;
        sum.rejected.push(...r.rejected);
        sum.total = r.total;
        setTotal(r.total);
        setProgress((p) => p && { ...p, done: p.done + batch.length });
      }
      // Cards on screen elsewhere were remembered without their new pictures.
      forgetRemembered();
      setResult(sum);
    } catch (e) {
      setError((e as Error).message === "forbidden" ? "Only the owner can add pictures." : (e as Error).message);
    } finally {
      setProgress(undefined);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <main className="screen">
      <header className="screen-header">
        <h1 className="title">Pictures</h1>
        <p className="subtitle">{total === undefined ? " " : total ? `${total} words have a picture` : "No pictures yet"}</p>
      </header>

      <div aria-live="polite">{error && <p className="notice notice-error">{error}</p>}</div>

      <section className="access-invite">
        <p>
          A picture pack is a .zip with cards.json or cards.csv (ko, ru, image) and the pictures. Words from the pack aren't added to
          your cards: a word you have or add later simply shows its picture. Importing a pack again updates the pictures.
        </p>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importPack(file);
          }}
        />
        <button type="button" className="button primary" disabled={!!progress} onClick={() => input.current?.click()}>
          {progress && <Spinner />}
          {progress ? `Adding ${progress.done} of ${progress.total}` : "Import a picture pack"}
        </button>
        {progress && (
          <div className="import-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <span style={{ width: `${(100 * progress.done) / progress.total}%` }} />
          </div>
        )}
      </section>

      {result && (
        <section className="access-notes small">
          <p>
            New pictures: {result.added}, updated: {result.updated}, already there: {result.unchanged}. Your cards that got a new picture:{" "}
            {result.cardsUpdated}.
          </p>
          {(result.rejected.length > 0 || result.skipped.length > 0) && (
            <p className="muted">
              Not added ({result.rejected.length + result.skipped.length}):{" "}
              {[...result.rejected.map((r) => `${r.korean} (${r.reason})`), ...result.skipped].slice(0, 20).join(", ")}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
