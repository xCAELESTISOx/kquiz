import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("api", () => {
  it("answers health checks", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("previews bulk input", async () => {
    const res = await app.request("/api/cards/bulk/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "물 — вода" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cards: unknown[] };
    expect(body.cards).toHaveLength(1);
  });
});
