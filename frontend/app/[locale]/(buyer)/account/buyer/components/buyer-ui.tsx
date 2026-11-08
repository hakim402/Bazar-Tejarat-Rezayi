"use client";
import type { ReactNode } from "react";

export const buyerAction =
	"inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control border border-border bg-surface px-4 py-2 text-sm font-semibold text-action shadow-sm transition-colors hover:border-action hover:bg-info disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";
export const buyerControl =
	"min-h-11 w-full min-w-0 rounded-control border border-border bg-surface px-3 py-2 text-base text-foreground shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-50";
export const buyerPanel =
	"min-w-0 space-y-4 rounded-card border border-border bg-surface p-4 shadow-sm sm:p-6";

export function BuyerFrame({ children }: { children: ReactNode }) {
	return (
		<div
			data-buyer-dashboard
			className="min-w-0 space-y-6 [&_label]:text-sm [&_label]:font-medium [&_input:not([type=checkbox]):not([type=radio])]:min-h-11 [&_input:not([type=checkbox]):not([type=radio])]:rounded-control [&_input:not([type=checkbox]):not([type=radio])]:text-base [&_textarea]:rounded-control [&_textarea]:text-base [&_select]:min-h-11 [&_select]:rounded-control [&_select]:text-base [&_fieldset]:min-w-0 [&_section]:scroll-mt-28 [&_h2]:tracking-tight [&_p]:wrap-anywhere [&_a]:wrap-anywhere [&_button]:motion-reduce:transition-none"
		>
			{children}
		</div>
	);
}
