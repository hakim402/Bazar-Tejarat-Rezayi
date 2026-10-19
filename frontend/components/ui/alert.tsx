import type { ComponentProps } from "react";
const variants = {
	danger: "account-error rounded-control bg-danger-surface text-danger",
	success: "account-success border-s-3 border-action bg-info",
	info: "notice-draft border-s-3 border-action bg-info text-base",
} as const;
export function Alert({
	variant = "danger",
	className = "",
	...props
}: ComponentProps<"p"> & { variant?: keyof typeof variants }) {
	return (
		<p
			className={`mt-3 mb-5 p-3.5 ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
