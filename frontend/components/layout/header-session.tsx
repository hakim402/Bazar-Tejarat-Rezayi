"use client";
import {
	createContext,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
	accountSession,
	AccountError,
	ACCOUNT_SESSION_CHANGED,
	type SessionData,
} from "../../features/identity/api/accounts";

type HeaderSession = {
	buyer: SessionData | null;
	seller: SessionData | null;
	loading: boolean;
	unavailable: boolean;
};

const HeaderSessionContext = createContext<HeaderSession>({
	buyer: null,
	seller: null,
	loading: true,
	unavailable: false,
});

/** One shared session probe for every header dropdown; never clears drafts. */
export function HeaderSessionProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState<HeaderSession>({
		buyer: null,
		seller: null,
		loading: true,
		unavailable: false,
	});
	useEffect(() => {
		let current = true,
			generation = 0;
		const refresh = () => {
			const mine = ++generation;
			void Promise.allSettled([
				accountSession("buyer"),
				accountSession("seller"),
			]).then(([buyer, seller]) => {
				if (!current || mine !== generation) return;
				setState({
					buyer: buyer.status === "fulfilled" ? buyer.value : null,
					seller: seller.status === "fulfilled" ? seller.value : null,
					loading: false,
					unavailable: [buyer, seller].some(
						(result) =>
							result.status === "rejected" &&
							!(
								result.reason instanceof AccountError &&
								[401, 403].includes(result.reason.status ?? 0)
							),
					),
				});
			});
		};
		// Share invalidation only: no identities, tokens or mutation payloads cross tabs.
		let channel: BroadcastChannel | undefined;
		try {
			channel = new BroadcastChannel("rezayi:session-invalidation");
		} catch {}
		const remote = () =>
			window.dispatchEvent(
				new CustomEvent(ACCOUNT_SESSION_CHANGED, { detail: { remote: true } }),
			);
		if (channel)
			channel.onmessage = (event) => {
				if (event.data === "invalidate") remote();
			};
		const broadcast = (event: Event) => {
			if (event instanceof CustomEvent && event.detail?.remote) return;
			channel?.postMessage("invalidate");
			try {
				localStorage.setItem("rezayi:session-invalidation", String(Date.now()));
			} catch {}
		};
		const stored = (event: StorageEvent) => {
			if (!channel && event.key === "rezayi:session-invalidation") remote();
		};
		window.addEventListener(ACCOUNT_SESSION_CHANGED, broadcast);
		window.addEventListener("storage", stored);
		refresh();
		const onFocus = () => {
			if (document.visibilityState === "visible") refresh();
		};
		window.addEventListener("focus", onFocus);
		window.addEventListener(ACCOUNT_SESSION_CHANGED, onFocus);
		return () => {
			current = false;
			channel?.close();
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, broadcast);
			window.removeEventListener("storage", stored);
			window.removeEventListener("focus", onFocus);
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, onFocus);
		};
	}, []);
	return (
		<HeaderSessionContext.Provider value={state}>
			{children}
		</HeaderSessionContext.Provider>
	);
}

export function useHeaderSession() {
	return useContext(HeaderSessionContext);
}

export type HeaderRole = "buyer" | "seller";

/** Same preference rule as the account entry: seller area wins, else buyer. */
export function useHeaderRole(): HeaderRole | null {
	const { buyer, seller, loading } = useHeaderSession();
	const path = usePathname();
	if (loading) return null;
	const preferred: HeaderRole =
		path.includes("/account/seller") || path.endsWith("/sell")
			? "seller"
			: "buyer";
	if (preferred === "seller" && seller) return "seller";
	if (preferred === "buyer" && buyer) return "buyer";
	return buyer ? "buyer" : seller ? "seller" : null;
}
