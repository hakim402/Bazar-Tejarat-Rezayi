"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { panel } from "../../orders/components/controls";
export function Confirmation({
	label,
	close,
	children,
	returnFocus,
}: {
	label: string;
	close: () => void;
	children: ReactNode;
	returnFocus: HTMLElement | null;
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
			className={`${panel} m-auto max-h-[90dvh] w-[min(36rem,calc(100%-2rem))] overflow-y-auto text-foreground backdrop:bg-black/50`}
		>
			{children}
		</dialog>
	);
}
