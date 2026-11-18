import type { ReactNode } from "react";
import { cn } from "../../../lib/shadcn-utils";

export function Figure({
	label,
	strong = false,
	valueClass,
	children,
}: {
	label: string;
	strong?: boolean;
	valueClass?: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-0 border-t border-solid border-border py-2 first:border-t-0">
			<dt className="text-sm text-muted">{label}</dt>
			<dd
				className={cn(
					"m-0 tabular-nums text-foreground",
					strong ? "text-base font-bold" : "text-sm font-semibold",
					valueClass,
				)}
			>
				{children}
			</dd>
		</div>
	);
}
