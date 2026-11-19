"use client";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/shadcn/button";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "@/components/shadcn/pagination";
import type { Locale } from "@/lib/i18n/locales";

export const PAGE_SIZE = 20;

export function Pager({
	locale,
	page,
	count,
	pageSize,
	href,
	onPage,
	labels,
	summary,
	className,
	busy = false,
}: {
	locale: Locale;
	page: number;
	count: number;
	pageSize: number;
	href?: (n: number) => string;
	onPage?: (n: number) => void;
	labels: { prev: string; next: string; page: string };
	summary?: ReactNode;
	className?: string;
	busy?: boolean;
}) {
	const router = useRouter(),
		number = new Intl.NumberFormat(locale),
		last = Math.min(10000, Math.max(1, Math.ceil(count / pageSize))),
		current = Math.min(Math.max(1, page), last),
		pages = [
			...new Set([
				1,
				...[current - 1, current, current + 1].filter((n) => n > 0 && n <= last),
				last,
			]),
		].sort((a, b) => a - b);
	const go = (n: number) => {
		if (onPage) onPage(n);
		else if (href) router.push(href(n));
	};
	const cell = (
		n: number,
		label: string,
		children: ReactNode,
		off: boolean,
		active = false,
	) => {
		const tone = `size-10 rounded-xl border-border ${off ? "pointer-events-none opacity-35" : "cursor-pointer"} ${active ? "bg-action text-on-primary hover:bg-action hover:text-on-primary" : ""}`;
		return href ? (
			<PaginationLink
				href={off ? undefined : href(n)}
				isActive={active}
				aria-label={label}
				aria-disabled={off || undefined}
				tabIndex={off ? -1 : undefined}
				title={label}
				className={tone}
				onClick={(event) => {
					event.preventDefault();
					if (!off) go(n);
				}}
			>
				{children}
			</PaginationLink>
		) : (
			<Button
				type="button"
				variant={active ? "outline" : "ghost"}
				size="icon"
				aria-label={label}
				aria-current={active ? "page" : undefined}
				disabled={off}
				title={label}
				className={tone}
				onClick={() => go(n)}
			>
				{children}
			</Button>
		);
	};
	return (
		<div className={className}>
			{summary}
			<Pagination aria-label={labels.page} className="mx-0 w-auto">
				<PaginationContent className="m-0 list-none p-0">
					<PaginationItem>
						{cell(
							Math.max(1, current - 1),
							labels.prev,
							<ChevronLeft className="size-4 rtl:rotate-180" />,
							busy || current <= 1,
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
							{cell(n, `${labels.page} ${number.format(n)}`, number.format(n), busy, n === current)}
						</PaginationItem>
					))}
					<PaginationItem>
						{cell(
							Math.min(last, current + 1),
							labels.next,
							<ChevronRight className="size-4 rtl:rotate-180" />,
							busy || current >= last,
						)}
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}