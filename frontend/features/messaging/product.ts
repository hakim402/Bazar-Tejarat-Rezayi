import { useEffect, useState } from "react";
import { privateRequest } from "../../lib/api/private-client";
import type { PublicProduct } from "../marketplace/types";

const cache = new Map<string, PublicProduct | null>();

// Shared cached public-product lookup for inbox covers and thread profile chips.
export function usePublicProduct(locale: string, product: string) {
	const key = `${locale}:${product}`;
	const [value, setValue] = useState<PublicProduct | null | undefined>(() =>
		cache.get(key),
	);
	useEffect(() => {
		if (!product) return;
		if (cache.has(key)) {
			setValue(cache.get(key));
			return;
		}
		const controller = new AbortController();
		let alive = true;
		void privateRequest<PublicProduct>(
			`marketplace/public/${locale}/products/${product}/`,
			undefined,
			"GET",
			{ signal: controller.signal },
		)
			.then((result) => {
				cache.set(key, result);
				if (alive) setValue(result);
			})
			.catch(() => {
				if (alive) setValue(null);
			});
		return () => {
			alive = false;
			controller.abort();
		};
	}, [key, locale, product]);
	return value;
}
