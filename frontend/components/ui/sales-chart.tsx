export interface SalesPoint {
	/** ISO date that starts the bucket. */
	periodStart: string;
	/** Short axis label for the bucket. */
	label: string;
	/** Exact decimal amount in AFN. */
	amount: string;
}

export type SalesPeriod = "monthly" | "weekly";

const periods: SalesPeriod[] = ["monthly", "weekly"];

function PeriodToggle({
	period,
	monthlyLabel,
	weeklyLabel,
	onChange,
}: {
	period: SalesPeriod;
	monthlyLabel: string;
	weeklyLabel: string;
	onChange: (period: SalesPeriod) => void;
}) {
	return (
		<div className="inline-flex min-w-0 items-center gap-1 rounded-control border border-border p-1">
			{periods.map((value) => (
				<button
					key={value}
					type="button"
					aria-pressed={value === period}
					onClick={() => onChange(value)}
					data-active={value === period ? "true" : undefined}
					className="min-h-9 rounded-sm px-3 text-sm font-medium text-muted transition-colors duration-150 motion-reduce:transition-none hover:bg-info data-[active=true]:bg-info data-[active=true]:text-action"
				>
					{value === "monthly" ? monthlyLabel : weeklyLabel}
				</button>
			))}
		</div>
	);
}

export function SalesChart({
	points,
	period = "monthly",
	onPeriodChange,
	locale,
	monthlyLabel,
	weeklyLabel,
	emptyTitle,
	emptyDescription,
}: {
	points: SalesPoint[];
	period?: SalesPeriod;
	onPeriodChange?: (period: SalesPeriod) => void;
	locale: string;
	monthlyLabel: string;
	weeklyLabel: string;
	emptyTitle: string;
	emptyDescription: string;
}) {
	const money = new Intl.NumberFormat(locale, {
		style: "currency",
		currency: "AFN",
		maximumFractionDigits: 0,
	});

	if (!points.length)
		return (
			<div className="relative flex min-h-56 flex-col">
				<svg
					aria-hidden="true"
					viewBox="0 0 400 160"
					preserveAspectRatio="none"
					className="pointer-events-none absolute inset-0 h-full w-full text-muted opacity-15"
				>
					<path
						d="M0 40H400 M0 80H400 M0 120H400 M100 0V160 M200 0V160 M300 0V160"
						stroke="currentColor"
						strokeWidth="1"
						vectorEffect="non-scaling-stroke"
						fill="none"
					/>
					<path
						d="M0 126C50 66 92 142 142 94S224 28 268 80S346 124 400 58"
						stroke="currentColor"
						strokeWidth="3"
						strokeLinecap="round"
						vectorEffect="non-scaling-stroke"
						fill="none"
					/>
				</svg>
				<div className="relative m-auto max-w-sm px-4 py-10 text-center">
					<p className="text-base font-semibold text-foreground wrap-anywhere">
						{emptyTitle}
					</p>
					<p className="mt-2 text-sm text-muted wrap-anywhere">
						{emptyDescription}
					</p>
				</div>
			</div>
		);

	const values = points.map((point) => Number(point.amount) || 0);
	const max = Math.max(...values, 0) || 1;
	const spread = points.length > 1 ? points.length - 1 : 1;
	const placed = points.map((point, index) => ({
		x: points.length > 1 ? (index / spread) * 100 : 50,
		y: 38 - (values[index] / max) * 34,
		label: point.label,
		amount: values[index],
	}));
	const line = placed
		.map((spot, index) => `${index ? "L" : "M"}${spot.x} ${spot.y}`)
		.join(" ");
	const every = Math.ceil(placed.length / 6);

	// The plotted line mirrors in RTL so the time axis follows the right-to-left label row.
	return (
		<div className="min-w-0">
			{onPeriodChange && (
				<div className="mb-4 flex justify-end">
					<PeriodToggle
						period={period}
						monthlyLabel={monthlyLabel}
						weeklyLabel={weeklyLabel}
						onChange={onPeriodChange}
					/>
				</div>
			)}
			<svg
				role="img"
				aria-label={placed
					.map((spot) => `${spot.label}: ${money.format(spot.amount)}`)
					.join(", ")}
				viewBox="0 0 100 40"
				preserveAspectRatio="none"
				className="h-48 w-full text-action rtl:-scale-x-100"
			>
				<path
					d="M0 10H100 M0 20H100 M0 30H100"
					stroke="currentColor"
					strokeWidth="1"
					opacity="0.15"
					vectorEffect="non-scaling-stroke"
					fill="none"
				/>
				<path
					d={`${line} L${placed[placed.length - 1].x} 40 L${placed[0].x} 40 Z`}
					fill="currentColor"
					opacity="0.12"
				/>
				<path
					d={line}
					stroke="currentColor"
					strokeWidth="2"
					strokeLinejoin="round"
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
					fill="none"
				/>
			</svg>
			<div className="mt-2 flex justify-between gap-2 text-caption text-muted">
				{placed
					.filter((_, index) => index % every === 0)
					.map((spot) => (
						<span key={spot.label} className="min-w-0 truncate">
							{spot.label}
						</span>
					))}
			</div>
		</div>
	);
}
