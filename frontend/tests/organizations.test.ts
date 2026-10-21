import assert from "node:assert/strict";
import { test } from "node:test";
import { privateRequest, AccountError } from "../lib/api/private-client.ts";
import { organizationCopy } from "../lib/i18n/organizations.ts";

test("all four Phase04 resources have complete localized labels", () => {
	const keys = Object.keys(organizationCopy.en).sort();
	for (const [locale, copy] of Object.entries(organizationCopy)) {
		assert.deepEqual(Object.keys(copy).sort(), keys);
		for (const value of Object.values(copy)) assert.ok(value.trim(), locale);
		if (locale !== "en")
			assert.notEqual(copy.invitationHelp, organizationCopy.en.invitationHelp);
	}
});
test("multipart evidence uses the shared fresh-CSRF transport and preserves the browser boundary", async () => {
	const previous = process.env.NEXT_PUBLIC_API_URL;
	const original = globalThis.fetch;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8103";
	const calls: RequestInit[] = [];
	globalThis.fetch = async (url, init) => {
		calls.push(init ?? {});
		return String(url).endsWith("/csrf/")
			? Response.json({ csrf_token: "synthetic-masked-csrf" })
			: Response.json({ id: "synthetic-evidence" });
	};
	try {
		const body = new FormData();
		body.set("file", new Blob(["synthetic"]), "synthetic.png");
		await privateRequest(
			"verification/seller/profiles/synthetic/evidence/",
			body,
		);
		assert.equal(calls.length, 2);
		assert.equal(calls[1].body, body);
		assert.equal(new Headers(calls[1].headers).get("Content-Type"), null);
		assert.equal(
			new Headers(calls[1].headers).get("X-CSRFToken"),
			"synthetic-masked-csrf",
		);
		assert.equal(calls[1].credentials, "include");
		assert.equal(calls[1].cache, "no-store");
	} finally {
		globalThis.fetch = original;
		if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previous;
	}
});
test("stale business changes are never automatically replayed or displayed with raw server details", async () => {
	const previous = process.env.NEXT_PUBLIC_API_URL;
	const original = globalThis.fetch;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8103";
	let calls = 0;
	globalThis.fetch = async () => {
		calls++;
		return calls === 1
			? Response.json({ csrf_token: "synthetic-masked-csrf" })
			: Response.json(
					{ error: { code: "request_failed", message: "private diagnostic" } },
					{ status: 409 },
				);
	};
	try {
		await assert.rejects(
			privateRequest(
				"organizations/seller/profiles/synthetic/",
				{ version: 1 },
				"PATCH",
			),
			(error) =>
				error instanceof AccountError &&
				error.status === 409 &&
				!error.message.includes("private"),
		);
		assert.equal(calls, 2);
	} finally {
		globalThis.fetch = original;
		if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previous;
	}
});
