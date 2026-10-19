import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rate-limit.js";

describe("rateLimit", () => {
  it("blocks requests over the limit until the window resets", async () => {
    let clock = 0;
    const app = new Hono().get("/", rateLimit(2, 60_000, () => clock), (c) => c.text("ok"));
    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
    const blocked = await app.request("/");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    clock = 60_000;
    expect((await app.request("/")).status).toBe(200);
  });
});
