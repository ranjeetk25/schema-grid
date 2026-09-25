/** Tiny static server for `storybook-static` (Playwright webServer). */
import { join, normalize } from "node:path";

const root = join(import.meta.dir, "..", "storybook-static");
const port = Number(process.argv[2] ?? 6007);

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const rel = normalize(decodeURIComponent(url.pathname)).replace(
      /^(\.\.[/\\])+/,
      "",
    );
    const file = Bun.file(join(root, rel === "/" ? "index.html" : rel));
    return (await file.exists())
      ? new Response(file)
      : new Response("not found", { status: 404 });
  },
});
console.error(`storybook-static served on http://localhost:${port}`);
