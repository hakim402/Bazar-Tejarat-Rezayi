"use client";
import Image from "next/image";
import { Package } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Card } from "../../../components/shadcn/card";
import { Icon, type IconName } from "../../../components/ui/icon";
import { apiOrigin } from "../../../lib/api/client";
import { cn } from "../../../lib/shadcn-utils";

export function ProductThumbnail({
	src,
	className,
}: {
	src?: string | null;
	className?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<span
			className={cn(
				"relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-solid border-border bg-page text-muted",
				className,
			)}
		>
			{src && !failed ? (
				<Image
					src={apiOrigin(process.env.NEXT_PUBLIC_API_URL) + src}
					alt=""
					fill
					sizes="48px"
					unoptimized
					className="object-cover"
					onError={() => setFailed(true)}
				/>
			) : (
				<Package className="size-5" aria-hidden="true" />
			)}
		</span>
	);
}

export function DetailCard({
	title,
	icon,
	action,
	children,
	className,
}: {
	title: string;
	icon?: IconName;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<Card
			className={cn(
				"gap-0 rounded-2xl border-border bg-surface py-0 shadow-xs",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-3 border-b border-solid border-border px-4 py-3.5 sm:px-5">
				<h2 className="m-0 flex items-center gap-2 text-sm font-semibold">
					{icon && <Icon name={icon} className="size-4 text-muted" />}
					{title}
				</h2>
				{action}
			</div>
			<div className="px-4 py-4 sm:px-5">{children}</div>
		</Card>
	);
}

export function DetailField({
	label,
	children,
	className,
}: {
	label: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("min-w-0 space-y-1", className)}>
			<dt className="text-xs font-medium text-muted">{label}</dt>
			<dd className="m-0 text-sm font-medium text-foreground">{children}</dd>
		</div>
	);
}

export function Money({
	amount,
	currency,
	className,
}: {
	amount: string;
	currency: string;
	className?: string;
}) {
	return (
		<bdi className={cn("tabular-nums", className)}>
			{amount} {currency}
		</bdi>
	);
}