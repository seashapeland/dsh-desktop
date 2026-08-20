/**
 * dsh-deepseek-balance — host half.
 *
 * A cordis plugin that mounts two same-origin HTTP routes on the DSH web
 * server:
 *
 *   GET /dsh-deepseek-balance/api/balance   → account balance
 *   GET /dsh-deepseek-balance/api/usage     → usage stats, if DeepSeek ever
 *                                            exposes them keyed by API key
 *
 * The handlers resolve the DeepSeek API key through the DSH credentials
 * domain (the same key the Models page stores as `DEEPSEEK_API_KEY`), call
 * the DeepSeek endpoints with it, and return small normalized JSON payloads.
 * The browser half of this package fetches those routes — no CORS, no key
 * ever leaves the host.
 *
 * Web profile only: it declares `webServer`, so adding it to a profile
 * without one parks the fiber loudly instead of silently doing nothing.
 */
import { Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_API_KEY_REF = "DEEPSEEK_API_KEY";
const DEFAULT_ROUTE = "/dsh-deepseek-balance";
const UPSTREAM_TIMEOUT_MS = 15000;
const USAGE_NEGATIVE_CACHE_MS = 10 * 60 * 1000;
/**
 * Candidate usage endpoints, probed in order with a 30-day window. DeepSeek
 * currently documents no usage API keyed by API key (all candidates 404), so
 * the route reports `available:false`; the list stays so that if an endpoint
 * ever ships, the plugin lights up without a release.
 */
const USAGE_PROBE_ENDPOINTS = [
	(base, start, end) => `${base}/user/usage?start_date=${start}&end_date=${end}`,
	(base, start, end) => `${base}/dashboard/billing/usage?start_date=${start}&end_date=${end}`,
	(base, start, end) => `${base}/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`
];

/** Today / thirty days ago as GMT+8 dates (the platform reports in GMT+8). */
function gmt8Date(offsetDays) {
	const shifted = new Date(Date.now() + 8 * 3600 * 1000 + offsetDays * 86400000);
	return shifted.toISOString().slice(0, 10);
}

/** Normalized, JSON-safe payloads the routes always answer with. */
class DeepSeekBalance extends Service {
	static inject = ["webServer", "credentials"];

	static Config = z.object({
		/** Upstream base URL (the DeepSeek API host). */
		baseUrl: z.string().default(DEFAULT_BASE_URL),
		/** Credential reference resolved through the credentials domain. */
		apiKeyRef: z.string().default(DEFAULT_API_KEY_REF),
		/** Path prefix under which the routes are mounted. */
		route: z.string().default(DEFAULT_ROUTE)
	});

	/** Negative cache for the usage probe: endpoint absence is remembered briefly. */
	usageUnavailableUntil = 0;

	/**
	 * @param ctx - plugin context.
	 * @param config - validated plugin config (see {@link DeepSeekBalance.Config}).
	 */
	constructor(ctx, config) {
		super(ctx, "deepSeekBalance");
		this.config = config;
	}

	async *[Service.init]() {
		const webServer = this.ctx.get("webServer");
		const prefix = this.config.route.replace(/\/+$/, "");
		const routes = [
			{ kind: "exact", path: `${prefix}/api/balance`, handler: (req, res) => this.serve(req, res, () => this.queryBalance()) },
			{ kind: "exact", path: `${prefix}/api/usage`, handler: (req, res) => this.serve(req, res, () => this.queryUsage()) }
		];
		const disposers = routes.map((route) => webServer.register(route));
		this.ctx.logger.info("deepseek-balance: routes mounted at %s/api/balance, %s/api/usage", prefix, prefix);
		yield () => {
			for (const dispose of disposers) dispose();
		};
	}

	/**
	 * Answer one request with a normalized JSON payload built by `query`.
	 * @param req - node:http request.
	 * @param res - node:http response.
	 * @param query - async payload builder.
	 */
	async serve(req, res, query) {
		if (req.method !== "GET" && req.method !== "HEAD") {
			res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: false, code: "METHOD", message: "GET only" }));
			return;
		}
		let payload;
		try {
			payload = await query();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.ctx.logger.warn("deepseek-balance: query failed: %s", message);
			payload = { ok: false, code: "INTERNAL", message };
		}
		const body = JSON.stringify(payload);
		res.writeHead(200, {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store"
		});
		if (req.method === "HEAD") {
			res.end();
			return;
		}
		res.end(body);
	}

	/**
	 * Resolve the API key and query the upstream balance endpoint.
	 * @returns a normalized payload ({@link ok:true} with balance fields, or
	 * an error payload with a stable `code`).
	 */
	async queryBalance() {
		const ref = this.config.apiKeyRef;
		const key = await this.resolveKey(ref);
		if (key === void 0) {
			return {
				ok: false,
				code: "NO_KEY",
				ref,
				message: `No API key found for "${ref}". Add it in Settings → Models, or set the ${ref} environment variable before starting dsh.`
			};
		}

		let response;
		try {
			response = await fetch(`${this.config.baseUrl}/user/balance`, {
				headers: {
					authorization: `Bearer ${key}`,
					accept: "application/json"
				},
				signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
			});
		} catch (error) {
			return {
				ok: false,
				code: "NETWORK",
				message: `Could not reach ${this.config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`
			};
		}

		const text = await response.text();
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
		if (!response.ok || data === null) {
			const upstreamMessage = data?.error?.message ?? data?.message ?? text.slice(0, 300);
			return {
				ok: false,
				code: "UPSTREAM",
				status: response.status,
				message: typeof upstreamMessage === "string" ? upstreamMessage : String(upstreamMessage)
			};
		}

		const info = data.balance_infos?.[0];
		return {
			ok: true,
			isAvailable: data.is_available === true,
			currency: typeof info?.currency === "string" ? info.currency : null,
			totalBalance: typeof info?.total_balance === "string" ? info.total_balance : null,
			grantedBalance: typeof info?.granted_balance === "string" ? info.granted_balance : null,
			toppedUpBalance: typeof info?.topped_up_balance === "string" ? info.topped_up_balance : null,
			raw: data,
			checkedAt: Date.now()
		};
	}

	/**
	 * Probe for a usage endpoint. DeepSeek exposes none today, so this returns
	 * `available:false` (with the reason) once a full probe run fails, and
	 * caches the negative result briefly so page loads do not hammer 404s.
	 * @returns a normalized payload with `available:true` and `data` when an
	 * endpoint answers JSON, otherwise `available:false`.
	 */
	async queryUsage() {
		const key = await this.resolveKey(this.config.apiKeyRef);
		if (key === void 0) return { ok: true, available: false, reason: "NO_KEY" };
		if (Date.now() < this.usageUnavailableUntil) {
			return { ok: true, available: false, reason: "UNAVAILABLE" };
		}
		const start = gmt8Date(-30);
		const end = gmt8Date(0);
		for (const build of USAGE_PROBE_ENDPOINTS) {
			let response;
			try {
				response = await fetch(build(this.config.baseUrl, start, end), {
					headers: {
						authorization: `Bearer ${key}`,
						accept: "application/json"
					},
					signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
				});
			} catch {
				continue;
			}
			const text = await response.text();
			if (!response.ok) continue;
			let data;
			try {
				data = JSON.parse(text);
			} catch {
				continue;
			}
			return { ok: true, available: true, data, checkedAt: Date.now() };
		}
		this.usageUnavailableUntil = Date.now() + USAGE_NEGATIVE_CACHE_MS;
		return { ok: true, available: false, reason: "UNAVAILABLE", checkedAt: Date.now() };
	}

	/**
	 * Resolve the API key from the credentials domain, falling back to the
	 * process environment when the domain is unavailable or fails.
	 * @param ref - the credential reference to resolve.
	 * @returns the key, or undefined when unconfigured.
	 */
	async resolveKey(ref) {
		const credentials = this.ctx.get("credentials");
		if (credentials !== void 0 && typeof credentials.resolve === "function") {
			try {
				const resolved = await credentials.resolve(ref);
				if (resolved?.value !== void 0 && resolved.value.length > 0) return resolved.value;
			} catch (error) {
				this.ctx.logger.warn("deepseek-balance: credentials.resolve(%s) failed: %s", ref, error instanceof Error ? error.message : String(error));
			}
		}
		const envValue = process.env[ref];
		return envValue !== void 0 && envValue.length > 0 ? envValue : void 0;
	}
}

export default DeepSeekBalance;
