"use client";
import { useEffect, useState } from "react";
import { apiOrigin } from "../../lib/api/client";
import type { Context } from "../../features/messaging/api";

export function RecordEvidence({
	id,
	context,
	domain,
	copy,
}: {
	id: string;
	context: Context;
	domain: "fulfilment" | "payments";
	copy: { error: string; openImage: string; loading: string };
}) {
	const [src, setSrc] = useState<string | null>(null),
		[error, setError] = useState(false);
	useEffect(() => {
		const controller = new AbortController();
		let url: string | undefined,
			live = true;
		void fetch(
			`${apiOrigin(process.env.NEXT_PUBLIC_API_URL)}/api/v1/${domain}/${context}/evidence/${id}/`,
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
	}, [id, context, domain]);
	return error ? (
		<p role="alert">{copy.error}</p>
	) : src ? (
		<a href={src} target="_blank" rel="noreferrer" className="block max-w-48">
			{/* biome-ignore lint/performance/noImgElement: authenticated private blob; never sent through the public image optimizer. */}
			<img
				src={src}
				alt={copy.openImage}
				className="max-h-48 rounded-control object-contain"
			/>
		</a>
	) : (
		<p role="status">{copy.loading}</p>
	);
}
