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
	register: (_guard: Guard | null) => {},
});
export function NavigationGuard({ children }: { children: ReactNode }) {
	const guard = useRef<Guard | null>(null),
		leaving = useRef(false);
	const register = useCallback((value: Guard | null) => {
		guard.current = value;
		leaving.current = false;
	}, []);
	const navigate = useCallback((action: () => void) => {
		const confirmed = () => {
			leaving.current = true;
			action();
		};
		if (guard.current) guard.current(confirmed);
		else confirmed();
	}, []);
	useEffect(() => {
		const unload = (event: BeforeUnloadEvent) => {
			if (guard.current && !leaving.current) event.preventDefault();
		};
		window.addEventListener("beforeunload", unload);
		return () => window.removeEventListener("beforeunload", unload);
	}, []);
	const value = useMemo(() => ({ register, navigate }), [register, navigate]);
	return (
		<Context.Provider value={value}>
			<div
				className="contents"
				onClickCapture={(event) => {
					if (
						!guard.current ||
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
	useEffect(() => {
		register(dirty ? guard : null);
		return () => register(null);
	}, [dirty, guard, register]);
}
