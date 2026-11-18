"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { privateRequest } from "../../../lib/api/private-client";
import type { PublicProduct } from "../../marketplace/types";
import { messaging, threadHref, type Sent } from "../api";
import { mediaUrl } from "../../marketplace/api";
import { communicationCopy } from "../copy";
import { Composer } from "./composer";
import { Failure, help, panel, actionBtn, Avatar } from "./ui";
import Link from "next/link";
import { Icon } from "../../../components/ui/icon";
import { scopeKey, saveDraft } from "../drafts";
export function Enquiry({
	locale,
	identity,
	product,
}: {
	locale: Locale;
	identity: string;
	product: string;
}) {
	const [item, setItem] = useState<PublicProduct | null>(null),
		[error, setError] = useState<unknown>(null),
		router = useRouter(),
		t = communicationCopy[locale];
	useEffect(() => {
		const controller = new AbortController();
		void privateRequest<PublicProduct>(
			`marketplace/public/${locale}/products/${product}/`,
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((value) => {
				if (!controller.signal.aborted) setItem(value);
			})
			.catch((e) => {
				if (!controller.signal.aborted) setError(e);
			});
		return () => controller.abort();
	}, [locale, product]);
	const cover = item?.images[0],
		logo = item?.store.logo;
	return (
		<section className="space-y-4" aria-label={t.product}>
			<Link
				prefetch={false}
				className={`${actionBtn} lg:hidden`}
				href={`/${locale}/account/buyer/messages`}
			>
				<Icon name="arrow" className="size-4 ltr:rotate-180" />
				{t.back}
			</Link>
			{error ? (
				<Failure locale={locale} error={error} />
			) : !item ? (
				<p role="status">{t.loading}</p>
			) : (
				<>
					<div
						className={`${panel} flex flex-wrap items-center gap-3 p-3 sm:p-4`}
					>
						{cover ? (
							// biome-ignore lint/performance/noImgElement: cached public marketplace cover used as the enquiry image.
							<img
								src={mediaUrl(cover.url)}
								alt={cover.alt}
								className="size-12 shrink-0 rounded-xl border border-border object-cover"
							/>
						) : (
							<Avatar
								label={item.body.title}
								className="size-12 rounded-xl text-sm"
							/>
						)}
						<div className="min-w-0 flex-1 space-y-0.5">
							<h2 className="truncate text-base font-bold" dir="auto">
								{item.body.title}
							</h2>
							<p className="truncate text-xs text-muted" dir="auto">
								{item.store.name}
							</p>
						</div>
						<span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-page py-1 pe-3 ps-1">
							{logo ? (
								// biome-ignore lint/performance/noImgElement: cached public store logo rendered as a small profile chip.
								<img
									src={mediaUrl(logo.url)}
									alt={logo.alt}
									className="size-7 rounded-full object-cover"
								/>
							) : (
								<Avatar
									label={item.store.name}
									className="size-7 text-[0.625rem]"
								/>
							)}
							<span
								className="max-w-32 truncate text-xs font-semibold"
								dir="auto"
							>
								{item.store.name}
							</span>
						</span>
					</div>
					<p className={help}>{t.enquiryNote}</p>
					<Composer
						locale={locale}
						draftKey={scopeKey(identity, "buyer", "", `product:${product}`)}
						uploadPath={`messaging/buyer/enquiries/${product}/uploads/`}
						send={(packet, signal) =>
							messaging<Sent>(
								"buyer",
								"enquiries/",
								{ ...packet, product, locale },
								{ signal },
							)
						}
						onDenied={(error) => {
							setError(error);
							setItem(null);
						}}
						onSaved={(result) => {
							router.push(threadHref(locale, "buyer", result.conversation));
						}}
						onExisting={(id, draft) => {
							saveDraft(scopeKey(identity, "buyer", "", id), draft);
							router.push(threadHref(locale, "buyer", id));
						}}
					/>
				</>
			)}
		</section>
	);
}
