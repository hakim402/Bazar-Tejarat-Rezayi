"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Icon } from "../../../components/ui/icon";
import { panel } from "../../orders/components/controls";
export function Confirmation({
	label,
	close,
	children,
	returnFocus,
	presentation,
	closeLabel,
}: {
	label: string;
	close: () => void;
	children: ReactNode;
	returnFocus: HTMLElement | null;
	presentation?: "buyer";
	closeLabel?: string;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const onClose = useRef(close);
	onClose.current = close;
	useLayoutEffect(() => {
		const dialog = ref.current,
			previous = returnFocus ?? (document.activeElement as HTMLElement | null);
		dialog?.showModal();
		return () => {
			dialog?.close();
			queueMicrotask(() => {
				if (!dialog?.open && previous?.isConnected) previous.focus();
			});
		};
	}, [returnFocus]);
	return (
		<dialog
			ref={ref}
			role="alertdialog"
			tabIndex={-1}
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onClose.current();
					return;
				}
				if (event.key !== "Tab") return;
				const elements = Array.from(
					event.currentTarget.querySelectorAll<HTMLElement>(
						'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
					),
				).filter((el) => el.getClientRects().length > 0);
				if (!elements.length) {
					event.preventDefault();
					event.currentTarget.focus();
					return;
				}
				const first = elements[0],
					last = elements[elements.length - 1];
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}}
			aria-label={label}
			onClose={(event) => {
				// Effect replay can close and reopen the same native dialog
				// before its queued close event arrives. Keep that stale event
				// from cancelling the currently open, exact reviewed packet.
				if (!event.currentTarget.open) onClose.current();
			}}
			onCancel={(e) => {
				e.preventDefault();
				onClose.current();
			}}
			className={
				presentation === "buyer"
					? "m-auto flex max-h-[90dvh] w-[min(38rem,calc(100%-2rem))] flex-col overflow-hidden rounded-card border border-border bg-surface p-0 text-foreground shadow-lifted backdrop:bg-overlay"
					: `${panel} m-auto max-h-[90dvh] w-[min(36rem,calc(100%-2rem))] overflow-y-auto text-foreground backdrop:bg-black/50`
			}
		>
			{presentation === "buyer" ? (
				<>
					<header className="flex shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-border px-4 py-3">
						<h2 className="m-0 text-sm font-semibold">{label}</h2>
						<button
							type="button"
							aria-label={closeLabel}
							title={closeLabel}
							onClick={() => onClose.current()}
							className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-action hover:bg-info hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action motion-reduce:transition-none"
						>
							<Icon name="close" className="size-4" />
						</button>
					</header>
					<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
						{children}
					</div>
				</>
			) : (
				children
			)}
		</dialog>
	);
}
