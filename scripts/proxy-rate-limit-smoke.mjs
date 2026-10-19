import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

// Uses only invalid login input; no DB writes, credentials or external requests.
const apiImage = process.env.PROXY_SMOKE_API_IMAGE;
assert(apiImage, "Set PROXY_SMOKE_API_IMAGE to the locally built final API image");
const caddyImage = process.env.PROXY_SMOKE_CADDY_IMAGE ?? "caddy:2-alpine";
const clientImage = process.env.PROXY_SMOKE_CLIENT_IMAGE ?? "node:24-slim";
const prefix = `postbot-proxy-smoke-${process.pid}`;
const network = `${prefix}-net`;
const subnet = process.env.PROXY_SMOKE_SUBNET ?? "172.30.251.0/24";
const base = subnet.split(".").slice(0, 3).join(".");
const artifactDir = resolve(process.env.PROXY_SMOKE_REPORT_DIR ?? ".artifacts/proxy-smoke");
mkdirSync(artifactDir, { recursive: true });
const docker = (args, check = true) => {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
  if (check && result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr}`);
  return (args[0] === "logs" ? result.stdout + result.stderr : result.stdout).trim();
};
const clientSource = `
import http from 'node:http';
const statuses=[];
for(let i=0;i<Number(process.env.COUNT);i++) {
  const status=await new Promise((resolve,reject)=> {
    const req=http.request('http://'+process.env.TARGET+'/auth/login', {
      method:'POST',headers:{host:'proxy.test','content-type':'application/json',
        'x-forwarded-for': '198.51.100.'+(i+1)+', 203.0.113.1'}
    },res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject); req.end('{}');
  }); statuses.push(status);
} console.log(JSON.stringify(statuses));
`;
// /api prefix is stripped by the actual production Caddyfile.
const proxiedSource = clientSource.replace("+'/auth/login'", "+'/api/auth/login'");
const client = (ip, count, proxied) => JSON.parse(docker([
  "run", "--rm", "--network", network, "--ip", `${base}.${ip}`,
  "-e", `COUNT=${count}`, "-e", `TARGET=${prefix}-${proxied ? "proxy" : "api"}:` + (proxied ? "80" : "3000"),
  "--entrypoint", "node", clientImage, "--input-type=module", "-e", proxied ? proxiedSource : clientSource
]));
const report = {};
try {
  docker(["network", "create", "--subnet", subnet, network]);
  docker(["run", "-d", "--name", `${prefix}-api`, "--network", network, "--ip", `${base}.3`, "--network-alias", "api-ingress",
    "-e", `API_TRUSTED_PROXY=${base}.2`, "-e", "APP_ENV=test", "-e", "STORAGE_PROVIDER=fake", "--entrypoint", "node", apiImage, "dist/main.js"]);
  docker(["run", "-d", "--name", `${prefix}-proxy`, "--network", network, "--ip", `${base}.2`,
    "-e", "POSTBOT_DOMAIN=http://proxy.test", "-e", "POSTBOT_STORAGE_DOMAIN=http://storage.test",
    "-e", "POSTBOT_STORAGE_UPSTREAM=unused:9000", "--mount", `type=bind,source=${resolve("infra/Caddyfile")},target=/etc/caddy/Caddyfile,readonly`, caddyImage]);
  // Wait for the actual app and Caddy startup without consuming the login bucket.
  docker(["run", "--rm", "--network", network, "--entrypoint", "node", clientImage, "--input-type=module", "-e",
    `for(let i=0;i<60;i++){try{const r=await fetch('http://${prefix}-api:3000/health');if(r.ok)process.exit(0);}catch{}await new Promise(r=>setTimeout(r,500));}process.exit(1);`]);
  report.clientA = client(10, 61, true);
  assert.deepEqual(report.clientA, [...Array(60).fill(400), 429], "same IP must hit the 60/min limit even with varying forged XFF");
  report.clientB = client(11, 61, true);
  assert.deepEqual(report.clientB, [...Array(60).fill(400), 429], "a different source IP must have its own allowance");
  report.direct = client(12, 61, false);
  assert.deepEqual(report.direct, [...Array(60).fill(400), 429], "untrusted direct peers cannot bypass limits with forged XFF");
  report.status = "PASS";
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = "FAIL";
  report.error = error instanceof Error ? error.message : "Unknown failure";
  throw error;
} finally {
  writeFileSync(resolve(artifactDir, "report.json"), JSON.stringify(report, null, 2));
  // Invalid-input fixtures only; never run this harness against production.
  for (const service of ["api", "proxy"]) {
    writeFileSync(resolve(artifactDir, `${service}.log`), docker(["logs", `${prefix}-${service}`], false));
    docker(["rm", "-f", `${prefix}-${service}`], false);
  }
  docker(["network", "rm", network], false);
}
