import { beforeEach, describe, expect, it } from "vitest";
import { prefetchPictures, resetPrefetched } from "./pictureCache";

describe("fetching a session's pictures ahead", () => {
  beforeEach(resetPrefetched);

  it("fetches each picture once, a few at a time, and skips words without one", async () => {
    const seen: string[] = [];
    let running = 0;
    let most = 0;
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return new Response("x");
    }) as unknown as typeof fetch;
    const urls = ["/api/pictures/a", undefined, "/api/pictures/b", "/api/pictures/a", null, "/api/pictures/c", "/api/pictures/d", "/api/pictures/e"];
    await prefetchPictures(urls, fetchImpl);
    expect(seen.sort()).toEqual(["/api/pictures/a", "/api/pictures/b", "/api/pictures/c", "/api/pictures/d", "/api/pictures/e"]);
    expect(most).toBeLessThanOrEqual(3);
    // The next session's words already fetched are not fetched again.
    await prefetchPictures(["/api/pictures/b", "/api/pictures/f"], fetchImpl);
    expect(seen).toHaveLength(6);
  });

  it("tries a picture again next time when it didn't come", async () => {
    let calls = 0;
    const failing = (async () => {
      calls++;
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    await prefetchPictures(["/api/pictures/a"], failing);
    await prefetchPictures(["/api/pictures/a"], failing);
    expect(calls).toBe(2);
  });
});
