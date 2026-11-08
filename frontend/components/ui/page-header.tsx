import type { ComponentProps } from "react";

export function PageHeader({
	title,
	description,
	actions,
	compact = false,
	className = "",
	...props
}: ComponentProps<"header"> & {
	title: string;
	description?: string;
	actions?: React.ReactNode;
	compact?: boolean;
}) {
	return (
		<header
			className={`flex flex-wrap ${compact ? "items-center" : "items-start"} justify-between gap-4 ${className}`}
			{...props}
		>
			<div
				className={`min-w-0 flex-1 ${compact ? "basis-full sm:basis-auto" : ""}`}
			>
				<h1
					className={`${compact ? "text-section-title font-semibold" : "text-page-title font-bold"} text-foreground`}
				>
					{title}
				</h1>
				{description && (
					<p className="mt-1 max-w-2xl text-body text-muted">{description}</p>
				)}
			</div>
			{actions && (
				<div
					className={`flex max-w-full flex-wrap items-center gap-2 ${compact ? "w-full min-w-0 sm:w-auto" : "shrink-0"}`}
				>
					{actions}
				</div>
			)}
		</header>
	);
}
