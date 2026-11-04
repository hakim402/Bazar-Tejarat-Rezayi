"use client";
import { useEffect, useState, useRef } from "react";
import {
	accountSession,
	ACCOUNT_SESSION_CHANGED,
	type AccountContext,
	type SessionData,
} from "../identity/api/accounts";
import { clearCommerceIntents } from "../orders/intents";
import { clearDrafts } from "./drafts";
import { AccountError } from "../../lib/api/private-client";
export function accessLost(error: unknown) {
	return (
		error instanceof AccountError && [401, 403, 404].includes(error.status ?? 0)
	);
}
export function useCommunicationSession(context: AccountContext) {
	const [state, setState] = useState<{
		session: SessionData | null;
		loading: boolean;
		error: unknown;
	}>({ session: null, loading: true, error: null });
	useEffect(() => {
		let alive = true,
			generation = 0;
		const refresh = () => {
			const mine = ++generation;
			setState({ session: null, loading: true, error: null });
			void accountSession(context)
				.then((session) => {
					if (alive && generation === mine)
						setState({ session, loading: false, error: null });
				})
				.catch((error) => {
					if (alive && generation === mine) {
						if (accessLost(error)) clearCommerceIntents();
						clearDrafts();
						setState({ session: null, loading: false, error });
					}
				});
		};
		const changed = () => {
			clearCommerceIntents();
			clearDrafts();
			refresh();
		};
		refresh();
		window.addEventListener(ACCOUNT_SESSION_CHANGED, changed);
		return () => {
			alive = false;
			generation++;
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, changed);
		};
	}, [context]);
	return state;
}
// One sequential poll per mounted scope; hidden/offline pages do no polling.
// Failed polling backs off, and cancellation makes a late response inert.
export function useVisiblePoll(
	load: (signal: AbortSignal) => Promise<void>,
	dependencies: unknown[],
) {
	const key = JSON.stringify(dependencies);
	const loader = useRef(load);
	useEffect(() => {
		loader.current = load;
	});
	useEffect(() => {
		if (!key) return;
		let active = true,
			timer: ReturnType<typeof setTimeout> | undefined,
			controller: AbortController | null = null,
			running = false;
		const tick = async () => {
			if (!active || running) return;
			if (document.hidden || !navigator.onLine) {
				timer = setTimeout(() => void tick(), 15000);
				return;
			}
			running = true;
			controller = new AbortController();
			let delay = 15000;
			try {
				await loader.current(controller.signal);
			} catch {
				delay = 60000;
			} finally {
				running = false;
				if (active) timer = setTimeout(() => void tick(), delay);
			}
		};
		const visible = () => {
			if (!document.hidden && navigator.onLine && !running) {
				clearTimeout(timer);
				void tick();
			}
		};
		void tick();
		document.addEventListener("visibilitychange", visible);
		window.addEventListener("online", visible);
		return () => {
			active = false;
			clearTimeout(timer);
			controller?.abort();
			document.removeEventListener("visibilitychange", visible);
			window.removeEventListener("online", visible);
		};
	}, [key]);
}

export function useOnlineState() {
	const [online, setOnline] = useState(true);
	useEffect(() => {
		const update = () => setOnline(navigator.onLine);
		update();
		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);
	return online;
}
