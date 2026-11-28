"use client";

import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const AuthLinksPanel = createContext<HTMLElement | null>(null);

/** Keep the same actions next to the form on wide screens and below it on phones. */
export function AuthSecondaryLinks({ children }: { children: ReactNode }) {
	const panel = useContext(AuthLinksPanel);
	return (
		<>
			<nav
				className={`account-links mt-5 grid gap-2 border-0 border-t border-solid border-border pt-4 text-sm font-medium [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:justify-center [&_a]:rounded-lg [&_a]:border [&_a]:border-solid [&_a]:border-border [&_a]:px-3 [&_a]:py-2 [&_a]:text-center [&_a]:no-underline [&_a]:transition-colors [&_a:hover]:bg-info [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-action ${panel ? "desktop:hidden" : ""}`}
			>
				{children}
			</nav>
			{panel &&
				createPortal(
					<nav className="account-links hidden gap-2 text-sm font-medium desktop:grid [&_a]:flex [&_a]:min-h-11 [&_a]:items-center [&_a]:justify-start [&_a]:rounded-lg [&_a]:border [&_a]:border-solid [&_a]:border-brand-ink/25 [&_a]:bg-brand-ink/5 [&_a]:px-3 [&_a]:py-2.5 [&_a]:text-start [&_a]:text-brand-ink [&_a]:no-underline [&_a]:transition-colors [&_a:hover]:border-brand-ink/60 [&_a:hover]:bg-brand-ink/15 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-brand-ink">
						{children}
					</nav>,
					panel,
				)}
		</>
	);
}
