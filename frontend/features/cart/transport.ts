import { AccountError, privateRequest } from "../../lib/api/private-client.ts";

/** Only the explicit initializer can emit the guest cookie. Coordinate it across
 * same-origin tabs, holding the lock until fetch/JSON completion applies cookies.
 * Component cancellation must not release a still-running cookie-writing fetch.
 * Reads after initialization may overlap: they never emit Set-Cookie.
 */
export async function guestRead<T>(
	path: string,
	signal?: AbortSignal,
): Promise<T> {
	const value = await privateRequest<T & { initialized?: boolean }>(
		path,
		undefined,
		"GET",
		{ signal },
	);
	if (value.initialized !== false) return value;
	if (typeof navigator === "undefined" || !navigator.locks)
		throw new AccountError(503, [], "guest_coordination_unavailable");
	await navigator.locks.request("rezayi:guest-cart-initialize", async () => {
		// Never abandon a cookie-writing fetch on a component timeout/remount.
		// A queued initializer rechecks the current HttpOnly cookie server-side.
		await privateRequest("cart/guest/initialize/", {}, "POST", {
			timeoutMs: null,
		});
	});
	signal?.throwIfAborted();
	return privateRequest<T>(path, undefined, "GET", { signal });
}
