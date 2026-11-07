import type { ComponentProps } from "react";

export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
	return (
		<div
			className={`animate-pulse rounded-sm bg-border/60 ${className}`}
			aria-busy="true"
			{...props}
		/>
	);
}

export function CardSkeleton({
	lines = 3,
	className = "",
}: {
	lines?: number;
	className?: string;
}) {
	return (
		<div
			className={`rounded-card border border-border bg-surface p-5 shadow-sm ${className}`}
			aria-busy="true"
		>
			<Skeleton className="mb-3 h-4 w-1/3" />
			{Array.from({ length: lines }).map((_, i) => (
				<Skeleton
					// biome-ignore lint/suspicious/noArrayIndexKey: Static skeleton rows, order never changes
					key={i}
					className={`mb-2 h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
				/>
			))}
		</div>
	);
}

export function StatCardSkeleton({ className = "" }: { className?: string }) {
	return (
		<div
			className={`min-w-0 rounded-card border border-border bg-surface p-5 shadow-sm ${className}`}
			aria-busy="true"
		>
			<div className="flex items-start gap-3">
				<Skeleton className="size-10 shrink-0 rounded-full" />
				<div className="flex-1">
					<Skeleton className="mb-2 h-3 w-1/2" />
					<Skeleton className="h-7 w-1/3" />
				</div>
			</div>
		</div>
	);
}
