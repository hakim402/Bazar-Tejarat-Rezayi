import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./icon";
import { cardClass } from "./dashboard-card";

type ChipVariant =
	| "info"
	| "success"
	| "warning"
	| "danger"
	| "neutral"
	| "accent";

const chipStyles: Record<ChipVariant, string> = {
	info: "bg-chip-info-bg text-chip-info-icon",
	success: "bg-chip-success-bg text-chip-success",
	warning: "bg-chip-warning-bg text-chip-warning-icon",
	danger: "bg-chip-danger-bg text-chip-danger",
	neutral: "bg-chip-neutral-bg text-chip-neutral",
	accent: "bg-chip-accent-bg text-chip-accent",
};

export function StatCard({
	icon,
	chip = "info",
	label,
	value,
	hint,
	locale,
	href,
	className = "",
	...props
}: ComponentProps<"div"> & {
	icon: IconName;
	chip?: ChipVariant;
	label: string;
	value: ReactNode;
	hint?: ReactNode;
	locale?: string;
	href?: string;
}) {
	const effectiveChip = value === 0 ? "neutral" : chip;
	const clickable = Boolean(href || props.onClick);
	const content = (
		<div
			className={`h-full min-h-28 ${cardClass} ${clickable ? "cursor-pointer transition-[translate,box-shadow] duration-150 motion-safe:hover:-translate-y-px hover:shadow-lifted motion-reduce:transition-none" : ""} ${className}`}
			{...props}
		>
			<div className="flex items-start gap-3">
				<div
					className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${chipStyles[effectiveChip]}`}
					aria-hidden="true"
				>
					<Icon name={icon} className="size-5" />
				</div>
				<div className="min-w-0 flex-1 wrap-anywhere">
					<p className="text-sm font-medium text-muted">{label}</p>
					<p className="mt-1 text-3xl font-bold text-foreground tabular-nums">
						<bdi>
							{typeof value === "number" && locale
								? new Intl.NumberFormat(locale).format(value)
								: value}
						</bdi>
					</p>
					{hint != null && (
						<div className="mt-1 text-caption text-muted">{hint}</div>
					)}
				</div>
			</div>
		</div>
	);

	if (href) {
		return (
			<Link href={href} className="block h-full min-w-0 no-underline">
				{content}
			</Link>
		);
	}

	return content;
}
