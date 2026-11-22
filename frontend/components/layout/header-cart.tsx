"use client";
import { displayDecimal } from "@/lib/display-decimal";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { buyerShellCopy } from "../../lib/i18n/buyer-shell";
import { headerCopy } from "../../lib/i18n/header";
import { AccountError } from "../../lib/api/private-client";
import { CART_CHANGED } from "../../features/cart/transport";
import { useVisiblePoll } from "../../features/messaging/hooks";
import { Asset } from "../../features/marketplace/components/cards";
import {
	commerce,
	cartPath,
	estimateTotal,
	type Cart,
} from "../../features/orders/api";
import { commerceCopy } from "../../features/orders/copy";
import { storefrontCopy } from "../../features/storefront/copy";
import { Icon } from "../ui/icon";
import { HeaderMenu } from "./header-menu";
import { useHeaderSession } from "./header-session";

export function HeaderCart({ locale }: { locale: Locale }) {
	const { buyer, loading: sessionLoading } = useHeaderSession();
	const context = buyer ? "buyer" : "guest";
	const t = commerceCopy[locale];
	const [data, setData] = useState<Cart | null>(null);
	const [error, setError] = useState<"guest" | "failed" | null>(null);
	const [reload, setReload] = useState(0);
	useEffect(() => {
		void context;
		setData(null);
		setError(null);
	}, [context]);
	useVisiblePoll(
		async (signal) => {
			try {
				const value = await commerce<Cart>(
					`${cartPath(context)}?locale=${locale}`,
					undefined,
					"GET",
					signal,
				);
				if (signal.aborted) return;
				setData(value);
				setError(null);
			} catch (failure) {
				if (signal.aborted) return;
				setData(null);
				setError(
					failure instanceof AccountError && failure.status === 503
						? "guest"
						: "failed",
				);
				throw failure;
			}
		},
		[context, locale, reload],
		!sessionLoading,
	);
	useEffect(() => {
		const changed = () => setReload((value) => value + 1);
		window.addEventListener(CART_CHANGED, changed);
		return () => window.removeEventListener(CART_CHANGED, changed);
	}, []);
	const lines = data?.lines ?? [];
	const negotiable = lines.filter((line) => line.mode === "negotiable").length;
	const currencies = (["AFN", "USD"] as const).filter((currency) =>
		lines.some((line) => line.mode === "fixed" && line.currency === currency),
	);
	return (
		<HeaderMenu
			icon="cart"
			label={storefrontCopy[locale].cart}
			count={lines.length}
			triggerClassName="size-9 text-muted hover:text-action desktop:size-11"
			panelClassName="flex max-h-[min(30rem,calc(100dvh-7rem))] w-96 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden"
			panelLabel={t.cart}
		>
			{(close) => (
				<>
					<div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
						<h2 className="flex min-w-0 items-baseline gap-2 text-sm font-bold">
							{t.cart}
							{!!lines.length && (
								<span className="text-xs font-semibold text-muted">
									{t.items} <bdi>{lines.length}</bdi>
								</span>
							)}
						</h2>
						<button
							type="button"
							aria-label={buyerShellCopy[locale].close}
							title={buyerShellCopy[locale].close}
							onClick={() => close(true)}
							className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted transition-colors hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
						>
							<Icon name="close" className="size-4" />
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
						{error ? (
							<div className="space-y-3 px-4 py-5">
								<p role="alert" className="text-sm text-danger">
									{error === "guest" ? t.guestUnavailable : t.error}
								</p>
								<button
									type="button"
									onClick={() => setReload((value) => value + 1)}
									className="inline-flex min-h-10 cursor-pointer items-center rounded-control border border-border bg-surface px-3 text-sm font-semibold text-action transition-colors hover:bg-info focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
								>
									{t.retry}
								</button>
							</div>
						) : !data ? (
							<ul
								role="status"
								aria-label={t.loading}
								className="m-0 list-none divide-y divide-border/60 p-0"
							>
								{[0, 1, 2].map((row) => (
									<li
										key={row}
										aria-hidden="true"
										className="flex items-center gap-3 px-4 py-3"
									>
										<span className="size-14 shrink-0 animate-pulse rounded-control bg-page motion-reduce:animate-none" />
										<span className="min-w-0 flex-1 space-y-2">
											<span className="block h-3.5 w-3/4 animate-pulse rounded bg-page motion-reduce:animate-none" />
											<span className="block h-3 w-1/2 animate-pulse rounded bg-page motion-reduce:animate-none" />
										</span>
									</li>
								))}
							</ul>
						) : !lines.length ? (
							<div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
								<span className="flex size-12 items-center justify-center rounded-full bg-info text-action">
									<Icon name="cart" className="size-6" />
								</span>
								<p className="text-sm font-semibold">{t.empty}</p>
								<Link
									prefetch={false}
									href={`/${locale}/products`}
									onClick={() => close()}
									className="text-sm font-semibold text-action no-underline hover:underline"
								>
									{t.continueShopping}
								</Link>
							</div>
						) : (
							<ul className="m-0 list-none divide-y divide-border/60 p-0">
								{lines.map((row) => (
									<li key={`${row.id}:${row.version}`}>
										<Link
											prefetch={false}
											href={`/${locale}/products/${row.product}?variant=${row.variant}`}
											onClick={() => close()}
											className="flex items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors hover:bg-info/60 focus-visible:bg-info/60 focus-visible:outline-none"
										>
											<span
												className={`flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-page ${
													row.image ? "" : "border border-border/60 text-muted"
												}`}
											>
												{row.image ? (
													<Asset
														asset={row.image}
														className="size-full object-cover"
													/>
												) : (
													<Icon name="box" className="size-5" />
												)}
											</span>
											<span className="min-w-0 flex-1">
												<span
													dir="auto"
													className="line-clamp-2 break-words text-sm font-semibold"
												>
													{row.available ? row.title : t.unavailable}
												</span>
												<span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
													<bdi>{row.sku}</bdi>
													<span aria-hidden="true">·</span>
													<span>{t[row.tier]}</span>
												</span>
												<span className="mt-0.5 block text-xs text-muted">
													{t.quantity}: <bdi dir="ltr">{row.quantity}</bdi>{" "}
													{row.unit_label}
												</span>
											</span>
											<span className="shrink-0 text-end">
												{row.price !== null ? (
													<bdi dir="ltr" className="block text-sm font-bold">
														{displayDecimal(row.price)}
														<span className="ms-1 text-[0.625rem] font-semibold text-muted">
															{row.currency}
														</span>
													</bdi>
												) : (
													<span className="rounded-full bg-info px-2 py-0.5 text-[0.6875rem] font-bold text-action">
														{t.negotiableShort}
													</span>
												)}
												{!row.available && (
													<span className="mt-1 block text-[0.6875rem] font-semibold text-danger">
														{t.unavailable}
													</span>
												)}
											</span>
										</Link>
									</li>
								))}
							</ul>
						)}
					</div>
					{!!lines.length && (
						<div className="shrink-0 space-y-2.5 border-t border-border bg-page/60 px-4 py-3">
							{currencies.map((currency) => {
								const total = estimateTotal(
									lines.filter(
										(line) =>
											line.mode === "fixed" && line.currency === currency,
									),
								);
								return (
									<p
										key={currency}
										className="flex items-baseline justify-between gap-3 text-xs text-muted"
									>
										<span>
											{t.estimate}
											{currencies.length > 1 && (
												<>
													{" "}
													· <bdi>{currency}</bdi>
												</>
											)}
										</span>
										<bdi
											dir="ltr"
											className="text-sm font-extrabold text-foreground"
										>
											{displayDecimal(total)} {currency}
										</bdi>
									</p>
								);
							})}
							{!!negotiable && (
								<p className="text-xs text-muted">
									{t.negotiableShort} · <bdi>{negotiable}</bdi>
								</p>
							)}
							<Link
								prefetch={false}
								href={`/${locale}/cart`}
								onClick={() => close()}
								className="flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-bold text-on-primary no-underline shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
							>
								<Icon name="cart" className="size-4" />
								{headerCopy[locale].viewCart}
							</Link>
						</div>
					)}
				</>
			)}
		</HeaderMenu>
	);
}
