import type { ComponentProps } from "react";

type BadgeVariant =
	| "success"
	| "warning"
	| "danger"
	| "info"
	| "neutral"
	| "accent";

const badgeStyles: Record<BadgeVariant, string> = {
	success: "bg-chip-success-bg text-chip-success",
	warning: "bg-chip-warning-bg text-chip-warning",
	danger: "bg-chip-danger-bg text-chip-danger",
	info: "bg-chip-info-bg text-chip-info",
	neutral: "bg-chip-neutral-bg text-chip-neutral",
	accent: "bg-chip-accent-bg text-chip-accent",
};

export function StatusBadge({
	variant = "neutral",
	dot = true,
	children,
	className = "",
	...props
}: ComponentProps<"span"> & {
	variant?: BadgeVariant;
	dot?: boolean;
}) {
	return (
		<span
			className={`inline-flex max-w-full items-center gap-1.5 rounded-sm px-2 py-0.5 text-caption font-semibold ${badgeStyles[variant]} ${className}`}
			{...props}
		>
			{dot && (
				<span
					aria-hidden="true"
					className="size-1.5 shrink-0 rounded-full bg-current"
				/>
			)}
			<span className="min-w-0 wrap-anywhere">{children}</span>
		</span>
	);
}

export function statusVariant(status: string): BadgeVariant {
	switch (status) {
		case "approved":
		case "active":
		case "verified":
		case "accepted":
		case "live":
		case "delivered":
			return "success";
		case "pending":
		case "submitted":
		case "under_review":
		case "needs_information":
		case "queued":
			return "warning";
		case "rejected":
		case "revoked":
		case "expired":
		case "cancelled":
		case "failed":
		case "delivery_failed":
		case "exhausted":
			return "danger";
		case "draft":
		case "withdrawn":
		case "captured":
		case "smtp_accepted":
			return "info";
		default:
			return "neutral";
	}
}
