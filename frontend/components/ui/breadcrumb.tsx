import Link from "next/link";
import { Icon } from "./icon";
export type Crumb = { label: string; href?: string };
/** Compact pill trail: home icon, mirrored chevron separators, highlighted current page. */
export function Breadcrumb({
	label,
	items,
}: {
	label: string;
	items: Crumb[];
}) {
	return (
		<nav aria-label={label}>
			<ol className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
				{items.map((item, index) => {
					const last = index === items.length - 1;
					return (
						<li
							key={`${item.href ?? "current"}:${item.label}`}
							className="flex min-w-0 max-w-full items-center gap-1.5"
						>
							{index > 0 && (
								<Icon
									name="chevron"
									aria-hidden="true"
									className="size-3.5 shrink-0 text-control rtl:rotate-180"
								/>
							)}
							{item.href && !last ? (
								<Link
									href={item.href}
									className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-xs font-bold text-muted no-underline shadow-card transition-colors hover:border-action/40 hover:bg-info hover:text-action"
								>
									{index === 0 && (
										<Icon name="home" className="size-3.5 shrink-0" />
									)}
									<span className="truncate" title={item.label}>
										{item.label}
									</span>
								</Link>
							) : (
								<span
									aria-current={last ? "page" : undefined}
									className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-action/25 bg-info px-3.5 text-xs font-bold text-action"
								>
									{index === 0 && (
										<Icon name="home" className="size-3.5 shrink-0" />
									)}
									<span className="truncate" title={item.label}>
										{item.label}
									</span>
								</span>
							)}
						</li>
					);
				})}
			</ol>
		</nav>
	);
}
