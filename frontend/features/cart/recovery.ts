export type CartCommand = {
	guest_scope?: string;
	command_id: string;
	version: number;
	action: "set" | "remove";
	variant?: string;
	tier?: "retail" | "wholesale";
	quantity?: string;
	line?: string;
};
export type CartIntent = Partial<CartCommand> & { command_id: string };
const pending = new Map<string, CartIntent>();
export const cartIntent = (scope: string) => pending.get(scope);
export function retainCartIntent(scope: string, packet: CartIntent) {
	if (!pending.has(scope)) pending.set(scope, structuredClone(packet));
	return pending.get(scope) ?? packet;
}
export const settleCartIntent = (scope: string) => pending.delete(scope);
export const clearCartIntents = () => pending.clear();
function units(value: string) {
	if (!/^\d{1,9}(\.\d{1,3})?$/.test(value)) throw new Error("quantity");
	const [w, f = ""] = value.split(".");
	return BigInt(w) * BigInt(1000) + BigInt(f.padEnd(3, "0"));
}
export function validCartQuantity(value: string, increment: string) {
	try {
		const q = units(value),
			step = units(increment);
		return (
			q > BigInt(0) &&
			q <= BigInt("999999999999") &&
			step > BigInt(0) &&
			q % step === BigInt(0)
		);
	} catch {
		return false;
	}
}
export function initialCartQuantity(increment: string) {
	return validCartQuantity("1.000", increment) ? "1.000" : increment;
}
