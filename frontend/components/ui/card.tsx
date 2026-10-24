import type { ComponentProps } from "react";
export function Card({ className = "", ...props }: ComponentProps<"section">) {
	return (
		<section
			className={`min-w-0 rounded-card border border-border bg-surface shadow-card p-6 desktop:p-8 ${className}`}
			{...props}
		/>
	);
}
