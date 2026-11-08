import { EmptyState } from "./empty-state";

export interface RankedProduct {
	id: string;
	name: string;
	rank: number;
	sales: number;
	/** Bar width from 0 to 100 relative to the best seller. */
	share: number;
}

export function TopProductsList({
	products,
	locale,
	emptyTitle,
	emptyDescription,
}: {
	products: RankedProduct[];
	locale: string;
	emptyTitle: string;
	emptyDescription: string;
}) {
	if (!products.length)
		return (
			<EmptyState
				borderless
				icon="box"
				title={emptyTitle}
				description={emptyDescription}
			/>
		);

	const count = new Intl.NumberFormat(locale);

	return (
		<ol className="min-w-0 list-none p-0">
			{products.map((product) => (
				<li
					key={product.id}
					className="border-b border-border py-3 last:border-0"
				>
					<div className="flex items-baseline justify-between gap-3">
						<p className="min-w-0 truncate text-sm font-medium text-foreground">
							<span className="me-2 text-muted tabular-nums">
								<bdi>{count.format(product.rank)}</bdi>
							</span>
							{product.name}
						</p>
						<p className="shrink-0 text-sm text-muted tabular-nums">
							<bdi>{count.format(product.sales)}</bdi>
						</p>
					</div>
					<div
						role="progressbar"
						aria-valuenow={Math.round(product.share)}
						aria-valuemin={0}
						aria-valuemax={100}
						aria-label={product.name}
						className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-info"
					>
						<div
							className="h-full rounded-full bg-action"
							style={{ width: `${Math.min(Math.max(product.share, 0), 100)}%` }}
						/>
					</div>
				</li>
			))}
		</ol>
	);
}
