import type { ComponentProps, ReactNode } from "react";

export function SectionCard({
	title,
	description,
	icon,
	children,
	className = "",
	...props
}: ComponentProps<"section"> & {
	title?: string;
	description?: string;
	icon?: ReactNode;
}) {
	return (
		<section
			className={`min-w-0 rounded-card border border-border bg-surface p-5 shadow-sm ${className}`}
			{...props}
		>
			{title && (
				<div className="mb-3 min-w-0">
					<h2
						className={`text-section-title font-semibold text-foreground${icon ? " flex min-w-0 items-center gap-2" : ""}`}
					>
						{icon}
						{title}
					</h2>
					{description && (
						<p className="mt-1 text-caption text-muted wrap-anywhere">
							{description}
						</p>
					)}
				</div>
			)}
			{children}
		</section>
	);
}
