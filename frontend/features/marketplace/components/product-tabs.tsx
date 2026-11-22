"use client";
import { useRef, useState, type ReactNode } from "react";
import { direction, type Locale } from "../../../lib/i18n/locales";
export function ProductTabs({
	locale,
	tabs,
}: {
	locale: Locale;
	tabs: { id: string; label: string; panel: ReactNode }[];
}) {
	const [active, setActive] = useState(0),
		refs = useRef<(HTMLButtonElement | null)[]>([]),
		rtl = direction(locale) === "rtl",
		current = tabs[active] ?? tabs[0];
	const move = (next: number) => {
		const index = (next + tabs.length) % tabs.length;
		setActive(index);
		refs.current[index]?.focus();
	};
	return (
		<section className="rounded-card border border-border bg-surface shadow-card">
			<div
				role="tablist"
				aria-label={tabs[0]?.label}
				className="carousel-track flex gap-1 overflow-x-auto border-b border-border px-3 sm:px-5 desktop:justify-center"
				onKeyDown={(event) => {
					if (event.key === "ArrowRight") move(active + (rtl ? -1 : 1));
					else if (event.key === "ArrowLeft") move(active + (rtl ? 1 : -1));
					else if (event.key === "Home") move(0);
					else if (event.key === "End") move(tabs.length - 1);
					else return;
					event.preventDefault();
				}}
			>
				{tabs.map((tab, i) => (
					<button
						key={tab.id}
						ref={(node) => {
							refs.current[i] = node;
						}}
						type="button"
						role="tab"
						id={`product-tab-${tab.id}`}
						aria-selected={i === active}
						aria-controls={`product-panel-${tab.id}`}
						tabIndex={i === active ? 0 : -1}
						onClick={() => setActive(i)}
						className={`inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-bold transition-colors hover:bg-page/60 ${
							i === active
								? "border-action text-action"
								: "border-transparent text-muted hover:text-foreground"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>
			{current && (
				<div
					role="tabpanel"
					id={`product-panel-${current.id}`}
					aria-labelledby={`product-tab-${current.id}`}
					// biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tabs pattern requires a focusable panel when it holds no focusable children.
					tabIndex={0}
					className="p-4 sm:p-5"
				>
					{current.panel}
				</div>
			)}
		</section>
	);
}
