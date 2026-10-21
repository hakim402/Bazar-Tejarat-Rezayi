import test from "node:test";
import assert from "node:assert/strict";
import {
	validContent,
	publicCall,
	validList,
} from "../features/content/api/public.ts";
import { contentCopy } from "../lib/i18n/content.ts";
test("editorial DTO rejects missing or invalid fields", () => {
	assert.equal(validContent({}), false);
	assert.equal(
		validContent({ key: "draft", payload: { title: "Private" } }),
		false,
	);
	assert.equal(validList({ results: [], count: 0, page: 1 }), true);
});
test("content transport omits credentials, bypasses cache and distinguishes 404 from outage", async () => {
	const original = global.fetch;
	try {
		global.fetch = async (_url, options) => {
			assert.equal(options?.cache, "no-store");
			assert.equal(options?.credentials, "omit");
			return new Response("", { status: 404 });
		};
		assert.equal(
			await publicCall("http://127.0.0.1:8100", "en/home/", validContent),
			null,
		);
		global.fetch = async () => new Response("{}", { status: 503 });
		await assert.rejects(() =>
			publicCall("http://127.0.0.1:8100", "en/home/", validContent),
		);
		global.fetch = async () =>
			new Response("{}", { headers: { "Content-Type": "application/json" } });
		await assert.rejects(() =>
			publicCall("http://127.0.0.1:8100", "en/home/", validContent),
		);
	} finally {
		global.fetch = original;
	}
});
test("four interface dictionaries have identical complete keys", () => {
	for (const copy of Object.values(contentCopy)) {
		assert.deepEqual(
			Object.keys(copy).sort(),
			Object.keys(contentCopy.en).sort(),
		);
		assert.ok(Object.values(copy).every((v) => v.trim()));
	}
});

import { readFileSync } from "node:fs";
import {
	safeValidationIssues,
	privateCall,
	AccountError,
} from "../lib/api/private-client.ts";
import { contentEditorCopy } from "../lib/i18n/content-editor.ts";
test("CMS registration contract uses actual screens and excludes obsolete conventions", () => {
	const validation = readFileSync(
		"../backend/apps/content/validation.py",
		"utf8",
	);
	const screens = readFileSync("lib/i18n/auth-screens.ts", "utf8");
	const drafts = readFileSync("../backend/apps/content/drafts.py", "utf8");
	for (const context of ["buyer", "seller"]) {
		assert.ok(validation.includes(`/auth/${context}-registration`));
		assert.ok(screens.includes(`"${context}-registration"`));
		assert.ok(drafts.includes(`/auth/${context}-registration`));
		assert.ok(!validation.includes(`/auth/${context}-register"`));
		assert.ok(!drafts.includes(`/auth/${context}-register"`));
	}
});
test("validation transport bounds typed issues and preserves existing error fields/code", async () => {
	assert.deepEqual(
		safeValidationIssues([
			{
				path: "payload.title",
				code: "plain_text",
				message: "Never render this",
			},
			{ path: "<private>", code: "invalid" },
			{ path: "title", code: "Exception: sensitive" },
		]),
		[{ path: "payload.title", code: "plain_text" }],
	);
	assert.equal(
		safeValidationIssues(
			Array.from({ length: 100 }, () => ({
				path: "payload.title",
				code: "plain_text",
			})),
		).length,
		32,
	);
	const original = global.fetch;
	const previous = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:8103";
	try {
		global.fetch = async () =>
			new Response(
				JSON.stringify({
					error: {
						code: "validation_error",
						fields: { "payload.title": ["Do not display server text"] },
						violations: [{ path: "payload.title", code: "plain_text" }],
					},
				}),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		await assert.rejects(
			() =>
				privateCall("content/editor/staff/items/about/", "POST", {}, null, ""),
			(e) => {
				assert.ok(e instanceof AccountError);
				assert.equal(e.status, 400);
				assert.equal(e.code, "validation_error");
				assert.deepEqual(e.fields, ["payload.title"]);
				assert.deepEqual(e.violations, [
					{ path: "payload.title", code: "plain_text" },
				]);
				return true;
			},
		);
	} finally {
		global.fetch = original;
		if (previous === undefined) delete process.env.NEXT_PUBLIC_API_URL;
		else process.env.NEXT_PUBLIC_API_URL = previous;
	}
});
test("review/validation copy is complete in four locales", () => {
	for (const copy of Object.values(contentEditorCopy)) {
		assert.deepEqual(
			Object.keys(copy).sort(),
			Object.keys(contentEditorCopy.en).sort(),
		);
		assert.ok(Object.values(copy).every((value) => value.trim()));
	}
});
