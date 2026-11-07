import type { ComponentProps } from "react";

export function StickyActionBar({
	children,
	className = "",
	...props
}: ComponentProps<"div">) {
	return (
		<div
			className={`sticky bottom-0 z-10 border-t border-border bg-surface/95 backdrop-blur-sm desktop:rounded-b-card ${className}`}
			{...props}
		>
			<div className="flex flex-wrap items-center justify-end gap-3 p-4">
				{children}
			</div>
		</div>
	);
}
