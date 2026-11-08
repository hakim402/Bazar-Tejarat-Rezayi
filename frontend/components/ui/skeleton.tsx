import type { ComponentProps } from "react";

export function Skeleton({ className = "", ...props }: ComponentProps<"div">) {
	return (
		<div
			className={`animate-pulse rounded-sm bg-border/60 motion-reduce:animate-none ${className}`}
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
			className={`min-w-0 rounded-card border border-border bg-surface p-5 shadow-sm ${className}`}
			aria-busy="true"
		>
			<Skeleton className="mb-3 h-4 w-1/3" />
			{Array.from({ length: lines }, (_, i) => ({
				id: `line-${i}`,
				last: i === lines - 1,
			})).map((line) => (
				<Skeleton
					key={line.id}
					className={`mb-2 h-3 ${line.last ? "w-2/3" : "w-full"}`}
				/>
			))}
		</div>
	);
}

export function StatCardSkeleton({ className = "" }: { className?: string }) {
	return (
		<div
			className={`h-full min-h-28 min-w-0 rounded-card border border-transparent bg-surface p-4 shadow-card dark:border-border desktop:p-6 ${className}`}
			aria-busy="true"
		>
			<div className="flex items-start gap-3">
				<Skeleton className="size-11 shrink-0 rounded-xl" />
				<div className="min-w-0 flex-1">
					<Skeleton className="mb-2 h-3 w-1/2" />
					<Skeleton className="h-9 w-1/3" />
				</div>
			</div>
		</div>
	);
}

export function TableSkeleton({
	rows = 4,
	columns = 4,
	className = "",
	...props
}: ComponentProps<"div"> & {
	rows?: number;
	columns?: number;
}) {
	const rowItems = Array.from({ length: rows }, (_, i) => `row-${i}`);
	const columnItems = Array.from({ length: columns }, (_, i) => `column-${i}`);
	const gridStyle = {
		gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
	};

	return (
		<div className={`min-w-0 ${className}`} aria-busy="true" {...props}>
			<div aria-hidden="true">
				<div className="hidden desktop:block">
					<div
						className="grid gap-4 border-b border-border p-3"
						style={gridStyle}
					>
						{columnItems.map((column) => (
							<Skeleton key={column} className="h-3 w-2/3" />
						))}
					</div>
					{rowItems.map((row) => (
						<div
							key={row}
							className="grid gap-4 border-b border-border p-3 last:border-0"
							style={gridStyle}
						>
							{columnItems.map((column) => (
								<Skeleton key={column} className="h-4 w-full" />
							))}
						</div>
					))}
				</div>
				<div className="space-y-3 desktop:hidden">
					{rowItems.map((row) => (
						<CardSkeleton key={row} lines={columns} />
					))}
				</div>
			</div>
		</div>
	);
}

export function DashboardSkeleton({
	className = "",
	showHeader = true,
	...props
}: ComponentProps<"div"> & { showHeader?: boolean }) {
	return (
		<div className={`min-w-0 ${className}`} aria-busy="true" {...props}>
			<div aria-hidden="true" className="space-y-5">
				{showHeader && (
					<div className="flex flex-wrap items-center justify-between gap-3">
						<Skeleton className="h-7 w-40" />
						<Skeleton className="h-11 w-60 max-w-full rounded-control" />
					</div>
				)}
				<div className="grid auto-rows-fr grid-cols-2 gap-4 desktop:grid-cols-4">
					{["catalogue", "variants", "attention", "active"].map((id) => (
						<StatCardSkeleton key={id} />
					))}
				</div>
				<div className="grid gap-4 desktop:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
					<CardSkeleton lines={5} className="min-h-56" />
					<CardSkeleton lines={4} className="min-h-56" />
				</div>
				<div className="grid gap-4 desktop:grid-cols-2 lg:grid-cols-3">
					{["orders", "products", "messages"].map((id) => (
						<CardSkeleton key={id} lines={4} className="min-h-48" />
					))}
				</div>
				<CardSkeleton lines={2} />
			</div>
		</div>
	);
}
