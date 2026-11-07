import type { ComponentProps } from "react";

export function SectionCard({
	title,
	description,
	children,
	className = "",
	...props
}: ComponentProps<"section"> & {
	title?: string;
	description?: string;
}) {
	return (
		<section
			className={`rounded-card border border-border bg-surface p-5 shadow-sm desktop:p-6 ${className}`}
			{...props}
		>
			{title && (
				<div className="mb-4">
					<h2 className="text-section-title font-bold text-foreground">
						{title}
					</h2>
					{description && (
						<p className="mt-1 text-body text-muted">{description}</p>
					)}
				</div>
			)}
			{children}
		</section>
	);
}
