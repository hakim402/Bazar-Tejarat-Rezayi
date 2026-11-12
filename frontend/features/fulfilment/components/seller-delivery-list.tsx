"use client";

import Link from "next/link";
import { MoreHorizontal, ShoppingBag, Truck, Wallet } from "lucide-react";
import { Badge } from "../../../components/shadcn/badge";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import { useSellerNavigation } from "../../../app/[locale]/(seller)/account/seller/components/seller-navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { cn } from "../../../lib/shadcn-utils";
import { sellerSalesCopy } from "../../../lib/i18n/seller-sales";
import { salesHref } from "../../sales/components/seller-sales-ui";
import { fulfilmentState } from "../copy";
import { deliveryListCopy } from "../list-copy";
import type { Summary } from "../types";

export function SellerDeliveryList({
	locale,
	rows,
	filters,
}: {
	locale: Locale;
	rows: Summary[];
	filters: Record<string, string>;
}) {
	const t = deliveryListCopy[locale],
		s = sellerSalesCopy[locale],
		destinations = useSellerNavigation();
	const cell = "min-w-0 px-4 py-3 text-start align-middle lg:py-4";
	return (
		<div className="min-w-0 lg:overflow-hidden lg:rounded-xl lg:border lg:border-solid lg:border-border">
			<table className="block w-full border-collapse text-start lg:table">
				<caption className="sr-only">{t.title}</caption>
				<thead className="hidden lg:table-header-group">
					<tr>
						{[
							t.order,
							t.customer,
							t.destination,
							t.status,
							t.fee,
							t.actions,
						].map((label) => (
							<th
								key={label}
								scope="col"
								className="border-0 border-b border-solid border-border bg-transparent px-4 py-3 text-start text-xs font-medium text-muted"
							>
								{label}
							</th>
						))}
					</tr>
				</thead>
				<tbody className="grid gap-3 lg:table-row-group">
					{rows.map((row) => {
						const attention = !!(
							row.cancellation_hold ||
							row.dispute_open ||
							row.dispatch_problem ||
							row.overdue ||
							row.completion === "completed_with_exception"
						);
						const href = salesHref(
							locale,
							"fulfilment",
							row.seller,
							row.id,
							undefined,
							filters,
						);
						const label = attention
							? t.review
							: row.stage === "delivered"
								? t.view
								: row.stage === "dispatched"
									? row.capabilities.tracking || row.capabilities.deliver
										? t.update
										: t.view
									: row.capabilities.prepare && row.stage !== "prepared"
										? t.prepare
										: row.capabilities.dispatch || row.capabilities.prepare
											? t.manage
											: t.view;
						const location =
							[row.destination.city, row.destination.country]
								.filter(Boolean)
								.join(" · ") || "—";
						return (
							<tr
								key={row.id}
								className="grid grid-cols-2 rounded-xl border border-solid border-border bg-surface shadow-none lg:table-row lg:rounded-none lg:border-0 lg:border-b lg:shadow-none"
							>
								<td
									className={cn(
										cell,
										"col-span-2 border-0 border-b border-solid border-border lg:border-0",
									)}
								>
									<Link
										href={href}
										prefetch={false}
										className="inline-flex items-center gap-2 text-sm font-semibold text-action no-underline hover:text-foreground"
									>
										<span className="flex size-8 items-center justify-center rounded-lg bg-info text-action">
											<Truck className="size-4" aria-hidden="true" />
										</span>
										<bdi>{row.number}</bdi>
									</Link>
								</td>
								<td className={cell}>
									<span className="mb-1 block text-xs text-muted lg:hidden">
										{t.customer}
									</span>
									<span
										className="text-sm font-medium wrap-anywhere"
										dir="auto"
									>
										{row.buyer || "—"}
									</span>
								</td>
								<td className={cell}>
									<span className="mb-1 block text-xs text-muted lg:hidden">
										{t.destination}
									</span>
									<span className="block text-sm" dir="auto">
										{location}
									</span>
									{row.provider && (
										<span className="mt-1 block text-xs text-muted" dir="auto">
											{row.provider}
										</span>
									)}
								</td>
								<td className={cell}>
									<span className="mb-1 block text-xs text-muted lg:hidden">
										{t.status}
									</span>
									<div className="flex flex-wrap gap-1.5">
										<Badge
											variant="secondary"
											className={cn(
												"border-0 whitespace-normal",
												row.stage === "delivered"
													? "bg-success-surface text-success"
													: "bg-info text-action",
											)}
										>
											{fulfilmentState(locale, row.stage)}
										</Badge>
										{attention && (
											<Badge
												variant="secondary"
												className="border-0 bg-warning-surface text-warning"
											>
												{t.attention}
											</Badge>
										)}
									</div>
								</td>
								<td className={cell}>
									<span className="mb-1 block text-xs text-muted lg:hidden">
										{t.fee}
									</span>
									<bdi
										className={cn(
											"text-sm tabular-nums",
											row.charge === null ? "text-muted" : "font-medium",
										)}
									>
										{row.charge === null
											? t.unset
											: `${row.charge} ${row.currency}`}
									</bdi>
								</td>
								<td className={cn(cell, "col-span-2")}>
									<div className="flex items-center justify-between gap-2 lg:justify-end">
										<Button
											asChild
											size="sm"
											variant="outline"
											className="rounded-lg no-underline"
										>
											<Link href={href} prefetch={false}>
												{label}
											</Link>
										</Button>
										<DropdownMenu dir={locale === "en" ? "ltr" : "rtl"}>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													aria-label={`${t.actions} · ${row.number}`}
													className="shrink-0 border-0 bg-transparent text-muted shadow-none hover:bg-transparent hover:text-action dark:hover:bg-transparent"
												>
													<MoreHorizontal
														className="size-5"
														aria-hidden="true"
													/>
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												className="w-52 rounded-xl p-1.5"
											>
												<DropdownMenuItem
													asChild
													className="gap-2 no-underline"
												>
													<Link href={href}>
														<Truck aria-hidden="true" />
														{t.view}
													</Link>
												</DropdownMenuItem>
												{(
													[
														{
															route: "orders",
															label: s.orders,
															icon: ShoppingBag,
														},
														{
															route: "payments",
															label: s.payments,
															icon: Wallet,
														},
													] as const
												)
													.filter((item) =>
														destinations?.some(
															(destination) => destination.route === item.route,
														),
													)
													.map((item) => (
														<DropdownMenuItem
															key={item.route}
															asChild
															className="gap-2 no-underline"
														>
															<Link
																href={salesHref(
																	locale,
																	item.route,
																	row.seller,
																	row.id,
																)}
															>
																<item.icon aria-hidden="true" />
																{item.label}
															</Link>
														</DropdownMenuItem>
													))}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
