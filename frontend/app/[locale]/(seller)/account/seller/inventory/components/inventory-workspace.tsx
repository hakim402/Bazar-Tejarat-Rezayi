"use client";
import { Pagination } from "../../../../../../../features/inventory/components/pagination";
import { organizationCopy } from "../../../../../../../lib/i18n/organizations";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { authCopy } from "../../../../../../../lib/i18n/auth";
import { Button } from "../../../../../../../components/ui/button";
import { Alert } from "../../../../../../../components/ui/alert";
import {
	Field,
	Input,
	Select,
} from "../../../../../../../components/ui/form-field";
import { useNavigation } from "../../../../../../../components/layout/navigation-guard";
import { AccountError } from "../../../../../../../lib/api/private-client";
import {
	inventoryRequest,
	type StockPosition,
	type StockProfiles,
	type StockOverview,
	type StockHistory,
} from "../../../../../../../features/inventory/api/inventory";
import {
	sellerHref,
	type InventoryScreen,
} from "../../../../../../../lib/routes/account-routes";
import { StockList } from "./stock-list";
import { StockDetail } from "./stock-detail";
import { InventoryForm } from "./inventory-form";
import { MovementTable, panel, linkClass } from "./stock-parts";
export function InventoryWorkspace({
	locale,
	screen,
	variant,
	batch,
}: {
	locale: Locale;
	screen: InventoryScreen;
	variant?: string;
	batch?: string;
}) {
	const t = inventoryCopy[locale],
		router = useRouter(),
		path = usePathname(),
		params = useSearchParams(),
		navigate = useNavigation();
	const [profiles, setProfiles] = useState<StockProfiles["profiles"] | null>(
			null,
		),
		[error, setError] = useState(""),
		[pendingScope, setPendingScope] = useState<string | null>(null);
	const revoked = useCallback(() => {
		setProfiles(null);
		setError(t.denied);
	}, [t]);
	const selected = params.get("seller"),
		profile =
			profiles?.find((p) => p.id === selected) ??
			(!selected ? profiles?.[0] : undefined);
	const refresh = useCallback(async () => {
		try {
			const value = await inventoryRequest<StockProfiles>("seller/profiles/");
			setProfiles(value.profiles);
			setError("");
		} catch (e) {
			setProfiles(null);
			setError(
				e instanceof AccountError && [401, 403].includes(e.status ?? 0)
					? t.denied
					: t.unavailable,
			);
		}
	}, [t]);
	useEffect(() => {
		void refresh();
		const timer = setInterval(() => void refresh(), 30000);
		window.addEventListener("focus", refresh);
		return () => {
			clearInterval(timer);
			window.removeEventListener("focus", refresh);
		};
	}, [refresh]);

	useEffect(() => {
		if (pendingScope && selected === pendingScope) setPendingScope(null);
	}, [pendingScope, selected]);
	if (error)
		return (
			<section className={panel}>
				<h1 className="text-2xl font-bold">{t[screen]}</h1>
				<Alert role="alert">{error}</Alert>
				<div className="flex flex-wrap gap-3">
					<Button onClick={() => void refresh()}>{t.retry}</Button>
					<Link className={linkClass} href={`/${locale}/auth/seller-sign-in`}>
						{authCopy[locale].signin}
					</Link>
					<Link
						className={linkClass}
						href={sellerHref(locale, "organizations")}
					>
						{t.help}
					</Link>
				</div>
			</section>
		);
	if (!profiles) return <p role="status">{t.loading}</p>;
	return (
		<>
			<section
				className={`${panel} flex flex-wrap items-end justify-between gap-4`}
			>
				<div className="w-full min-w-0 sm:max-w-xl">
					<Field name="seller" label={t.business}>
						<Select
							name="seller"
							value={pendingScope ?? profile?.id ?? ""}
							onChange={(e) => {
								const id = e.target.value;
								navigate(() => {
									setPendingScope(id);
									router.push(
										variant
											? sellerHref(locale, "inventory", id)
											: `${path}?seller=${encodeURIComponent(id)}`,
									);
								});
							}}
						>
							{!profile && <option value="">{t.business}</option>}
							{profiles.map((p) => (
								<option key={p.id} value={p.id}>
									{p.name}
								</option>
							))}
						</Select>
					</Field>
				</div>
				{profile && (
					<p className="text-sm text-muted">
						{organizationCopy[locale].status}:{" "}
						{organizationCopy[locale][
							profile.verification as
								| "draft"
								| "submitted"
								| "under_review"
								| "approved"
								| "rejected"
								| "needs_information"
						] ?? t.unknown}
					</p>
				)}
				{profile?.capabilities.read && !profile.capabilities.write && (
					<span className="text-sm text-muted">{t.readOnly}</span>
				)}
			</section>
			{pendingScope && pendingScope !== selected ? (
				<p role="status">{t.loading}</p>
			) : !profile?.capabilities.read ? (
				<section className={panel}>
					<h1 className="text-2xl font-bold">{t[screen]}</h1>
					<Alert variant="info">
						{profiles.length ? t.denied : t.noProfile}
					</Alert>
					<Link
						className={linkClass}
						href={sellerHref(locale, "organizations")}
					>
						{t.help}
					</Link>
				</section>
			) : (
				<ScopedStock
					key={`${profile.id}:${screen}:${variant ?? ""}:${batch ?? ""}:${params.toString()}`}
					locale={locale}
					seller={profile.id}
					screen={screen}
					variant={variant}
					batch={batch}
					revoked={revoked}
				/>
			)}
		</>
	);
}
function ScopedStock({
	locale,
	seller,
	screen,
	variant,
	batch,
	revoked,
}: {
	locale: Locale;
	seller: string;
	screen: InventoryScreen;
	variant?: string;
	batch?: string;
	revoked: () => void;
}) {
	const t = inventoryCopy[locale],
		params = useSearchParams(),
		router = useRouter(),
		path = usePathname();
	const [overview, setOverview] = useState<StockOverview | null>(null),
		[position, setPosition] = useState<StockPosition | null>(null),
		[history, setHistory] = useState<StockHistory | null>(null),
		[error, setError] = useState(""),
		[busy, setBusy] = useState(true),
		[query, setQuery] = useState(params.get("q") ?? "");
	const scopedQuery = new URLSearchParams(params);
	scopedQuery.set("seller", seller);
	const queryString = scopedQuery.toString();
	const load = useCallback(async () => {
		setBusy(true);
		setError("");
		try {
			if (variant) {
				const value = await inventoryRequest<StockPosition>(
					`seller/variants/${variant}/?seller=${seller}`,
				);
				if (batch)
					setHistory(
						await inventoryRequest<StockHistory>(
							`seller/movements/?seller=${seller}&variant=${variant}&batch=${batch}&page=${params.get("page") ?? "1"}`,
						),
					);
				setPosition(value);
				return value;
			}
			if (screen === "movements")
				setHistory(
					await inventoryRequest<StockHistory>(
						`seller/movements/?${queryString}`,
					),
				);
			else
				setOverview(
					await inventoryRequest<StockOverview>(
						`seller/overview/?${queryString}`,
					),
				);
		} catch (e) {
			setPosition(null);
			setOverview(null);
			setHistory(null);
			if (e instanceof AccountError && [401, 403].includes(e.status ?? 0))
				revoked();
			else
				setError(
					e instanceof AccountError && e.status === 404
						? t.notFound
						: t.unavailable,
				);
			throw e;
		} finally {
			setBusy(false);
		}
	}, [variant, seller, screen, queryString, t, revoked, batch, params]);
	// A scoped instance owns its data. Query changes discard old results before they can be displayed.
	useEffect(() => {
		let current = true;
		setOverview(null);
		setHistory(null);
		setPosition(null);
		const run = async () => {
			if (current) await load().catch(() => {});
		};
		void run();
		return () => {
			current = false;
		};
	}, [load]);
	function change(values: Record<string, string>) {
		const next = new URLSearchParams(queryString);
		for (const [k, v] of Object.entries(values)) {
			if (v) next.set(k, v);
			else next.delete(k);
		}
		router.push(`${path}?${next}`, { scroll: false });
	}
	const href = (route: string, changes: Record<string, string> = {}) =>
		sellerHref(locale, route, seller, params, changes);
	if (busy && !position) return <p role="status">{t.loading}</p>;
	if (error)
		return (
			<section className={panel}>
				<h1 className="text-2xl font-bold">{t[screen]}</h1>
				<Alert role="alert">{error}</Alert>
				<Button onClick={() => void load().catch(() => {})}>{t.retry}</Button>
			</section>
		);
	if (position) {
		if (["settings", "receipt", "adjustment"].includes(screen))
			return position.capabilities.write &&
				(screen === "settings" || position.configured) ? (
				<InventoryForm
					locale={locale}
					seller={seller}
					position={position}
					mode={screen as "settings" | "receipt" | "adjustment"}
					reload={async () => {
						const value = await load();
						if (!value) throw Error();
						return value;
					}}
					revoked={revoked}
				/>
			) : (
				<section className={panel}>
					<Alert variant="info">
						{position.capabilities.write ? t.policy : t.denied}
					</Alert>
					<Link href={href(`inventory/${position.id}/settings`)}>
						{t.settings}
					</Link>
				</section>
			);
		return (
			<StockDetail
				locale={locale}
				seller={seller}
				position={position}
				batch={batch}
				history={history}
				params={params}
				onPage={(page) => change({ page: String(page) })}
			/>
		);
	}

	if (history)
		return (
			<section className={panel}>
				<h1 className="text-2xl font-bold">{t.movements}</h1>
				<form
					className="my-5 flex flex-wrap items-end gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						change({ q: query, page: "1" });
					}}
				>
					<Field name="q" label={t.search}>
						<Input
							name="q"
							type="search"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							maxLength={100}
						/>
					</Field>
					<Field name="action" label={t.action}>
						<Select
							name="action"
							value={params.get("action") ?? ""}
							onChange={(e) => change({ action: e.target.value, page: "1" })}
						>
							<option value="">{t.all}</option>
							{[
								["receive", t.received],
								["adjust", t.adjusted],
								["reserve", t.reserved],
								["release", t.released],
								["consume", t.consumed],
								["cod", t.cod],
							].map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</Field>
					<Button type="submit">{t.filters}</Button>
				</form>
				<MovementTable locale={locale} seller={seller} rows={history.results} />
				<Pagination
					locale={locale}
					page={history.page}
					count={history.count}
					size={history.page_size}
					onPage={(page) => change({ page: String(page) })}
				/>
			</section>
		);
	if (!overview) return null;
	return (
		<StockList
			locale={locale}
			seller={seller}
			screen={screen}
			overview={overview}
			params={params}
			query={query}
			setQuery={setQuery}
			change={change}
		/>
	);
}
