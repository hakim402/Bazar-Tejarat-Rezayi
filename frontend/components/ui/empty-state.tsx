import type { ComponentProps } from "react";
import { Icon, type IconName } from "./icon";

export function EmptyState({
	icon = "inbox",
	title,
	description,
	action,
	className = "",
	...props
}: ComponentProps<"div"> & {
	icon?: IconName;
	title: string;
	description?: string;
	action?: React.ReactNode;
}) {
	return (
		<div
			className={`flex min-h-[12rem] flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface p-8 text-center ${className}`}
			{...props}
		>
			<div className="mb-4 flex size-14 items-center justify-center rounded-full bg-info/50 text-muted">
				<Icon name={icon} className="size-7" />
			</div>
			<h3 className="text-section-title font-bold text-foreground">{title}</h3>
			{description && (
				<p className="mt-2 max-w-md text-body text-muted">{description}</p>
			)}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
