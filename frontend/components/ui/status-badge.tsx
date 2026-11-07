import type { ComponentProps } from "react";

type BadgeVariant = "success" | "warning" | "danger" | "info" | "neutral";

const badgeStyles: Record<BadgeVariant, string> = {
	success: "bg-chip-success-bg text-chip-success",
	warning: "bg-chip-warning-bg text-chip-warning",
	danger: "bg-chip-danger-bg text-chip-danger",
	info: "bg-chip-info-bg text-chip-info",
	neutral: "bg-chip-neutral-bg text-chip-neutral",
};

export function StatusBadge({
	variant = "neutral",
	children,
	className = "",
	...props
}: ComponentProps<"span"> & {
	variant?: BadgeVariant;
}) {
	return (
		<span
			className={`inline-flex items-center rounded-sm px-2 py-0.5 text-caption font-semibold ${badgeStyles[variant]} ${className}`}
			{...props}
		>
			{children}
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
