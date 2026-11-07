import type { ComponentProps } from "react";

export interface Column<T> {
	header: string;
	render: (row: T) => React.ReactNode;
	className?: string;
}

export function DataTable<T extends { id: string }>({
	columns,
	rows,
	emptyMessage = "No records match this view.",
	className = "",
	...props
}: ComponentProps<"div"> & {
	columns: Column<T>[];
	rows: T[];
	emptyMessage?: string;
}) {
	if (!rows.length) {
		return (
			<div
				className={`rounded-card border border-border bg-surface p-8 text-center text-muted ${className}`}
				{...props}
			>
				{emptyMessage}
			</div>
		);
	}

	return (
		<div className={className} {...props}>
			{/* Desktop table */}
			<div className="hidden overflow-x-auto desktop:block">
				<table className="w-full min-w-[38rem] text-start text-body">
					<thead>
						<tr>
							{columns.map((col) => (
								<th
									key={col.header}
									scope="col"
									className={`border-b border-border p-3 text-start text-caption font-semibold text-muted ${col.className ?? ""}`}
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
									<td key={col.header} className={`p-3 ${col.className ?? ""}`}>
										{col.render(row)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{/* Mobile cards */}
			<div className="space-y-3 desktop:hidden">
				{rows.map((row) => (
					<div
						key={row.id}
						className="rounded-card border border-border bg-surface p-4"
					>
						{columns.map((col) => (
							<div key={col.header} className="flex justify-between py-1.5">
								<span className="text-caption text-muted">{col.header}</span>
								<span className="text-body text-foreground">
									{col.render(row)}
								</span>
							</div>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
