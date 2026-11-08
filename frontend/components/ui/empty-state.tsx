import type { ComponentProps } from "react";
import { Icon, type IconName } from "./icon";

export function EmptyState({
	icon = "inbox",
	title,
	description,
	action,
	borderless = false,
	className = "",
	...props
}: ComponentProps<"div"> & {
	icon?: IconName;
	title: string;
	description?: string;
	action?: React.ReactNode;
	borderless?: boolean;
}) {
	return (
		<div
			className={`flex min-h-[12rem] min-w-0 flex-col items-center justify-center p-6 text-center wrap-anywhere ${borderless ? "" : "rounded-card border border-dashed border-border bg-surface"} ${className}`}
			{...props}
		>
			<Icon name={icon} className="mb-3 size-12 text-muted" />
			<h3 className="text-body font-semibold text-foreground">{title}</h3>
			{description && (
				<p className="mt-2 max-w-md text-body text-muted">{description}</p>
			)}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
