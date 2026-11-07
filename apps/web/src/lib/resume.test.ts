import { afterEach, describe, expect, it, vi } from "vitest";

// A stand-in for the page: visible or not, with visibilitychange.
function fakeDocument() {
  const target = new EventTarget();
  const doc = Object.assign(target, { hidden: false });
  return {
    doc,
    hide() {
      doc.hidden = true;
      target.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      doc.hidden = false;
      target.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

async function load() {
  vi.resetModules();
  const page = fakeDocument();
  vi.stubGlobal("document", page.doc);
  vi.stubGlobal("location", { pathname: "/", search: "", hash: "", assign: vi.fn() });
  const api = await import("./api");
  return { page, ...api };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("requests cut off while the app is away", () => {
  it("are sent again once the app is back, with no error", async () => {
    const { page, request } = await load();
    const fetch = vi.fn().mockImplementationOnce(async () => {
      page.hide();
      throw new TypeError("Load failed");
    });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const answer = request("GET", "/x");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    page.show();
    await expect(answer).resolves.toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a change goes out again only when it may", async () => {
    const { page, request, isConnectionError } = await load();
    const fetch = vi.fn(async () => {
      page.hide();
      page.show();
      throw new TypeError("Load failed");
    });
    vi.stubGlobal("fetch", fetch);
    const error = await request("POST", "/auth/x", { body: {} }).catch((e: unknown) => e);
    expect(isConnectionError(error)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("an ordinary network failure is a plain connection error, tried once", async () => {
    const { request, NO_CONNECTION } = await load();
    const fetch = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetch);
    await expect(request("GET", "/x")).rejects.toThrow(NO_CONNECTION);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
