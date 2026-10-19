import type { ComponentProps } from "react";
const variants = {
	primary: "min-h-13 border-primary bg-primary text-on-primary rounded-control",
	secondary:
		"min-h-13 border-control bg-transparent text-action rounded-control",
	google:
		"min-h-11 border-provider-border bg-provider-surface text-provider-foreground rounded-provider font-provider",
} as const;
export function Button({
	variant = "primary",
	className = "",
	type = "button",
	...props
}: ComponentProps<"button"> & { variant?: keyof typeof variants }) {
	return (
		<button
			type={type}
			className={`mt-3 flex items-center justify-center gap-3 border px-4 py-3 font-bold cursor-pointer disabled:opacity-65 disabled:cursor-wait ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
