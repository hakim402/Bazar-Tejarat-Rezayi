import type { ComponentProps } from "react";
import { Button } from "./button";

export function FilterBar({
	children,
	onSubmit,
	applyLabel = "Apply filters",
	className = "",
	...props
}: ComponentProps<"form"> & {
	onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
	applyLabel?: string;
}) {
	return (
		<form
			className={`flex flex-wrap items-end gap-3 ${className}`}
			onSubmit={(e) => {
				e.preventDefault();
				onSubmit?.(e);
			}}
			{...props}
		>
			<div className="flex flex-1 flex-wrap items-end gap-3">{children}</div>
			<Button type="submit" className="mt-0">
				{applyLabel}
			</Button>
		</form>
	);
}
