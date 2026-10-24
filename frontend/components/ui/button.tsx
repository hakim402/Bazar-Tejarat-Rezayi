import type { ComponentProps } from "react";
const variants = {
	compact:
		"min-h-10 border-primary bg-primary text-on-primary hover:brightness-95 rounded-control",
	primary:
		"min-h-13 border-primary bg-primary text-on-primary hover:brightness-95 rounded-control",
	secondary:
		"min-h-13 border-border bg-surface hover:bg-info text-action rounded-control",
	google:
		"min-h-11 border-provider-border bg-provider-surface text-provider-foreground rounded-provider font-provider",
} as const;
export function Button({
	variant = "primary",
	className = "",
	type = "button",
	compact = false,
	...props
}: ComponentProps<"button"> & {
	variant?: keyof typeof variants;
	compact?: boolean;
}) {
	return (
		<button
			type={type}
			className={`${compact ? "mt-1 py-2 text-sm" : "mt-3 py-3"} inline-flex items-center justify-center gap-3 border px-4 font-bold cursor-pointer transition-colors motion-reduce:transition-none disabled:opacity-65 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
