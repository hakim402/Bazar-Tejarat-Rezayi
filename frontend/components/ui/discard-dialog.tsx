"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../shadcn/alert-dialog";
import { Icon } from "./icon";
import { direction, type Locale } from "../../lib/i18n/locales";

// One shared discard confirmation for every guarded form. Portals into the
// nearest open native <dialog> so it stays reachable inside modal workspaces.
export function DiscardDialog({
	locale,
	open,
	title,
	help,
	cancelLabel,
	confirmLabel,
	onCancel,
	onConfirm,
}: {
	locale: Locale;
	open: boolean;
	title: string;
	help?: string;
	cancelLabel: string;
	confirmLabel?: string;
	onCancel: () => void;
	onConfirm?: () => void;
}) {
	const anchor = useRef<HTMLSpanElement>(null),
		settled = useRef(false),
		[container, setContainer] = useState<Element | null>(null);
	useLayoutEffect(() => {
		if (!open) return;
		settled.current = false;
		setContainer(anchor.current?.closest("dialog") ?? null);
	}, [open]);
	function cancel() {
		settled.current = true;
		onCancel();
	}
	return (
		<>
			<span ref={anchor} aria-hidden="true" className="hidden" />
			<AlertDialog
				open={open}
				onOpenChange={(next) => {
					if (!next && !settled.current) cancel();
				}}
			>
				<AlertDialogContent
					container={container}
					dir={direction(locale)}
					onEscapeKeyDown={(event) => {
						event.preventDefault();
						cancel();
					}}
					onCloseAutoFocus={(event) => event.preventDefault()}
					className="max-w-md gap-5 rounded-2xl p-6"
				>
					<AlertDialogHeader className="gap-3 text-start">
						<span className="flex size-11 items-center justify-center rounded-xl bg-warning-surface text-warning">
							<Icon name="alert-triangle" className="size-5" />
						</span>
						<AlertDialogTitle className="text-base font-semibold">
							{title}
						</AlertDialogTitle>
						{help && <AlertDialogDescription>{help}</AlertDialogDescription>}
					</AlertDialogHeader>
					<AlertDialogFooter className="gap-3">
						<AlertDialogCancel onClick={cancel}>
							{cancelLabel}
						</AlertDialogCancel>
						{confirmLabel && onConfirm && (
							<AlertDialogAction
								variant="destructive"
								onClick={() => {
									settled.current = true;
									onConfirm();
								}}
							>
								{confirmLabel}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
