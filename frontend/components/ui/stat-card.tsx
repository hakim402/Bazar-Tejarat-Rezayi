import type { ComponentProps } from "react";
import { Icon, type IconName } from "./icon";

type ChipVariant = "info" | "success" | "warning" | "danger" | "neutral";

const chipStyles: Record<ChipVariant, string> = {
	info: "bg-chip-info text-chip-info-fg",
	success: "bg-chip-success text-chip-success-fg",
	warning: "bg-chip-warning text-chip-warning-fg",
	danger: "bg-chip-danger text-chip-danger-fg",
	neutral: "bg-chip-neutral text-chip-neutral-fg",
};

export function StatCard({
	icon,
	chip = "info",
	label,
	value,
	hint,
	href,
	className = "",
	...props
}: ComponentProps<"div"> & {
	icon: IconName;
	chip?: ChipVariant;
	label: string;
	value: string | number;
	hint?: string;
	href?: string;
}) {
	const content = (
		<div
			className={`min-w-0 rounded-card border border-border bg-surface p-5 shadow-sm transition-shadow hover:shadow-lifted ${href ? "cursor-pointer" : ""} ${className}`}
			{...props}
		>
			<div className="flex items-start gap-3">
				<div
					className={`flex size-10 shrink-0 items-center justify-center rounded-full ${chipStyles[chip]}`}
					aria-hidden="true"
				>
					<Icon name={icon} className="size-5" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-caption text-muted">{label}</p>
					<p
						className="mt-1 text-kpi font-bold tabular-nums"
						style={{ fontVariantNumeric: "tabular-nums" }}
					>
						<bdi>{value}</bdi>
					</p>
					{hint && <p className="mt-1 text-caption text-muted">{hint}</p>}
				</div>
			</div>
		</div>
	);

	if (href) {
		return (
			<a href={href} className="no-underline">
				{content}
			</a>
		);
	}

	return content;
}
