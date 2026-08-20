/**
 * Host plugin logic harness: instantiates the host half directly with a fake
 * cordis ctx (webServer/credentials), runs its init generator, and drives
 * serve() against stubbed fetch/upstream behavior to verify every response
 * shape for BOTH routes:
 *
 *   balance: NO_KEY, NETWORK, UPSTREAM, success
 *   usage:   NO_KEY, all-404 → UNAVAILABLE, success with data
 *
 * Run: node scripts/smoke-host.mjs
 */
import { Service } from "@deepseek-ai/cordis";
import DeepSeekBalance from "../lib/index.js";

const failures = [];
const check = (name, cond, extra = "") => {
	if (cond) console.log(`  ok  ${name}`);
	else { failures.push(name); console.log(`FAIL  ${name} ${extra}`); }
};

/** Minimal fake request/response objects the handler touches. */
const reqRes = (method = "GET") => {
	const res = {
		writeHead(status, headers) { res.status = status; res.headers = headers; },
		end(body) { res.body = body; }
	};
	return { req: { method }, res };
};
const jsonOf = (r) => { try { return JSON.parse(r.body); } catch { return { parseError: r.body }; } };

/** Build a plugin instance over the given credential/upstream behavior. */
async function makePlugin({ key }) {
	const routes = [];
	const fakeCtx = {
		reflect: { provide: () => {} },
		get: (name) => {
			if (name === "webServer") return {
				register: (route) => { routes.push(route); return () => {}; }
			};
			if (name === "credentials") return { resolve: async () => (key === void 0 ? void 0 : { value: key, source: "file" }) };
			return void 0;
		},
		logger: { info() {}, warn() {} }
	};
	const plugin = new DeepSeekBalance(fakeCtx, {
		baseUrl: "https://api.deepseek.com",
		apiKeyRef: "DEEPSEEK_API_KEY",
		route: "/dsh-deepseek-balance"
	});
	const init = plugin[Service.init]();
	const first = await init.next();
	if (first.done !== false) throw new Error("init generator finished immediately");
	init.return();
	return { plugin, routes };
}

console.log("== routes registered ==");
{
	const { routes } = await makePlugin({ key: void 0 });
	const paths = routes.map((r) => r.path).sort();
	check("balance route", paths.includes("/dsh-deepseek-balance/api/balance"), JSON.stringify(paths));
	check("usage route", paths.includes("/dsh-deepseek-balance/api/usage"), JSON.stringify(paths));
}

console.log("== balance: NO_KEY ==");
{
	const { plugin } = await makePlugin({ key: void 0 });
	const { req, res } = reqRes();
	await plugin.serve(req, res, () => plugin.queryBalance());
	const payload = jsonOf(res);
	check("http 200", res.status === 200);
	check("ok:false", payload.ok === false, JSON.stringify(payload));
	check("code NO_KEY", payload.code === "NO_KEY", payload.code);
	check("ref echoed", payload.ref === "DEEPSEEK_API_KEY");
}

console.log("== balance: SUCCESS ==");
{
	const upstreamBody = JSON.stringify({
		is_available: true,
		balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }]
	});
	const { plugin } = await makePlugin({ key: "sk-test" });
	globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, text: async () => upstreamBody });
	const { req, res } = reqRes();
	await plugin.serve(req, res, () => plugin.queryBalance());
	const payload = jsonOf(res);
	check("ok:true", payload.ok === true);
	check("totalBalance", payload.totalBalance === "110.00");
	check("grantedBalance", payload.grantedBalance === "10.00");
	check("toppedUpBalance", payload.toppedUpBalance === "100.00");
	check("currency", payload.currency === "CNY");
	check("isAvailable", payload.isAvailable === true);
	check("checkedAt", typeof payload.checkedAt === "number");
	delete globalThis.fetch;
}

console.log("== balance: UPSTREAM 401 ==");
{
	const { plugin } = await makePlugin({ key: "sk-bad" });
	globalThis.fetch = () => Promise.resolve({
		ok: false, status: 401,
		text: async () => JSON.stringify({ error: { message: "Invalid API key", type: "authentication_error" } })
	});
	const { req, res } = reqRes();
	await plugin.serve(req, res, () => plugin.queryBalance());
	const payload = jsonOf(res);
	check("ok:false", payload.ok === false);
	check("code UPSTREAM", payload.code === "UPSTREAM");
	check("status 401", payload.status === 401);
	check("message surfaced", payload.message === "Invalid API key", payload.message);
	delete globalThis.fetch;
}

console.log("== balance: NETWORK ==");
{
	const { plugin } = await makePlugin({ key: "sk-net" });
	globalThis.fetch = () => Promise.reject(new TypeError("fetch failed: connection refused"));
	const { req, res } = reqRes();
	await plugin.serve(req, res, () => plugin.queryBalance());
	const payload = jsonOf(res);
	check("ok:false", payload.ok === false);
	check("code NETWORK", payload.code === "NETWORK", payload.code);
	check("message", typeof payload.message === "string" && payload.message.length > 0);
	delete globalThis.fetch;
}

console.log("== usage: NO_KEY ==");
{
	const { plugin } = await makePlugin({ key: void 0 });
	const payload = await plugin.queryUsage();
	check("available:false", payload.available === false);
	check("reason NO_KEY", payload.reason === "NO_KEY", payload.reason);
}

console.log("== usage: all endpoints 404 → UNAVAILABLE ==");
{
	const { plugin } = await makePlugin({ key: "sk-404" });
	globalThis.fetch = () => Promise.resolve({ ok: false, status: 404, text: async () => "" });
	const payload = await plugin.queryUsage();
	check("available:false", payload.available === false);
	check("reason UNAVAILABLE", payload.reason === "UNAVAILABLE", payload.reason);
	check("checkedAt", typeof payload.checkedAt === "number");
	// negative cache: a second call must not hit fetch again
	let calls = 0;
	globalThis.fetch = () => { calls += 1; return Promise.resolve({ ok: false, status: 404, text: async () => "" }); };
	const again = await plugin.queryUsage();
	check("negative cache avoids refetch", calls === 0, `calls=${calls}`);
	check("cached answer", again.reason === "UNAVAILABLE");
	delete globalThis.fetch;
}

console.log("== usage: endpoint answers → available:true ==");
{
	const { plugin } = await makePlugin({ key: "sk-ok" });
	plugin.usageUnavailableUntil = 0;
	globalThis.fetch = () => Promise.resolve({
		ok: true, status: 200,
		text: async () => JSON.stringify({ data: [{ model: "deepseek-v4-flash", total_cost: "6.28", total_tokens: 176430168, total_requests: 1025 }] })
	});
	const payload = await plugin.queryUsage();
	check("available:true", payload.available === true);
	check("data passthrough", payload.data?.data?.[0]?.model === "deepseek-v4-flash");
	check("checkedAt", typeof payload.checkedAt === "number");
	delete globalThis.fetch;
}

console.log("== method guard ==");
{
	const { plugin } = await makePlugin({ key: void 0 });
	const { req, res } = reqRes("POST");
	await plugin.serve(req, res, () => plugin.queryBalance());
	check("405", res.status === 405);
	const payload = jsonOf(res);
	check("code METHOD", payload.code === "METHOD");
}

if (failures.length > 0) {
	console.error(`\n${failures.length} check(s) failed: ${failures.join(", ")}`);
	process.exit(1);
}
console.log("\nhost plugin logic harness: OK");
