import test from "node:test";
import assert from "node:assert/strict";
import {
	communicationRoute,
	sellerAccountRoute,
} from "../lib/routes/account-routes.ts";
import { safeReturn } from "../features/identity/api/accounts.ts";
import {
	scopeKey,
	saveDraft,
	draftFor,
	clearDrafts,
	dropDraft,
} from "../features/messaging/drafts.ts";
import { communicationCopy } from "../features/messaging/copy.ts";
import { threadHref, localTimestamp, reportPath, reportPacket, reportTargetHref } from "../features/messaging/api.ts";
import { privateRequest, AccountError } from "../lib/api/private-client.ts";
const id = "11111111-2222-3333-4444-555555555555";
test("communication deep links are strict across both roles and safe modal returns", () => {
	for (const parts of [["messages"], ["messages", id], ["notifications"]]) {
		assert.equal(communicationRoute(parts), true);
		assert.equal(sellerAccountRoute(parts), true);
	}
	for (const parts of [
		["messages", "bad"],
		["notifications", id],
		["messages", id, "edit"],
		["messages", id, ".."],
	])
		assert.equal(communicationRoute(parts), false);
	assert.equal(
		safeReturn(`/en/account/buyer/messages/${id}`, "en", "buyer"),
		`/en/account/buyer/messages/${id}`,
	);
	assert.equal(
		safeReturn("/en/account/buyer/messages/bad", "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		safeReturn(`/en/account/seller/messages/${id}`, "en", "buyer"),
		"/en/account/buyer",
	);
	assert.equal(
		safeReturn(`/en/account/staff/messages/${id}`, "en", "seller"),
		"/en/account/seller",
	);
	assert.equal(
		threadHref("fa-AF", "seller", id, id),
		`/fa-AF/account/seller/messages/${id}?seller=${id}`,
	);
});
test("Phase 15 generalized report paths reuse the message seal without duplicate contexts", () => {
	assert.equal(reportPath("message", id), `messages/${id}/reports/`);
	for (const target of ["product", "store", "order"] as const) assert.equal(reportPath(target, id), `reports/${target}/${id}/`);
	const packet = reportPacket("fraud", "  Exact reviewed report  ", id);
	assert.deepEqual(packet, { command_id: id, category: "fraud", reason: "Exact reviewed report" });
	assert.equal(Object.isFrozen(packet), true);
});
test("Phase 15 reports reject invalid category, UUID, lengths and unsafe text", () => {
	for (const category of ["money", "approve", ""]) assert.equal(reportPacket(category, "Safe reason", id), null);
	for (const reason of [" x ", "x".repeat(1001), "Unsafe\u202ereason", "Unsafe\u0000reason"]) assert.equal(reportPacket("other", reason, id), null);
	assert.equal(reportPacket("other", "Safe reason", "invalid"), null);
	assert.ok(reportPacket("privacy", "x".repeat(1000), id));
});
test("Phase 15 report deep links distinguish message, order and public target identities", () => {
	for (const context of ["buyer", "seller"] as const) {
		assert.equal(reportTargetHref("fa-AF", context, "product", id), `/fa-AF/products/${id}`);
		assert.equal(reportTargetHref("en", context, "store", id), `/en/stores/${id}`);
		assert.equal(reportTargetHref("en", context, "message", id), `/en/account/${context}/messages`);
		assert.equal(reportTargetHref("en", context, "order", "invalid"), `/en/account/${context}/notifications`);
		assert.equal(reportTargetHref("en", context, "order", id, id), `/en/account/${context}/${context === "buyer" ? "cancellations" : "aftercare"}/${id}${context === "seller" ? `?seller=${id}` : ""}`);
	}
});
test("session-memory drafts and pending command IDs stay scoped and clear on logout", () => {
	const a = scopeKey("person", "seller", "A", id),
		b = scopeKey("person", "seller", "B", id),
		other = scopeKey("other", "seller", "A", id);
	saveDraft(a, {
		body: "voluntarily shared +93700000000",
		images: [],
		pending: { body: "private", images: [], command_id: id },
	});
	assert.equal(draftFor(b).body, "");
	assert.equal(draftFor(other).body, "");
	assert.equal(draftFor(a).pending?.command_id, id);
	dropDraft(b);
	assert.equal(draftFor(a).body, "voluntarily shared +93700000000");
	clearDrafts();
	assert.equal(draftFor(a).body, "");
});
test("four-language communication copy and Kabul timestamp convention are complete", () => {
	const keys = Object.keys(communicationCopy.en).sort();
	for (const locale of ["fa-AF", "ps", "ar", "en"] as const) {
		assert.deepEqual(Object.keys(communicationCopy[locale]).sort(), keys);
		assert.ok(
			Object.values(communicationCopy[locale]).every((v) => v.length > 0),
		);
		assert.ok(localTimestamp("2026-10-28T00:00:00Z", locale).length > 5);
	}
	assert.match(communicationCopy.en.privacy, /choose to disclose/);
	assert.match(communicationCopy.en.emailHelp, /security/);
});
test("existing-conversation errors expose only a validated internal identifier", async () => {
	const previous = globalThis.fetch,
		base = process.env.NEXT_PUBLIC_API_URL;
	process.env.NEXT_PUBLIC_API_URL = "http://127.0.0.1:19999";
	try {
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({ code: "conversation_exists", conversation: id }),
				{ status: 409, headers: { "content-type": "application/json" } },
			);
		await assert.rejects(
			privateRequest("messaging/buyer/enquiries/"),
			(e) => e instanceof AccountError && e.resource === id,
		);
		globalThis.fetch = async () =>
			new Response(
				JSON.stringify({
					code: "conversation_exists",
					conversation: "not-an-internal-id@example.test",
				}),
				{ status: 409, headers: { "content-type": "application/json" } },
			);
		await assert.rejects(
			privateRequest("messaging/buyer/enquiries/"),
			(e) => e instanceof AccountError && e.resource === undefined,
		);
	} finally {
		globalThis.fetch = previous;
		process.env.NEXT_PUBLIC_API_URL = base;
	}
});
