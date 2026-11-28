import type { AccountContext } from "./api/accounts";

const storagePrefix = "rezayi:pending-email-verification";
export type PendingVerification = {
	email: string;
	context: AccountContext;
	resendAt: number;
	expiresAt?: number;
	returnTo?: string;
};

export function retainVerification(
	pending: PendingVerification | null,
	context: AccountContext,
) {
	try {
		if (pending)
			sessionStorage.setItem(
				`${storagePrefix}:${context}`,
				JSON.stringify(pending),
			);
		else sessionStorage.removeItem(`${storagePrefix}:${context}`);
		sessionStorage.removeItem(storagePrefix);
	} catch {
		// The current screen remains usable if browser storage is unavailable.
	}
}

export function pendingVerificationFor(
	context: AccountContext,
): PendingVerification | undefined {
	try {
		const raw =
			sessionStorage.getItem(`${storagePrefix}:${context}`) ??
			sessionStorage.getItem(storagePrefix);
		const saved = JSON.parse(raw ?? "null");
		if (
			saved &&
			saved.context === context &&
			typeof saved.email === "string" &&
			saved.email.length <= 254 &&
			typeof saved.resendAt === "number" &&
			Number.isFinite(saved.resendAt)
		)
			return saved;
	} catch {
		retainVerification(null, context);
	}
	return undefined;
}
