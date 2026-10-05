import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";

const webUrl = "http://127.0.0.1:18998";
const publicApi = "http://127.0.0.1:19998";
let server: ChildProcess;
test.beforeAll(async () => {
  server = spawn(process.execPath, ["scripts/serve.mjs"], { env: { ...process.env, WEB_PORT: "18998", APP_ENV: "production", PUBLIC_API_BASE_URL: publicApi }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => { server.stdout?.once("data", () => resolve()); server.once("error", reject); server.once("exit", (code) => reject(new Error(`Web exited before readiness: ${code}`))); });
});
test.afterAll(async () => { if (server && server.exitCode === null) { const exit = new Promise<void>((resolve) => server.once("exit", () => resolve())); server.kill(); await exit; } });
test("production browser uses runtime API config from the same built artifact", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${publicApi}/**`, (route) => route.fulfill({ status: 401, json: { code: "UNAUTHORIZED", message: "Login required" } }));
  const requested = page.waitForRequest(`${publicApi}/auth/me`);
  await page.goto(webUrl);
  expect((await requested).url()).toBe(`${publicApi}/auth/me`);
  await expect(page.locator("form").getByRole("button", { name: "로그인", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("malformed requests do not kill production web and config is uncached", async ({ request }) => {
  expect((await request.get(`${webUrl}/%`)).status()).toBe(400);
  expect((await request.get(webUrl)).status()).toBe(200);
  const config = await request.get(`${webUrl}/runtime-config.js`);
  expect(config.headers()["cache-control"]).toBe("no-store");
  expect(await config.text()).toContain(publicApi);
});
