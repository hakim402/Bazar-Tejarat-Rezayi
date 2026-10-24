import Link from "next/link";
import type { Locale } from "../../../lib/i18n/locales";
import { interfaceCopy } from "../../../lib/i18n/interface";
import { catalogueStatuses } from "../../../lib/i18n/catalogue";
import type { ProductList } from "../types";
import { Icon, type IconName } from "../../../components/ui/icon";
export function CatalogueOverview({
	locale,
	list,
	context,
}: {
	locale: Locale;
	list: ProductList;
	context: "seller" | "staff";
}) {
	const t = interfaceCopy[locale];
	const counts = [
		{ key: "total", label: t.total, value: list.count, icon: "box" },
		{
			key: "published",
			label: t.published,
			value: list.results.filter((p) => p.state === "published").length,
			icon: "check",
		},
		{
			key: "submitted",
			label: t.review,
			value: list.results.filter((p) => p.state === "submitted").length,
			icon: "shield",
		},
		{
			key: "draft",
			label: t.draft,
			value: list.results.filter((p) => p.state === "draft").length,
			icon: "file",
		},
	];
	return (
		<section aria-label={t.summary} className="space-y-5">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{counts.map((c) => (
					<div
						key={c.key}
						className="rounded-card border border-border bg-page p-4"
					>
						<span className="mb-3 flex size-10 items-center justify-center rounded-control bg-info text-action">
							<Icon name={c.icon as IconName} />
						</span>
						<p className="text-sm text-muted">{c.label}</p>
						<p className="mt-1 text-3xl font-bold">
							<bdi data-testid={`catalogue-count-${c.key}`}>{c.value}</bdi>
						</p>
						{c.key !== "total" && (
							<p className="text-xs text-muted">{t.currentPage}</p>
						)}
					</div>
				))}
			</div>
			{list.results.length > 0 && (
				<div className="rounded-card border border-border bg-page p-5">
					<h2 className="mb-5 text-base">
						{t.status}{" "}
						<span className="font-normal text-muted">· {t.currentPage}</span>
					</h2>
					<div
						className="flex h-24 items-end gap-3"
						role="img"
						aria-label={counts
							.slice(1)
							.map((c) => `${c.label}: ${c.value}`)
							.join(", ")}
					>
						{counts.slice(1).map((c) => (
							<div
								key={c.key}
								className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
							>
								<div className="flex w-full max-w-24 flex-1 flex-col justify-end overflow-hidden rounded-t-control bg-border">
									<div
										className={`flex min-h-1 items-center justify-center bg-primary text-sm font-bold text-on-primary ${c.value > 0 ? "min-h-8" : ""}`}
										style={{
											height: `${Math.max(4, (c.value / list.results.length) * 100)}%`,
										}}
									>
										{c.value > 0 && c.value}
									</div>
								</div>
								<span className="text-xs text-muted">{c.label}</span>
							</div>
						))}
					</div>
				</div>
			)}
			{list.results.length === 0 && (
				<div className="rounded-card border border-dashed border-control p-8 text-center">
					<Icon name="box" className="mx-auto mb-4 size-10 text-muted" />
					<h2 className="text-lg">{t.empty}</h2>
					<p className="mt-2 text-sm text-muted">{t.emptyBody}</p>
				</div>
			)}
			<ul className="m-0 grid list-none gap-3 p-0">
				{list.results.map((p) => (
					<li
						key={p.id}
						className="flex min-w-0 flex-wrap items-center gap-4 rounded-card border border-border p-4 hover:bg-page"
					>
						<span className="flex size-12 shrink-0 items-center justify-center rounded-control bg-info text-action">
							<Icon name="box" />
						</span>
						<div className="min-w-0 flex-1">
							<Link
								className="block font-bold text-foreground decoration-action hover:underline wrap-anywhere"
								href={`/${locale}/account/${context}/catalogue/${p.id}`}
							>
								{p.title || p.id}
							</Link>
							<p className="mt-1 text-xs text-muted wrap-anywhere">
								<bdi>
									{list.sellers.find((s) => s.id === p.seller)?.name ??
										p.seller}
								</bdi>{" "}
								· <bdi>#{p.version}</bdi>
							</p>
						</div>
						<span
							className={`rounded-full px-3 py-1 text-xs font-bold ${p.state === "published" ? "bg-success-surface text-success" : p.state === "submitted" ? "bg-warning-surface text-warning" : "bg-info text-action"}`}
						>
							{catalogueStatuses[locale][p.state]}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}
