import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Files from public/ that the app loads on its own and so are worth having in the cache up front.
const PUBLIC_PRECACHE = ["/manifest.webmanifest", "/recorder-worklet.js", "/favicon.svg"];

/**
 * Emits sw.js (the service worker, see sw.js) with this build's version and the files to precache:
 * index.html, the scripts and styles. Fonts are left out, since the page needs only a few of the
 * subsets; the worker caches those as they are used.
 */
function serviceWorker(): Plugin {
  return {
    name: "kquiz-service-worker",
    apply: "build",
    // After Vite's own plugins, so index.html is in the bundle.
    enforce: "post",
    generateBundle(_, bundle) {
      const built = Object.keys(bundle)
        .filter((file) => file === "index.html" || /\.(js|css)$/.test(file))
        .map((file) => `/${file}`)
        .sort();
      const precache = [...built, ...PUBLIC_PRECACHE];
      // Built names carry content hashes; index.html and public/ files don't, so their contents go in.
      const hash = createHash("sha256").update(precache.join("\n"));
      const index = bundle["index.html"];
      if (index?.type === "asset") hash.update(index.source);
      for (const file of PUBLIC_PRECACHE) hash.update(readFileSync(new URL(`./public${file}`, import.meta.url)));
      const source = readFileSync(new URL("./sw.js", import.meta.url), "utf8");
      const version = hash.update(source).digest("hex").slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: source.replace("const BUILD = __BUILD__;", `const BUILD = ${JSON.stringify({ version, precache })};`),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
