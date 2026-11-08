import type { ComponentProps, ReactNode } from "react";

export interface Column<T> {
	header: string;
	render: (row: T) => ReactNode;
	className?: string;
	ariaSort?: ComponentProps<"th">["aria-sort"];
}

export function DataTable<T extends { id: string }>({
	columns,
	rows,
	caption,
	cardsOnly = false,
	emptyState,
	emptyMessage,
	className = "",
	...props
}: ComponentProps<"div"> & {
	columns: Column<T>[];
	rows: T[];
	caption?: ReactNode;
	cardsOnly?: boolean;
	emptyState?: ReactNode;
	emptyMessage?: string;
}) {
	if (!rows.length) {
		return (
			<div className={`min-w-0 ${className}`} {...props}>
				{emptyState ??
					(emptyMessage != null ? (
						<div className="rounded-card border border-border bg-surface p-6 text-center text-muted wrap-anywhere">
							{emptyMessage}
						</div>
					) : null)}
			</div>
		);
	}

	return (
		<div className={`min-w-0 ${className}`} {...props}>
			<div
				className={
					cardsOnly ? "hidden" : "hidden min-w-0 overflow-x-auto desktop:block"
				}
			>
				<table className="w-full border-collapse text-start text-body">
					{caption != null && <caption className="sr-only">{caption}</caption>}
					<thead>
						<tr>
							{columns.map((col) => (
								<th
									key={col.header}
									scope="col"
									aria-sort={col.ariaSort}
									className={`border-b border-border p-3 text-start text-caption font-semibold text-muted wrap-anywhere ${col.className ?? ""}`}
								>
									{col.header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.id} className="border-b border-border last:border-0">
								{columns.map((col) => (
									<td
										key={col.header}
										className={`p-3 align-top text-foreground wrap-anywhere ${col.className ?? ""}`}
									>
										{col.render(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			<div className={`min-w-0 space-y-3 ${cardsOnly ? "" : "desktop:hidden"}`}>
				{caption != null && (
					<div className="text-caption text-muted wrap-anywhere">{caption}</div>
				)}
				{rows.map((row) => (
					<dl
						key={row.id}
						className="m-0 min-w-0 rounded-card border border-border bg-surface p-4"
					>
						{columns.map((col) => (
							<div
								key={col.header}
								className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] items-start gap-3 py-1.5"
							>
								<dt className="min-w-0 text-caption text-muted wrap-anywhere">
									{col.header}
								</dt>
								<dd
									className={`m-0 min-w-0 text-body text-foreground wrap-anywhere ${col.className ?? ""}`}
								>
									{col.render(row)}
								</dd>
							</div>
						))}
					</dl>
				))}
			</div>
		</div>
	);
}
