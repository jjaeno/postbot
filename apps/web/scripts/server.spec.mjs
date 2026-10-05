import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createWebServer, validatePublicApiUrl } from "./server.mjs";

let root; let server; let base;
before(async () => {
  root = await mkdtemp(join(tmpdir(), "postbot-web-test-"));
  await writeFile(join(root, "index.html"), "<html>Postbot test</html>");
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "fixture.js"), "export const fixture=true;");
  server = createWebServer({ root, apiBaseUrl: "https://api.example.test/" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
test("malformed URI and NUL/backslash return 400 without stopping the server", async () => {
  for (const path of ["/%", "/%FF", "/%00", "/%5cfile"]) assert.equal((await fetch(`${base}${path}`)).status, 400);
  assert.equal((await fetch(base)).status, 200);
});
test("decoded traversal cannot escape the static root", async () => { assert.equal((await fetch(`${base}/..%2foutside`)).status, 400); });
test("runtime config uses the public endpoint and must never be cached", async () => {
  const result = await fetch(`${base}/runtime-config.js`);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.match(await result.text(), /https:\/\/api\.example\.test/);
});
test("SPA routes resolve to HTML but missing assets are 404", async () => {
  assert.equal((await fetch(`${base}/channels/example`)).status, 200);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/missing.css`)).status, 404);
});
test("HEAD omits the body and unsafe methods are rejected", async () => {
  const result = await fetch(base, { method: "HEAD" }); assert.equal(result.status, 200); assert.equal(await result.text(), "");
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
});
test("static JS has the correct MIME and immutable cache", async () => {
  const result = await fetch(`${base}/assets/fixture.js`);
  assert.match(result.headers.get("content-type"), /text\/javascript/);
  assert.match(result.headers.get("cache-control"), /immutable/);
});
test("public URLs cannot contain credentials or script protocols", () => {
  for (const url of ["javascript:alert(1)", "https://user:secret@example.test", "https://example.test?token=secret", "https://example.test#fragment"]) assert.throws(() => validatePublicApiUrl(url));
});
test("symlink outside the static root is not served", async (context) => {
  try { await symlink(tmpdir(), join(root, "outside"), "junction"); }
  catch (error) { if (error.code === "EPERM") { context.skip("OS denies symlink creation"); return; } throw error; }
  assert.equal((await fetch(`${base}/outside`)).status, 400);
});
