"use client";
import { useState, useEffect, useContext, useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";
import { SectionCard } from "../../../components/ui/section-card";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import type { Locale } from "../../../lib/i18n/locales";
import type { ProductDetail } from "../types";
import {
	CatalogueValidation,
	Control,
	ValidationGroup,
} from "./catalogue-fields";
export function LivePrices({
	item,
	locale,
	disabled,
	onSave,
	onDirty,
	onEdit,
}: {
	item: ProductDetail;
	locale: Locale;
	disabled: boolean;
	onDirty: (dirty: boolean) => void;
	onEdit: (path: string) => void;
	onSave: (prices: ProductDetail["prices"]) => Promise<boolean>;
}) {
	const t = catalogueCopy[locale];
	const s = sellerProductsCopy[locale];
	const { issues } = useContext(CatalogueValidation);
	const formDetails = useRef<HTMLDetailsElement>(null);
	const locked = useRef(false);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (
			issues.some(
				(issue) => issue.path === "prices" || issue.path.startsWith("prices."),
			) &&
			formDetails.current
		)
			formDetails.current.open = true;
	}, [issues]);
	// Keep variant rows in source order even when database updates change API row order.
	const order = new Map(
		item.revisions[0]?.body.variants.map((variant, index) => [
			variant.id,
			index,
		]),
	);
	const initialPrices = [...item.prices].sort(
		(a, b) =>
			(order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
			a.sku.localeCompare(b.sku),
	);
	const [prices, setPrices] = useState(initialPrices);
	const [baseline, setBaseline] = useState(JSON.stringify(initialPrices));
	const dirty = JSON.stringify(prices) !== baseline;
	useEffect(() => {
		onDirty(dirty);
	}, [dirty, onDirty]);
	const blocked = disabled || saving;
	const dates = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "Asia/Kabul",
	});
	async function save() {
		if (disabled || locked.current || !dirty || !prices.length) return;
		locked.current = true;
		setSaving(true);
		const submitted = prices.map((price) => ({ ...price }));
		try {
			if (await onSave(submitted)) setBaseline(JSON.stringify(submitted));
		} finally {
			locked.current = false;
			setSaving(false);
		}
	}
	return (
		<SectionCard
			id="product-prices-live"
			title={s.existingPrices}
			description={s.livePriceHelp}
			className="scroll-mt-28 text-base"
		>
			<details ref={formDetails} className="group min-w-0">
				<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
					{t.priceEdit}
					<Icon
						name="chevron-down"
						className="size-4 shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180"
					/>
				</summary>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						void save();
					}}
					className="mt-3 space-y-4"
					aria-busy={blocked}
					noValidate
				>
					<fieldset
						id="catalogue-prices"
						tabIndex={-1}
						disabled={blocked}
						className="m-0 min-w-0 space-y-3 border-0 p-0"
					>
						{prices.map((p, index) => (
							<ValidationGroup
								key={p.id}
								path={`prices.${index}`}
								label={
									<>
										<bdi dir="ltr" className="wrap-anywhere">
											{p.sku}
										</bdi>{" "}
										· <bdi dir="ltr">{item.currency}</bdi>
									</>
								}
							>
								{(["retail", "wholesale"] as const).map((k) => (
									<Control
										key={k}
										path={`prices.${index}.${k}`}
										label={t[k]}
										value={p[k] ?? ""}
										decimal
										isolated
										hint={t.onePrice}
										onChange={(v) => {
											if (disabled || locked.current) return;
											onEdit(`prices.${index}.${k}`);
											setPrices((current) =>
												current.map((row) =>
													row.id === p.id ? { ...row, [k]: v || null } : row,
												),
											);
										}}
									/>
								))}
							</ValidationGroup>
						))}
						<Button
							type="submit"
							disabled={blocked || !dirty || !prices.length}
						>
							{saving ? s.busy : s.savePrices}
						</Button>
					</fieldset>
				</form>
			</details>
			<details
				id="product-price-history"
				className="group mt-4 min-w-0 border-t border-border pt-3"
			>
				<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-body font-semibold text-foreground [&::-webkit-details-marker]:hidden">
					{s.priceHistory}
					<Icon
						name="chevron-down"
						className="size-4 shrink-0 text-muted transition-transform duration-150 motion-reduce:transition-none group-open:rotate-180"
					/>
				</summary>
				<div className="mt-3 space-y-3">
					<p className="text-caption text-muted">{s.historyLimit}</p>
					<p className="text-caption text-muted">
						<bdi dir="ltr">Asia/Kabul</bdi>
					</p>
					{item.price_history.length ? (
						item.price_history.map((h) => {
							const date = new Date(h.at);
							const sku =
								item.prices.find((price) => price.id === h.variant)?.sku ??
								h.variant;
							return (
								<div
									key={`${h.variant}-${h.at}-${h.version}`}
									className="min-w-0 space-y-2 rounded-control border border-border bg-page p-3"
								>
									<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
										<bdi dir="ltr" className="font-semibold wrap-anywhere">
											{sku}
										</bdi>
										<span className="text-muted">
											{t.revision} <bdi>{h.version}</bdi> ·{" "}
											<time dateTime={h.at}>
												{Number.isNaN(date.getTime())
													? h.at
													: dates.format(date)}
											</time>
										</span>
									</div>
									<dl className="grid gap-2 sm:grid-cols-2">
										{(["retail", "wholesale"] as const).map((key) => (
											<div key={key} className="min-w-0 text-sm">
												<dt className="text-muted">{t[key]}</dt>
												<dd className="m-0">
													<bdi dir="ltr" className="wrap-anywhere">
														{h[key]?.trim()
															? `${h[key]} ${item.currency}`
															: "—"}
													</bdi>
												</dd>
											</div>
										))}
									</dl>
								</div>
							);
						})
					) : (
						<p className="text-caption text-muted">{s.noHistory}</p>
					)}
				</div>
			</details>
		</SectionCard>
	);
}
