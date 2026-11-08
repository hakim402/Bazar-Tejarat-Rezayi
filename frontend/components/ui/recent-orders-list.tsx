import { EmptyState } from "./empty-state";
import { StatusBadge } from "./status-badge";

export interface SellerOrderSummary {
	id: string;
	reference: string;
	customer: string;
	product: string;
	/** Exact decimal AFN amount. */
	amount: string;
	status: "delivered" | "pending" | "shipped" | "cancelled";
}

const badgeVariant: Record<
	SellerOrderSummary["status"],
	"success" | "warning" | "info" | "danger"
> = {
	delivered: "success",
	pending: "warning",
	shipped: "info",
	cancelled: "danger",
};

export function RecentOrdersList({
	orders,
	locale,
	statusLabels,
	emptyTitle,
	emptyDescription,
}: {
	orders: SellerOrderSummary[];
	locale: string;
	statusLabels: Record<SellerOrderSummary["status"], string>;
	emptyTitle: string;
	emptyDescription: string;
}) {
	if (!orders.length)
		return (
			<EmptyState
				borderless
				icon="shopping-bag"
				title={emptyTitle}
				description={emptyDescription}
			/>
		);

	const money = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "AFN",
		maximumFractionDigits: 0,
	});

	return (
		<ul className="min-w-0 list-none p-0">
			{orders.map((order) => (
				<li
					key={order.id}
					className="flex items-start justify-between gap-3 border-b border-border py-3 last:border-0"
				>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium text-foreground">
							{order.customer}
						</p>
						<p className="mt-0.5 truncate text-sm text-muted">
							{order.product}
						</p>
						<p className="mt-0.5 text-xs text-muted">
							<bdi>{order.reference}</bdi>
						</p>
					</div>
					<div className="flex shrink-0 flex-col items-end gap-1.5">
						<p className="text-sm font-semibold text-foreground tabular-nums">
							<bdi>{money.format(Number(order.amount))}</bdi>
						</p>
						<StatusBadge variant={badgeVariant[order.status]}>
							{statusLabels[order.status]}
						</StatusBadge>
					</div>
				</li>
			))}
		</ul>
	);
}
