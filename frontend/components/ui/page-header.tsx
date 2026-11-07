import type { ComponentProps } from "react";

export function PageHeader({
	title,
	description,
	actions,
	className = "",
	...props
}: ComponentProps<"header"> & {
	title: string;
	description?: string;
	actions?: React.ReactNode;
}) {
	return (
		<header
			className={`flex flex-wrap items-start justify-between gap-4 ${className}`}
			{...props}
		>
			<div className="min-w-0 flex-1">
				<h1 className="text-page-title font-bold text-foreground">{title}</h1>
				{description && (
					<p className="mt-1 max-w-2xl text-body text-muted">{description}</p>
				)}
			</div>
			{actions && (
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{actions}
				</div>
			)}
		</header>
	);
}
