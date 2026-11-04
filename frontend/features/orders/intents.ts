import { clearPaymentIntents } from "../payments/api.ts";
import { clearNegotiationIntents } from "../negotiations/api.ts";
import { clearCartIntents } from "../cart/recovery.ts";
import type { Packet } from "./api.ts";
// Private pending intent survives component/locale remounts only in this tab's memory.
// It is never written to browser storage. Refresh recovers committed submissions from the server.
const intents = new Map<string, Packet>();
export function pendingIntent(scope: string) {
	return intents.get(scope);
}
export function retainIntent(scope: string, packet: Packet) {
	if (!intents.has(scope)) intents.set(scope, structuredClone(packet));
	return intents.get(scope) ?? packet;
}
export function settleIntent(scope: string) {
	intents.delete(scope);
}
export function clearCommerceIntents() {
	clearPaymentIntents();
	clearNegotiationIntents();
	clearCartIntents();
	intents.clear();
}
