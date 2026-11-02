"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "../../../lib/i18n/locales";
import { privateRequest } from "../../../lib/api/private-client";
import type { PublicProduct } from "../../marketplace/types";
import { messaging, threadHref, type Sent } from "../api";
import { communicationCopy } from "../copy";
import { Composer } from "./composer";
import { Failure } from "./controls";
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
	return (
		<section className="space-y-4" aria-label={t.product}>
			{error ? (
				<Failure locale={locale} error={error} />
			) : !item ? (
				<p role="status">{t.loading}</p>
			) : (
				<>
					<div className="space-y-2 rounded-card border border-border bg-surface p-4">
						<h2 className="break-words text-xl font-bold" dir="auto">
							{item.body.title}
						</h2>
						<p dir="auto">{item.store.name}</p>
					</div>
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
						onSaved={(result) =>
							router.push(threadHref(locale, "buyer", result.conversation))
						}
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
