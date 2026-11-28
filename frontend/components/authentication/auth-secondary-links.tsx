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
				className={`account-links mt-5 flex flex-nowrap items-center justify-center gap-0 overflow-x-auto border-0 border-t border-solid border-border pt-3 text-[10px] font-medium min-[380px]:text-xs [&_a]:shrink-0 [&_a]:px-1.5 [&_a]:py-2 [&_a]:text-center [&_a]:whitespace-nowrap [&_a]:no-underline [&_a+a]:border-0 [&_a+a]:border-s [&_a+a]:border-solid [&_a+a]:border-border [&_a:hover]:underline [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-action ${panel ? "desktop:hidden" : ""}`}
			>
				{children}
			</nav>
			{panel &&
				createPortal(
					<nav className="account-links hidden gap-1 border-0 border-t border-solid border-brand-ink/20 pt-3 text-xs font-medium desktop:flex desktop:flex-col desktop:items-start [&_a]:max-w-full [&_a]:rounded-sm [&_a]:py-1.5 [&_a]:text-start [&_a]:leading-relaxed [&_a]:text-brand-ink/85 [&_a]:no-underline [&_a:hover]:text-brand-ink [&_a:hover]:underline [&_a]:underline-offset-4 [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-brand-ink">
						{children}
					</nav>,
					panel,
				)}
		</>
	);
}
