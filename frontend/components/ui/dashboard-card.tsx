import type { ComponentProps, ReactNode } from "react";

export const cardClass =
	"min-w-0 rounded-card border border-transparent bg-surface p-4 shadow-card dark:border-border desktop:p-6";

export function DashboardCard({
	title,
	description,
	action,
	children,
	className = "",
	...props
}: ComponentProps<"section"> & {
	title: string;
	description?: string;
	action?: ReactNode;
}) {
	return (
		<section className={`${cardClass} ${className}`} {...props}>
			<div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
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
				{action}
			</div>
			{children}
		</section>
	);
}
