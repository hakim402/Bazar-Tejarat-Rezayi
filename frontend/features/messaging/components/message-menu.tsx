"use client";
import { useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import type { Context } from "../api";
import { communicationCopy } from "../copy";
import { ReportForm } from "./report";
import { panel, actionBtn, iconBtn } from "./ui";

const trigger =
	"inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-info hover:text-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none";

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
	const t = communicationCopy[locale],
		dialog = useRef<HTMLDialogElement>(null);
	const [report, setReport] = useState(false);
	return (
		<>
			<button
				type="button"
				className={trigger}
				title={t.report}
				aria-label={t.report}
				onClick={() => {
					setReport(false);
					dialog.current?.showModal();
				}}
			>
				<Icon name="more-horizontal" className="size-4" />
			</button>
			<dialog
				ref={dialog}
				aria-label={t.report}
				onClose={() => setReport(false)}
				className={`${panel} max-h-[90dvh] w-[min(28rem,94vw)] space-y-4 overflow-auto p-4 text-foreground shadow-lifted backdrop:bg-black/50 sm:p-5`}
			>
				<header className="flex items-center gap-2">
					{report && (
						<button
							type="button"
							className={iconBtn}
							title={t.back}
							aria-label={t.back}
							onClick={() => setReport(false)}
						>
							<Icon name="arrow" className="size-4 ltr:rotate-180" />
						</button>
					)}
					<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-info text-action">
						<Icon name="shield" className="size-5" />
					</span>
					<h2 className="min-w-0 flex-1 truncate text-base font-bold">
						{t.report}
					</h2>
					<button
						type="button"
						className={iconBtn}
						aria-label={t.close}
						onClick={() => dialog.current?.close()}
					>
						<Icon name="close" className="size-4" />
					</button>
				</header>
				{!report ? (
					<div className="space-y-3">
						<p className="text-sm leading-relaxed text-muted">
							{t.reportNeutral}
						</p>
						<button
							type="button"
							className={`${actionBtn} w-full`}
							onClick={() => setReport(true)}
						>
							<Icon name="shield" className="size-4" />
							{t.report}
						</button>
					</div>
				) : (
					<ReportForm
						embedded
						context={context}
						id={id}
						locale={locale}
						onDenied={(error) => {
							dialog.current?.close();
							onDenied?.(error);
						}}
					/>
				)}
			</dialog>
		</>
	);
}
