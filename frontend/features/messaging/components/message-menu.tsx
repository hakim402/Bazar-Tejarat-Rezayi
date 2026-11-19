"use client";
import { useState } from "react";
import { direction, type Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { Button } from "../../../components/shadcn/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../../components/shadcn/dropdown-menu";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "../../../components/shadcn/dialog";
import type { Context } from "../api";
import { communicationCopy } from "../copy";
import { ReportForm } from "./report";

export function MessageMenu({
	locale,
	context,
	id,
	onDenied,
}: {
	locale: Locale;
	context: Context;
	id: string;
	onDenied?: (error: unknown) => void;
}) {
	const t = communicationCopy[locale];
	const [report, setReport] = useState(false);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title={t.report}
						aria-label={t.report}
						className="size-11 shrink-0 rounded-lg text-muted hover:bg-info hover:text-action"
					>
						<Icon name="more-horizontal" className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="min-w-44">
					<DropdownMenuItem onSelect={() => setReport(true)}>
						<Icon name="shield" className="size-4" />
						{t.report}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={report} onOpenChange={setReport}>
				<DialogContent
					dir={direction(locale)}
					closeLabel={t.close}
					className="max-w-md gap-4 rounded-2xl p-6"
				>
					<DialogHeader className="gap-2 text-start">
						<DialogTitle className="flex items-center gap-2 text-base font-bold">
							<Icon name="shield" className="size-5 shrink-0 text-action" />
							{t.report}
						</DialogTitle>
					</DialogHeader>
					<ReportForm
						embedded
						context={context}
						id={id}
						locale={locale}
						onDenied={(error) => {
							setReport(false);
							onDenied?.(error);
						}}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}