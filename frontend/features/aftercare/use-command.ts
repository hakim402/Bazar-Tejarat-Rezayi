"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AccountError } from "../../lib/api/private-client";
import { aftercare, aftercareDomain, aftercareReference, pendingAftercare, recoveryPath, recoveryState, retainAftercare, settleAftercare } from "./api";
import { uuidPattern } from "../../lib/routes/account-routes";
import type { Context, Domain, Intent, Recovery } from "./types";

type Props = {
	scope: string;
	context: Context;
	orderId: string;
	attempt: string | null;
	attemptDomain: Domain | null;
	onApplied: (intent: Intent | undefined, result: Record<string, unknown>) => void;
	onAbsent: () => void;
	onDenied: () => void;
};

// A command is sent once. Only explicit server reconciliation can unlock an
// uncertain outcome; reload retains only its opaque key and validated domain.
export function useAftercareCommand(props: Props) {
	const { scope, context, orderId, attempt, attemptDomain } = props;
	const callbacks = useRef(props);
	callbacks.current = props;
	const [pending, setPending] = useState(() => pendingAftercare(scope));
	const [reference, setReference] = useState(pending?.key ?? attempt);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<"error" | "throttled" | null>(null);
	const [absent, setAbsent] = useState(false);
	const controller = useRef<AbortController | null>(null);
	const live = useRef(true);
	const keyRef = useRef(pending?.key ?? attempt);
	const domainRef = useRef(aftercareDomain(pending?.domain ?? attemptDomain));
	useLayoutEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			controller.current?.abort();
			controller.current = null;
			settleAftercare(scope);
		};
	}, [scope]);
	useLayoutEffect(() => {
		if (attempt && !keyRef.current) {
			keyRef.current = attempt;
			domainRef.current = aftercareDomain(attemptDomain);
			setReference(attempt);
		}
	}, [attempt, attemptDomain]);
	const redact = useCallback(() => {
		controller.current?.abort();
		controller.current = null;
		settleAftercare(scope);
		setPending(undefined);
		setBusy(false);
	}, [scope]);

	function finish() {
		settleAftercare(scope);
		keyRef.current = null;
		domainRef.current = null;
		setPending(undefined);
		setReference(null);
		aftercareReference(null);
	}
	function failure(error: unknown) {
		setError(error instanceof AccountError && error.status === 429 ? "throttled" : "error");
		if (error instanceof AccountError && [401, 403, 404].includes(error.status ?? 0)) {
			settleAftercare(scope);
			setPending(undefined);
			callbacks.current.onDenied();
		}
	}
	async function send(packet: Intent) {
		if (!live.current || controller.current || keyRef.current || pendingAftercare(scope)) return;
		const request = new AbortController();
		controller.current = request;
		const intent = retainAftercare(scope, packet);
		keyRef.current = intent.key;
		domainRef.current = aftercareDomain(intent.domain);
		setPending(intent);
		setReference(intent.key);
		setBusy(true);
		setError(null);
		setAbsent(false);
		try {
			// If the reference cannot be retained, do not issue a mutation.
			aftercareReference(intent.key, intent.domain);
			const response = await aftercare<Record<string, unknown>>(intent.domain, context, intent.path, intent.body, request.signal);
			if (!live.current || request.signal.aborted) return;
			if (intent.upload && typeof response.id !== "string") throw Error();
			finish();
			callbacks.current.onApplied(intent, response);
		} catch (error) {
			if (live.current && !request.signal.aborted) failure(error);
		} finally {
			if (live.current && controller.current === request) {
				controller.current = null;
				setBusy(false);
			}
		}
	}
	async function reconcile() {
		const packet = pendingAftercare(scope), key = packet?.key ?? keyRef.current;
		if (!live.current || !key || controller.current || !uuidPattern.test(orderId)) return;
		const domain = aftercareDomain(packet?.domain ?? domainRef.current);
		// Legacy/domainless references stay locked. Never probe another domain,
		// infer absence from a denial, or replay a missing private packet.
		if (!domain) { setError("error"); return; }
		const request = new AbortController();
		controller.current = request;
		setBusy(true);
		setError(null);
		try {
			const recovered = await aftercare<Recovery>(domain, context, recoveryPath(domain, orderId, key), {}, request.signal);
			if (!live.current || request.signal.aborted) return;
			const state = recoveryState(recovered);
			if (state === "applied") {
				finish();
				callbacks.current.onApplied(packet, recovered.result ?? recovered.outcome ?? {});
			} else if (state === "absent") {
				finish();
				setAbsent(true);
				callbacks.current.onAbsent();
			}
		} catch (error) {
			if (live.current && !request.signal.aborted) failure(error);
		} finally {
			if (live.current && controller.current === request) {
				controller.current = null;
				setBusy(false);
			}
		}
	}
	return { pending, reference, busy, error, absent, send, reconcile, redact, locked: !!reference || !!pending || busy };
}
