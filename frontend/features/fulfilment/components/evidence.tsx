"use client";
import { useEffect, useState } from "react";
import { apiOrigin } from "../../../lib/api/client";
import type { Context } from "../../messaging/api";
import type { Locale } from "../../../lib/i18n/locales";
import { fulfilmentCopy } from "../copy";
export function DeliveryEvidence({
	id,
	context,
	locale,
}: {
	id: string;
	context: Context;
	locale: Locale;
}) {
	const [src, setSrc] = useState<string | null>(null),
		[error, setError] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		let url: string | undefined,
			live = true;
		void fetch(
			`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/fulfilment/${context}/evidence/${id}/`,
			{ credentials: "include", cache: "no-store", signal: controller.signal },
		)
			.then(async (response) => {
				if (
					!response.ok ||
					!/^image\/(jpeg|png|webp)$/.test(
						response.headers.get("content-type") ?? "",
					)
				)
					throw Error();
				const blob = await response.blob();
				if (live) {
					url = URL.createObjectURL(blob);
					setSrc(url);
				}
			})
			.catch(() => {
				if (live) setError(true);
			});
		return () => {
			live = false;
			controller.abort();
			if (url) URL.revokeObjectURL(url);
			setSrc(null);
		};
	}, [id, context]);
	return error ? (
		<p role="alert">{fulfilmentCopy[locale].error}</p>
	) : src ? (
		<a href={src} target="_blank" rel="noreferrer" className="block max-w-48">
			{/* biome-ignore lint/performance/noImgElement: authenticated private blob; never sent through the public image optimizer. */}
			<img
				src={src}
				alt={fulfilmentCopy[locale].openImage}
				className="max-h-48 rounded-control object-contain"
			/>
		</a>
	) : (
		<p role="status">{fulfilmentCopy[locale].loading}</p>
	);
}
