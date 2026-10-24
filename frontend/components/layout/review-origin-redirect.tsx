"use client";

import { useEffect } from "react";
import { canonicalReviewUrl } from "../../lib/api/review-origin";

export function ReviewOriginRedirect() {
	useEffect(() => {
		// Next normalizes loopback server redirects; use the browser's actual URL.
		const canonical = canonicalReviewUrl(
			window.location.href,
			window.location.host,
			process.env.NEXT_PUBLIC_API_URL,
		);
		if (canonical) window.location.replace(canonical.href);
	}, []);
	return null;
}
