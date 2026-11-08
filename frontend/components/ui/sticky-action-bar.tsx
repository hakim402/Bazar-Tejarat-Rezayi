import type { ComponentProps, CSSProperties } from "react";

export type StickyActionBarProps = ComponentProps<"div"> & {
	mobileBottomNavHeight?: string;
};

export function StickyActionBar({
	children,
	mobileBottomNavHeight,
	style,
	className = "",
	...props
}: StickyActionBarProps) {
	const barStyle: CSSProperties & { "--mobile-bottom-nav-height"?: string } = {
		...style,
		...(mobileBottomNavHeight != null
			? { "--mobile-bottom-nav-height": mobileBottomNavHeight }
			: {}),
	};

	return (
		<div
			className={`sticky bottom-[calc(var(--mobile-bottom-nav-height,4rem)+env(safe-area-inset-bottom,0px))] z-10 border-t border-border bg-surface/95 backdrop-blur-sm sm:bottom-0 desktop:rounded-b-card ${className}`}
			style={barStyle}
			{...props}
		>
			<div className="flex min-w-0 flex-wrap items-center justify-end gap-3 p-4">
				{children}
			</div>
		</div>
	);
}
