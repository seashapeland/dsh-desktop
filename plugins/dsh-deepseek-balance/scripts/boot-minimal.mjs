/**
 * Minimal real-activation test: boots a tiny cordis tree (real webServer +
 * a stub credentials service + this plugin) with the REAL cordis runtime and
 * node:http, then issues real HTTP requests against the mounted route.
 *
 * This exercises actual cordis fiber activation, service injection, route
 * registration, and the HTTP handler — without needing the full web profile
 * (which cannot boot on Node < 23.8 because a shipped row imports zlib zstd).
 *
 * Run: node scripts/boot-minimal.mjs [--with-key]
 */
import { Context, Service } from "@deepseek-ai/cordis";
import WebServer from "@deepseek-ai/dsh-host-webserver";
import DeepSeekBalance from "../lib/index.js";

const withKey = process.argv.includes("--with-key");

/** Stub credentials provider: enough of the domain for resolve() to work. */
class StubCredentials extends Service {
	constructor(ctx, config) {
		super(ctx, "credentials");
		this.key = config.key;
	}
	async resolve(ref) {
		return this.key === void 0 ? void 0 : { value: this.key, source: "file" };
	}
	async describe(ref) {
		return { configured: this.key !== void 0, source: this.key === void 0 ? void 0 : "file", writable: true };
	}
}

const ctx = new Context();
const ws = ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 });
ctx.plugin(StubCredentials, { key: withKey ? "sk-e2e-test" : void 0 });
const balance = ctx.plugin(DeepSeekBalance, {
	baseUrl: "https://api.deepseek.com",
	apiKeyRef: "DEEPSEEK_API_KEY",
	route: "/dsh-deepseek-balance"
});
await ws;
await balance;
if (!ctx.webServer) throw new Error("webServer service missing after activation");
const port = ctx.webServer.port;
console.log("tree active; listening on port", port);

const url = `http://127.0.0.1:${port}/dsh-deepseek-balance/api/balance`;
const response = await fetch(url);
const text = await response.text();
let payload;
try {
	payload = JSON.parse(text);
} catch {
	payload = { raw: text.slice(0, 120) };
}
console.log("route status:", response.status);
console.log("route body:", JSON.stringify(payload));

let passed = response.status === 200 && typeof payload.ok === "boolean";
if (withKey) {
	// Sandbox-dependent upstream path: unreachable hosts answer NETWORK, a
	// reachable DeepSeek answers UPSTREAM (the stub key is invalid, 401).
	passed &&= payload.code === "NETWORK" || payload.code === "UPSTREAM";
} else {
	// Without an explicit stub key the plugin may still find one via the
	// process-environment fallback (DEEPSEEK_API_KEY), so a real balance
	// payload is a pass too.
	passed &&= (payload.ok === true && typeof payload.totalBalance === "string")
		|| (payload.ok === false && payload.code === "NO_KEY" && payload.ref === "DEEPSEEK_API_KEY");
}

// A bogus path must fall through to the 404 the server serves (no fallback registered).
const missing = await fetch(`http://127.0.0.1:${port}/dsh-deepseek-balance/nope`);
passed &&= missing.status === 404;

// The usage route must answer JSON with a stable available flag.
const usageRes = await fetch(`http://127.0.0.1:${port}/dsh-deepseek-balance/api/usage`);
const usageText = await usageRes.text();
let usagePayload;
try {
	usagePayload = JSON.parse(usageText);
} catch {
	usagePayload = null;
}
console.log("usage route status:", usageRes.status, "body:", JSON.stringify(usagePayload));
passed &&= usageRes.status === 200 && usagePayload?.ok === true
	&& (usagePayload.available === true || usagePayload.available === false);

await ctx.fiber.dispose();
if (!passed) {
	console.error("minimal boot test FAILED");
	process.exit(1);
}
console.log("minimal boot test: OK");
