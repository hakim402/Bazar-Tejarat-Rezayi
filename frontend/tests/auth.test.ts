import assert from "node:assert/strict";
import { test } from "node:test";
import {
	AccountError,
	authMutation,
	safeReturn,
} from "../features/identity/api/accounts.ts";

test("safe returns reject external, escaped, normalized traversal and authentication loops", () => {
	for (const value of [
		null,
		"https://evil.example",
		"//evil.example",
		"/en/\\evil",
		"/en/../outside",
		"/en/auth/buyer-sign-in",
		"/en/path\n",
	]) {
		assert.equal(safeReturn(value, "en", "buyer"), "/en/account/buyer");
	}
	assert.equal(
		safeReturn("/en/account/buyer?view=profile#main", "en", "buyer"),
		"/en/account/buyer?view=profile#main",
	);
});
test("credentialed mutation obtains fresh CSRF and never replays a failed action", async () => {
	const original = globalThis.fetch;
	const previous = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8103";
	const calls: { url: string; init?: RequestInit }[] = [];
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init });
		return String(url).endsWith("/csrf/")
			? Response.json({ status: "ready", csrf_token: "masked-synthetic-csrf" })
			: Response.json(
					{
						error: {
							code: "csrf_failed",
							message: "Synthetic private server message",
						},
					},
					{ status: 403 },
				);
	};
	try {
		await assert.rejects(
			authMutation("buyer/register/", { email: "fiction@example.test" }),
			(error: unknown) =>
				error instanceof AccountError &&
				error.code === "csrf_failed" &&
				!error.message.includes("private"),
		);
		assert.equal(calls.length, 2);
		assert.equal(calls[0].init?.credentials, "include");
		assert.equal(calls[1].init?.credentials, "include");
		assert.equal(calls[1].init?.cache, "no-store");
		assert.equal(
			new Headers(calls[1].init?.headers).get("X-CSRFToken"),
			"masked-synthetic-csrf",
		);
	} finally {
		globalThis.fetch = original;
		if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previous;
	}
});

test("MFA recovery-code hashing can finish beyond the ordinary ten-second request budget without replay", async () => {
	const previous = process.env.NEXT_PUBLIC_API_URL;
	const original = globalThis.fetch;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8103";
	let mutations = 0;
	globalThis.fetch = async (url, init) => {
		if (String(url).endsWith("/csrf/"))
			return Response.json({ csrf_token: "synthetic-csrf" });
		mutations++;
		await new Promise<void>((resolve, reject) => {
			const signal = init?.signal;
			const aborted = () => {
				clearTimeout(timer);
				reject(signal?.reason ?? new Error("aborted"));
			};
			const timer = setTimeout(() => {
				signal?.removeEventListener("abort", aborted);
				resolve();
			}, 11000);
			signal?.addEventListener("abort", aborted, { once: true });
		});
		return Response.json({
			status: "signed_in",
			recovery_codes: ["synthetic-private-recovery"],
		});
	};
	try {
		const result = await authMutation("mfa/challenge/", {
			code: "000000",
			recovery: false,
		});
		assert.equal(result.status, "signed_in");
		assert.equal(mutations, 1);
	} finally {
		globalThis.fetch = original;
		if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previous;
	}
});
