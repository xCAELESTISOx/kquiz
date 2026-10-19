import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "./rateLimit.js";

describe("rateLimit", () => {
  const make = (maxKeys?: number) => {
    let t = 0;
    const app = new Hono();
    app.use(rateLimit({ limit: 2, windowMs: 1000, key: (c) => c.req.header("cf-connecting-ip") ?? "x", maxKeys, now: () => t }));
    app.get("/", (c) => c.text("ok"));
    const hit = (ip: string) => app.request("/", { headers: { "cf-connecting-ip": ip } }).then((r) => r.status);
    return { hit, advance: (ms: number) => (t += ms) };
  };

  it("limits each client per window", async () => {
    const { hit, advance } = make();
    expect([await hit("a"), await hit("a"), await hit("a"), await hit("b")]).toEqual([200, 200, 429, 200]);
    advance(1000);
    expect(await hit("a")).toBe(200);
  });

  it("fails closed when too many clients are tracked", async () => {
    const { hit, advance } = make(2);
    expect([await hit("a"), await hit("b"), await hit("c")]).toEqual([200, 200, 429]);
    advance(1000);
    expect(await hit("c")).toBe(200);
  });
});
