"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "../../../components/shadcn/pagination";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { sellerProductsCopy } from "../../../lib/i18n/seller-products";
import type { Locale } from "../../../lib/i18n/locales";
import type { QueryReader } from "../../../lib/routes/account-routes";
import { productHref } from "./seller-products-ui";

export function ProductPagination({
	locale,
	page,
	count,
	seller,
	filters,
}: {
	locale: Locale;
	page: number;
	count: number;
	seller: string | null;
	filters: QueryReader;
}) {
	const router = useRouter(),
		t = catalogueCopy[locale],
		copy = sellerProductsCopy[locale];
	const last = Math.min(10000, Math.max(1, Math.ceil(count / 8)));
	const pages = [
		...new Set([
			1,
			...[page - 1, page, page + 1].filter((n) => n > 0 && n <= last),
			last,
		]),
	].sort((a, b) => a - b);
	const href = (n: number) =>
		productHref(locale, "catalogue", seller, filters, { page: String(n) });
	const link = (
		n: number,
		label: string,
		children: ReactNode,
		disabled = false,
	) => (
		<PaginationLink
			href={disabled ? undefined : href(n)}
			aria-label={label}
			aria-disabled={disabled || undefined}
			tabIndex={disabled ? -1 : undefined}
			title={label}
			className={`size-10 rounded-xl border-border ${disabled ? "pointer-events-none opacity-35" : "cursor-pointer"}`}
			onClick={(event) => {
				event.preventDefault();
				if (!disabled) router.push(href(n));
			}}
		>
			{children}
		</PaginationLink>
	);
	return (
		<div className="flex flex-col items-center justify-between gap-3 border-t border-border pt-4 sm:flex-row">
			<p className="m-0 shrink-0 text-xs text-muted">
				{copy.page}{" "}
				<bdi>
					{new Intl.NumberFormat(locale).format(page)} /{" "}
					{new Intl.NumberFormat(locale).format(last)}
				</bdi>
			</p>
			<Pagination aria-label={copy.page} className="mx-0 w-auto">
				<PaginationContent className="m-0 list-none p-0">
					<PaginationItem>
						{link(
							Math.max(1, page - 1),
							t.back,
							<ChevronLeft className="size-4 rtl:rotate-180" />,
							page <= 1,
						)}
					</PaginationItem>
					{pages.map((n, index) => (
						<PaginationItem key={n} className="flex items-center gap-1">
							{index > 0 && n - pages[index - 1] > 1 && (
								<span
									aria-hidden="true"
									className="flex size-6 items-center justify-center text-muted"
								>
									<Ellipsis className="size-4" />
								</span>
							)}
							<PaginationLink
								href={href(n)}
								isActive={n === page}
								aria-label={`${copy.page} ${n}`}
								className={`size-10 rounded-xl border-border ${n === page ? "bg-action text-on-primary hover:bg-action hover:text-on-primary" : ""}`}
								onClick={(event) => {
									event.preventDefault();
									router.push(href(n));
								}}
							>
								{new Intl.NumberFormat(locale).format(n)}
							</PaginationLink>
						</PaginationItem>
					))}
					<PaginationItem>
						{link(
							Math.min(last, page + 1),
							t.next,
							<ChevronRight className="size-4 rtl:rotate-180" />,
							page >= last,
						)}
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
