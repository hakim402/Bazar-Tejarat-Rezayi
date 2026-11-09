"use client";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
type Guard = (action: () => void) => void;
const Context = createContext({
	navigate: (action: () => void) => action(),
	register: (_owner: symbol, _guard: Guard | null) => {},
});
export function NavigationGuard({
	children,
	guardHistory = false,
}: {
	children: ReactNode;
	guardHistory?: boolean;
}) {
	const guard = useRef(new Map<symbol, Guard>()),
		leaving = useRef(false);
	const register = useCallback((owner: symbol, value: Guard | null) => {
		if (value) guard.current.set(owner, value);
		else guard.current.delete(owner);
		leaving.current = false;
	}, []);
	const navigate = useCallback((action: () => void) => {
		const owners = [...guard.current.keys()];
		function confirm(index: number) {
			const owner = owners[index];
			if (owner === undefined) {
				leaving.current = true;
				action();
				return;
			}
			const current = guard.current.get(owner);
			if (current) current(() => confirm(index + 1));
			else confirm(index + 1);
		}
		confirm(0);
	}, []);
	useEffect(() => {
		const unload = (event: BeforeUnloadEvent) => {
			if (guard.current.size > 0 && !leaving.current) event.preventDefault();
		};
		window.addEventListener("beforeunload", unload);
		return () => window.removeEventListener("beforeunload", unload);
	}, []);
	useEffect(() => {
		if (!guardHistory) return;
		const surface = (window as Window & { navigation?: EventTarget })
			.navigation;
		const traversal = (event: Event) => {
			if (
				!guard.current.size ||
				!event.cancelable ||
				!("navigationType" in event) ||
				event.navigationType !== "traverse" ||
				!("destination" in event)
			)
				return;
			const destination = event.destination;
			if (
				!destination ||
				typeof destination !== "object" ||
				!("url" in destination) ||
				typeof destination.url !== "string"
			)
				return;
			const url = new URL(destination.url);
			if (url.origin !== location.origin) return;
			event.preventDefault();
			navigate(() => location.assign(url.href));
		};
		surface?.addEventListener("navigate", traversal);
		return () => surface?.removeEventListener("navigate", traversal);
	}, [guardHistory, navigate]);
	const value = useMemo(() => ({ register, navigate }), [register, navigate]);
	return (
		<Context.Provider value={value}>
			<div
				className="contents"
				onClickCapture={(event) => {
					if (
						!guard.current.size ||
						event.defaultPrevented ||
						event.button !== 0 ||
						event.metaKey ||
						event.ctrlKey ||
						event.shiftKey ||
						event.altKey
					)
						return;
					const target =
						event.target instanceof Element ? event.target.closest("a") : null;
					if (
						!(target instanceof HTMLAnchorElement) ||
						target.target === "_blank" ||
						target.hasAttribute("download")
					)
						return;
					const url = new URL(target.href);
					if (
						url.origin === location.origin &&
						url.pathname === location.pathname &&
						url.search === location.search
					)
						return;
					event.preventDefault();
					event.stopPropagation();
					navigate(() => location.assign(target.href));
				}}
			>
				{children}
			</div>
		</Context.Provider>
	);
}
export function useNavigation() {
	return useContext(Context).navigate;
}
export function useUnsavedNavigation(dirty: boolean, guard: Guard) {
	const { register } = useContext(Context);
	const owner = useRef(Symbol("unsaved-form"));
	useEffect(() => {
		const token = owner.current;
		register(token, dirty ? guard : null);
		return () => register(token, null);
	}, [dirty, guard, register]);
}
