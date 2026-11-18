import type { ComponentProps, ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export const cardClass =
	"min-w-0 rounded-card border border-transparent bg-surface p-4 shadow-card dark:border-border desktop:p-6";

export function DashboardCard({
	title,
	description,
	action,
	icon,
	children,
	className = "",
	...props
}: ComponentProps<"section"> & {
	title: string;
	description?: string;
	action?: ReactNode;
	icon?: IconName;
}) {
	return (
		<section className={`${cardClass} ${className}`} {...props}>
			<div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
				<div className="flex min-w-0 items-center gap-3">
					{icon && (
						<span
							className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info text-action"
							aria-hidden="true"
						>
							<Icon name={icon} className="size-4" />
						</span>
					)}
					<div className="min-w-0">
						<h2 className="text-base font-semibold text-foreground wrap-anywhere">
							{title}
						</h2>
						{description && (
							<p className="mt-1 text-sm text-muted wrap-anywhere">
								{description}
							</p>
						)}
					</div>
				</div>
				{action}
			</div>
			{children}
		</section>
	);
}
