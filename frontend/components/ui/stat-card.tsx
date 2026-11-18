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
	compact = false,
	flat = false,
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
	compact?: boolean;
	flat?: boolean;
}) {
	if (flat) {
		return (
			<div
				className={`flex items-center gap-3 rounded-xl border border-solid border-border bg-surface p-4 ${className}`}
				{...props}
			>
				<span
					className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-page text-action"
					aria-hidden="true"
				>
					<Icon name={icon} className="size-5" />
				</span>
				<div className="min-w-0">
					<p className="m-0 text-xs font-medium text-muted">{label}</p>
					<p className="m-0 text-2xl font-bold tabular-nums text-foreground">
						<bdi>
							{typeof value === "number" && locale
								? new Intl.NumberFormat(locale).format(value)
								: value}
						</bdi>
					</p>
				</div>
			</div>
		);
	}
	const effectiveChip = value === 0 ? "neutral" : chip;
	const clickable = Boolean(href || props.onClick);
	const content = (
		<div
			className={`h-full ${compact ? "min-w-0 rounded-card border border-transparent bg-surface p-2.5 shadow-card sm:min-h-28 sm:p-4 dark:border-border desktop:p-6" : `min-h-28 ${cardClass}`} ${clickable ? "cursor-pointer transition-[translate,box-shadow] duration-150 motion-safe:hover:-translate-y-px hover:shadow-lifted motion-reduce:transition-none" : ""} ${className}`}
			{...props}
		>
			<div
				className={
					compact
						? "flex h-full flex-col items-center justify-center gap-1.5 text-center sm:flex-row sm:items-start sm:gap-3 sm:text-start"
						: "flex items-start gap-3"
				}
			>
				<div
					className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? "size-8 sm:size-11" : "size-11"} ${chipStyles[effectiveChip]}`}
					aria-hidden="true"
				>
					<Icon
						name={icon}
						className={compact ? "size-4 sm:size-5" : "size-5"}
					/>
				</div>
				<div
					className={
						compact
							? "flex min-w-0 flex-1 flex-col items-center wrap-anywhere sm:block"
							: "min-w-0 flex-1 wrap-anywhere"
					}
				>
					<p
						className={
							compact
								? "order-2 mt-0.5 text-caption font-medium text-muted sm:order-none sm:mt-0 sm:text-sm"
								: "text-sm font-medium text-muted"
						}
					>
						{label}
					</p>
					<p
						className={
							compact
								? "order-1 text-lg font-bold text-foreground tabular-nums sm:order-none sm:mt-1 sm:text-3xl"
								: "mt-1 text-3xl font-bold text-foreground tabular-nums"
						}
					>
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
