"use client";
import toast from "react-hot-toast";
import type { Locale } from "../../../lib/i18n/locales";
import { Icon } from "../../../components/ui/icon";
import { marketplaceCopy } from "../copy";
export function CopyLinkButton({
	locale,
	path,
}: {
	locale: Locale;
	path: string;
}) {
	const t = marketplaceCopy[locale];
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`${window.location.origin}${path}`);
			toast.success(t.linkCopied);
		} catch {
			toast.error(t.linkCopyFailed);
		}
	};
	return (
		<button
			type="button"
			onClick={copy}
			aria-label={t.copyLink}
			title={t.copyLink}
			className="inline-flex size-11 items-center justify-center gap-2 rounded-control border border-border bg-surface text-sm font-bold text-foreground transition-colors hover:border-action/50 hover:text-action motion-reduce:transition-none desktop:size-auto desktop:min-h-11 desktop:px-5"
		>
			<Icon name="copy" className="size-4" />
			<span className="hidden desktop:inline">{t.copyLink}</span>
		</button>
	);
}
