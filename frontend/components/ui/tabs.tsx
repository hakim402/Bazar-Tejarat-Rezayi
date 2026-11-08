import Link from "next/link";
import type { ComponentProps } from "react";

export interface TabItem {
	label: string;
	href?: string;
	active?: boolean;
	onClick?: () => void;
}

export function TabNav({
	tabs,
	locale,
	className = "",
	...props
}: ComponentProps<"nav"> & {
	tabs: TabItem[];
	locale: string;
}) {
	return (
		<nav
			className={`flex min-w-0 flex-wrap gap-1 border-b border-border ${className}`}
			{...props}
		>
			{tabs.map((tab) => {
				const isActive = tab.active ?? false;
				if (tab.href) {
					return (
						<Link
							key={tab.label}
							href={tab.href}
							aria-current={isActive ? "page" : undefined}
							className={`min-h-11 px-4 py-2 text-body font-semibold no-underline transition-colors motion-reduce:transition-none ${
								isActive
									? "border-b-2 border-action text-action"
									: "text-muted hover:text-foreground"
							}`}
						>
							{tab.label}
						</Link>
					);
				}
				return (
					<button
						key={tab.label}
						type="button"
						aria-current={isActive ? "page" : undefined}
						onClick={tab.onClick}
						className={`min-h-11 cursor-pointer border-b-2 px-4 py-2 text-body font-semibold transition-colors motion-reduce:transition-none ${
							isActive
								? "border-action text-action"
								: "border-transparent text-muted hover:text-foreground"
						}`}
					>
						{tab.label}
					</button>
				);
			})}
		</nav>
	);
}

export function TabPanel({
	children,
	className = "",
	...props
}: ComponentProps<"div">) {
	return (
		<div className={`mt-6 ${className}`} {...props}>
			{children}
		</div>
	);
}
