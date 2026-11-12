// Owner-approved stand-ins (2026-11-12); swap for real fields when the backend exposes them.
// productRating/productRatingCount/discountPercent also drive the product detail buy box.
export const featuredPlaceholders = {
	rating: 4.8,
	ratingCount: "1.2K+",
	customers: "1.2K+",
	productRating: 4.8,
	productRatingCount: "3.2K",
	discountPercent: 15,
	memberSince: 2021,
};
export function placeholderCompareAt(
	retail: string,
	percent: number,
): string | null {
	const value = Number(retail);
	if (!Number.isFinite(value) || value <= 0) return null;
	return (value / (1 - percent / 100)).toFixed(2);
}
