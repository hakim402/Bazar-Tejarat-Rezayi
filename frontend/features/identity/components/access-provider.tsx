"use client";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	Suspense,
	type ReactNode,
	type MouseEvent,
	type KeyboardEvent,
} from "react";
import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { direction } from "../../../lib/i18n/locales";
import { screenTitle, type AuthScreen } from "../../../lib/i18n/auth-screens";
import { accessCopy } from "../../../lib/i18n/access";
import { Icon } from "../../../components/ui/icon";
import { AuthForm } from "./auth-form";
import { AuthPresentation } from "./auth-presentation";
const modalScreens: readonly AuthScreen[] = [
	"buyer-sign-in",
	"seller-sign-in",
	"buyer-registration",
	"seller-registration",
	"forgot-password",
	"policy-draft",
];
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
			href={`/${locale}/auth/${screen}`}
			className={className}
			onClick={(event) => {
				if (
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
	const [screen, setScreen] = useState<AuthScreen | null>(null);
	const [audience, setAudience] = useState<"buyer" | "seller">("buyer");
	const dialog = useRef<HTMLDialogElement>(null);
	const scroll = useRef<HTMLDivElement>(null);
	const open = screen !== null;
	const split =
		audience === "buyer" ||
		screen === "seller-sign-in" ||
		screen === "seller-registration";
	useEffect(() => {
		if (!open) return;
		const element = dialog.current;
		const trigger =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		element?.showModal();
		const previous = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			element?.close();
			document.body.style.overflow = previous;
			queueMicrotask(() => {
				if (trigger?.isConnected) trigger.focus();
			});
		};
	}, [open]);
	useEffect(() => {
		if (!screen) return;
		const frame = requestAnimationFrame(() => {
			scroll.current?.scrollTo(0, 0);
			dialog.current?.querySelector<HTMLElement>("h1")?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [screen]);
	function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
		if (event.key !== "Tab") return;
		const element = event.currentTarget;
		const controls = Array.from(
			element.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
			),
		).filter(
			(control) =>
				control.getClientRects().length > 0 && !control.closest("[inert]"),
		);
		const first = controls[0],
			last = controls.at(-1);
		if (!first || !last) {
			event.preventDefault();
			return;
		}
		if (
			event.shiftKey &&
			(document.activeElement === first ||
				document.activeElement?.tagName === "H1")
		) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function openScreen(next: AuthScreen) {
		if (next.startsWith("seller")) setAudience("seller");
		else if (next.startsWith("buyer")) setAudience("buyer");
		setScreen(next);
	}
	function changeScreen(event: MouseEvent<HTMLDivElement>) {
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
		const candidate = url.pathname.replace(
			`/${locale}/auth/`,
			"",
		) as AuthScreen;
		if (
			url.origin !== location.origin ||
			!url.pathname.startsWith(`/${locale}/auth/`) ||
			!modalScreens.includes(candidate)
		)
			return;
		event.preventDefault();
		openScreen(candidate);
		scroll.current?.scrollTo(0, 0);
	}
	return (
		<AccessContext.Provider value={openScreen}>
			{children}
			{screen && (
				<dialog
					ref={dialog}
					aria-label={screenTitle(locale, screen)}
					lang={locale}
					dir={direction(locale)}
					onKeyDown={trapFocus}
					onCancel={() => setScreen(null)}
					onClose={() => setScreen(null)}
					className={`fixed m-auto max-h-[94dvh] w-[calc(100%_-_2rem)] ${split ? "max-w-2xl" : "max-w-sm"} overflow-visible rounded-card border-0 bg-transparent p-0 text-foreground backdrop:bg-foreground/50 backdrop:backdrop-blur-sm`}
				>
					<button
						type="button"
						aria-label={accessCopy[locale].close}
						className="absolute end-2 top-2 z-10 flex size-8 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-card hover:bg-info"
						onClick={() => setScreen(null)}
					>
						<Icon name="close" />
					</button>
					<div
						ref={scroll}
						className="max-h-[94dvh] overflow-y-auto overscroll-contain rounded-card"
						onClickCapture={changeScreen}
					>
						<AuthPresentation
							locale={locale}
							seller={audience === "seller"}
							split={split}
							inDialog
						>
							<Suspense>
								<AuthForm
									key={screen}
									locale={locale}
									screen={screen}
									audience={audience}
								/>
							</Suspense>
						</AuthPresentation>
					</div>
				</dialog>
			)}
		</AccessContext.Provider>
	);
}
