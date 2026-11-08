"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { AccountError } from "../../lib/api/private-client";
import { accessLost } from "../messaging/hooks";
import {
	fulfilment,
	fulfilmentReference,
	pendingFulfilment,
	retainFulfilment,
	settleFulfilment,
	clearFulfilmentIntents,
} from "./api";
import type { Context, Intent, Outcome, Recovery } from "./types";

function isRefund(intent: Intent) {
	return (
		intent.path === "delivery-refunds/" ||
		(intent.upload &&
			intent.body instanceof FormData &&
			intent.body.get("purpose") === "refund")
	);
}

export function useFulfilmentCommand({
	scope,
	context,
	id,
	attempt,
	refundAllowed,
	onApplied,
	onDenied,
}: {
	scope: string;
	context: Context;
	id: string;
	attempt: string | null;
	refundAllowed?: boolean;
	onApplied: (
		intent: Intent | undefined,
		result: Record<string, unknown>,
		current?: Outcome["current"],
	) => void;
	onDenied: () => void;
}) {
	const [pending, setPending] = useState<Intent | undefined>(() =>
		pendingFulfilment(scope),
	);
	const [reference, setReference] = useState(attempt),
		[busy, setBusy] = useState(false),
		[error, setError] = useState<unknown>(null),
		[absent, setAbsent] = useState(false);
	const owned = useRef<object | null>(null),
		controller = useRef<AbortController | null>(null),
		alive = useRef(true),
		callbacks = useRef({ onApplied, onDenied });
	callbacks.current = { onApplied, onDenied };
	useLayoutEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			owned.current = null;
			controller.current?.abort();
		};
	}, []);
	useLayoutEffect(() => {
		if (refundAllowed !== false) return;
		const packet = pendingFulfilment(scope) ?? pending;
		if (!packet || !isRefund(packet)) return;
		// Drop private packet/files and late callbacks, retaining only the opaque
		// command key for explicit reconciliation. Never resend on restored access.
		controller.current?.abort();
		owned.current = null;
		settleFulfilment(scope);
		setPending(undefined);
		setReference(packet.key);
		fulfilmentReference(packet.key);
		setBusy(false);
		setError(null);
	}, [refundAllowed, pending, scope]);
	function finish() {
		settleFulfilment(scope);
		setPending(undefined);
		setReference(null);
		fulfilmentReference(null);
	}
	async function send(packet: Intent) {
		if (
			owned.current || pendingFulfilment(scope) || reference ||
			(isRefund(packet) && (context !== "seller" || refundAllowed !== true))
		) return;
		const owner = {};
		const request = new AbortController();
		controller.current = request;
		owned.current = owner;
		const intent = retainFulfilment(scope, packet);
		setPending(intent);
		setReference(intent.key);
		fulfilmentReference(intent.key);
		setBusy(true);
		setError(null);
		setAbsent(false);
		try {
			const response = await fulfilment<Outcome | Record<string, unknown>>(
				context,
				`orders/${id}/${intent.path}`,
				intent.body,
				request.signal,
			);
			if (!alive.current || owned.current !== owner) return;
			finish();
			if (intent.upload)
				callbacks.current.onApplied(
					intent,
					response as Record<string, unknown>,
				);
			else {
				const outcome = response as Outcome;
				callbacks.current.onApplied(intent, outcome.result, outcome.current);
			}
		} catch (error) {
			if (!alive.current || owned.current !== owner) return;
			setError(error);
			if (accessLost(error)) {
				clearFulfilmentIntents();
				setPending(undefined);
				setError(null);
				callbacks.current.onDenied();
			} else if (
				error instanceof AccountError &&
				(error.status ?? 0) >= 400 &&
				(error.status ?? 0) < 500
			)
				finish();
		} finally {
			if (alive.current && owned.current === owner) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	async function reconcile() {
		const packet = pendingFulfilment(scope),
			key = packet?.key ?? reference;
		if (!key || owned.current) return;
		const owner = {};
		const request = new AbortController();
		controller.current = request;
		owned.current = owner;
		setBusy(true);
		setError(null);
		try {
			const recovered = await fulfilment<Recovery>(
				context,
				`orders/${id}/commands/${key}/reconcile/`,
				{},
				request.signal,
			);
			if (!alive.current || owned.current !== owner) return;
			if (recovered.state === "unknown") return;
			finish();
			if (recovered.state === "applied")
				callbacks.current.onApplied(packet, recovered.result ?? {});
			else setAbsent(true);
		} catch (error) {
			if (alive.current && owned.current === owner) {
				setError(error);
				if (accessLost(error)) {
					clearFulfilmentIntents();
					setPending(undefined);
					setError(null);
					callbacks.current.onDenied();
				}
			}
		} finally {
			if (alive.current && owned.current === owner) {
				owned.current = null;
				setBusy(false);
			}
		}
	}
	return {
		pending,
		reference,
		busy,
		error,
		absent,
		send,
		reconcile,
		locked: !!pending || !!reference || busy,
	};
}
