"use client";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	useCallback,
	Suspense,
	type ReactNode,
} from "react";
import Link from "next/link";
import {
	modalScreens,
	authHref,
	authAudience,
	authParameters,
	clearAuthToken,
	AUTH_NAVIGATION_CHANGED,
} from "../../lib/routes/auth-routes";
import { useSearchParams } from "next/navigation";
import type { Locale } from "../../lib/i18n/locales";
import { direction } from "../../lib/i18n/locales";
import { screenTitle, type AuthScreen } from "../../lib/i18n/auth-screens";
import { accessCopy } from "../../lib/i18n/access";
import { Dialog, DialogContent, DialogTitle } from "../shadcn/dialog";
import { AuthForm } from "./auth-form";
import { AuthPresentation } from "./auth-presentation";
const AccessContext = createContext<((screen: AuthScreen) => void) | null>(
	null,
);
export function AccessLink({
	locale,
	screen,
	children,
	className = "",
}: {
	locale: Locale;
	screen: AuthScreen;
	children: ReactNode;
	className?: string;
}) {
	const open = useContext(AccessContext);
	return (
		<Link
			href={authHref(locale, screen)}
			className={className}
			onClick={(event) => {
				if (
					event.defaultPrevented ||
					!open ||
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				)
					return;
				event.preventDefault();
				open(screen);
			}}
		>
			{children}
		</Link>
	);
}
export function AccessProvider({
	locale,
	children,
}: {
	locale: Locale;
	children: ReactNode;
}) {
	const search = useSearchParams();
	const [screen, setScreen] = useState<AuthScreen | null>(null);
	const [audience, setAudience] = useState<"buyer" | "seller">("buyer");
	const dialog = useRef<HTMLDivElement>(null);
	const trigger = useRef<HTMLElement | null>(null);
	const scroll = useRef<HTMLDivElement>(null);
	const open = screen !== null;
	const split =
		audience === "buyer" ||
		screen === "seller-sign-in" ||
		screen === "seller-registration";
	useEffect(() => {
		if (!screen) return;
		const frame = requestAnimationFrame(() => {
			scroll.current?.scrollTo(0, 0);
			dialog.current?.querySelector<HTMLElement>("h1")?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [screen]);

	const openScreen = useCallback(
		(next: AuthScreen, parameters?: URLSearchParams, hash?: string) => {
			if (!modalScreens.includes(next)) return;
			if (!dialog.current && document.activeElement instanceof HTMLElement)
				trigger.current = document.activeElement;
			const url = new URL(window.location.href);
			const previous = url.searchParams.get("auth");
			const supplied = new URLSearchParams(parameters ?? url.searchParams);
			if (!supplied.has("return") && url.searchParams.has("return"))
				supplied.set("return", url.searchParams.get("return") ?? "");
			const fallback =
				url.searchParams.get("context") === "seller" ||
				url.pathname.endsWith("/sell")
					? "seller"
					: "buyer";
			const role = authAudience(next, supplied, fallback);
			const query = authParameters(next, supplied, role);
			for (const key of [
				"auth",
				"google",
				"attempt",
				"context",
				"action",
				"return",
			])
				url.searchParams.delete(key);
			query.forEach((value, key) => {
				url.searchParams.set(key, value);
			});
			const acceptsToken = next === "verify-email" || next === "reset-password";
			url.hash = acceptsToken
				? (hash ?? (previous === next ? url.hash : ""))
				: "";
			setAudience(role);
			setScreen(next);
			window.history.pushState(null, "", url.pathname + url.search + url.hash);
			window.dispatchEvent(new Event(AUTH_NAVIGATION_CHANGED));
		},
		[],
	);
	function closeScreen() {
		setScreen(null);
		const url = new URL(window.location.href);
		clearAuthToken();
		url.hash = new URL(window.location.href).hash;
		for (const key of [
			"auth",
			"google",
			"attempt",
			"context",
			"action",
			"return",
		])
			url.searchParams.delete(key);
		window.history.replaceState(null, "", url.pathname + url.search + url.hash);
	}
	useEffect(() => {
		const candidate = search.get("auth") as AuthScreen | null;
		if (candidate && modalScreens.includes(candidate)) {
			setAudience(
				authAudience(
					candidate,
					new URLSearchParams(search),
					window.location.pathname.endsWith("/sell") ? "seller" : "buyer",
				),
			);
			setScreen(candidate);
		} else setScreen(null);
	}, [search]);
	useEffect(() => {
		function follow(event: globalThis.MouseEvent) {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			)
				return;
			const link =
				event.target instanceof Element ? event.target.closest("a") : null;
			if (!link || link.target || link.hasAttribute("download")) return;
			const url = new URL(link.href);
			if (url.origin !== location.origin) return;
			const prefix = `/${locale}/auth/`;
			const candidate = (
				url.pathname.startsWith(prefix)
					? url.pathname.slice(prefix.length)
					: url.searchParams.get("auth")
			) as AuthScreen;
			if (!modalScreens.includes(candidate)) return;
			event.preventDefault();
			openScreen(candidate, url.searchParams, url.hash);
		}
		document.addEventListener("click", follow, true);
		return () => document.removeEventListener("click", follow, true);
	}, [locale, openScreen]);

	return (
		<AccessContext.Provider value={openScreen}>
			{children}
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (!value) closeScreen();
				}}
			>
				{screen && (
					<DialogContent
						ref={dialog}
						lang={locale}
						dir={direction(locale)}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							if (trigger.current?.isConnected) trigger.current.focus();
						}}
						aria-describedby={undefined}
						closeLabel={accessCopy[locale].close}
						className={`max-h-[94dvh] ${split ? "max-w-2xl" : "max-w-sm"} gap-0 overflow-hidden border-0 bg-surface p-0 motion-reduce:animate-none`}
					>
						<DialogTitle className="sr-only">
							{screenTitle(locale, screen)}
						</DialogTitle>
						<div
							ref={scroll}
							className="max-h-[94dvh] overflow-y-auto overscroll-contain rounded-card"
						>
							<AuthPresentation
								locale={locale}
								seller={audience === "seller"}
								split={split}
								inDialog
							>
								<Suspense>
									<AuthForm
										key={`${screen}:${audience}`}
										locale={locale}
										screen={screen}
										audience={audience}
									/>
								</Suspense>
							</AuthPresentation>
						</div>
					</DialogContent>
				)}
			</Dialog>
		</AccessContext.Provider>
	);
}
