"use client";
import { Search } from "lucide-react";
import { organizationCopy } from "../../../../../../../lib/i18n/organizations";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSellerAccount } from "../../components/seller-account";
import { sellerInventoryCopy } from "../../../../../../../lib/i18n/seller-inventory";
import { StockPagination, stockHref } from "./stock-ui";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { direction, type Locale } from "../../../../../../../lib/i18n/locales";
import { inventoryCopy } from "../../../../../../../lib/i18n/inventory";
import { authCopy } from "../../../../../../../lib/i18n/auth";
import { Button } from "../../../../../../../components/shadcn/button";
import { Input } from "../../../../../../../components/shadcn/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "../../../../../../../components/shadcn/native-select";
import { Alert } from "../../../../../../../components/ui/alert";
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
import { SellerSelect } from "../../components/seller-select";
import { sellerShellCopy } from "../../../../../../../lib/i18n/seller-shell";
import {
	StatusBadge,
	statusVariant,
} from "../../../../../../../components/ui/status-badge";
import {
	DashboardSkeleton,
	TableSkeleton,
} from "../../../../../../../components/ui/skeleton";
type WorkspaceProps = {
	locale: Locale;
	screen: InventoryScreen;
	variant?: string;
	batch?: string;
};
export function InventoryWorkspace(props: WorkspaceProps) {
	const { session } = useSellerAccount();
	const identity = session
		? `${session.identity.id}:${session.accounts[0]?.id ?? ""}`
		: "anonymous";
	return <InventoryContext key={identity} {...props} />;
}
function InventoryContext({
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
		[refreshError, setRefreshError] = useState(""),
		[pendingScope, setPendingScope] = useState<string | null>(null);
	const hasProfiles = useRef(false);
	const selected = params.get("seller"),
		profile =
			profiles?.find((p) => p.id === selected) ??
			(!selected ? profiles?.[0] : undefined);
	const scope = `${profile?.id ?? ""}:${screen}:${variant ?? ""}:${batch ?? ""}:${params}`;
	const currentScope = useRef(scope),
		mounted = useRef(false),
		requests = useRef(0);
	currentScope.current = scope;
	const revoked = useCallback(() => {
		if (!mounted.current || currentScope.current !== scope) return;
		requests.current++;
		setProfiles(null);
		setError(t.denied);
	}, [scope, t]);
	const refresh = useCallback(async () => {
		const request = ++requests.current;
		try {
			const value = await inventoryRequest<StockProfiles>("seller/profiles/");
			if (!mounted.current || request !== requests.current) return;
			hasProfiles.current = true;
			setProfiles(value.profiles);
			setError("");
			setRefreshError("");
		} catch (e) {
			if (!mounted.current || request !== requests.current) return;
			if (
				!(e instanceof AccountError && [401, 403].includes(e.status ?? 0)) &&
				hasProfiles.current
			) {
				setRefreshError(t.unavailable);
				return;
			}
			setProfiles(null);
			setError(
				e instanceof AccountError && [401, 403].includes(e.status ?? 0)
					? t.denied
					: t.unavailable,
			);
		}
	}, [t]);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		const timer = setInterval(() => void refresh(), 30000);
		window.addEventListener("focus", refresh);
		return () => {
			mounted.current = false;
			requests.current++;
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
					<Button className="rounded-lg" onClick={() => void refresh()}>
						{t.retry}
					</Button>
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
	if (!profiles)
		return (
			<div role="status" aria-label={t.loading}>
				<span className="sr-only">{t.loading}</span>
				{screen === "overview" ? <DashboardSkeleton /> : <TableSkeleton />}
			</div>
		);
	const verificationBadge = profile && (
		<StatusBadge
			variant={statusVariant(profile.verification)}
			aria-label={organizationCopy[locale].status}
			className="rounded-full! px-2.5"
		>
			{organizationCopy[locale][
				profile.verification as
					| "draft"
					| "submitted"
					| "under_review"
					| "approved"
					| "rejected"
					| "needs_information"
			] ?? t.unknown}
		</StatusBadge>
	);
	const copy = sellerInventoryCopy[locale];
	const description =
		screen === "overview"
			? sellerShellCopy[locale].overviewDescription
			: screen === "inventory"
				? copy.inventoryDescription
				: screen === "movements"
					? copy.movementsDescription
					: screen === "detail"
						? copy.detailDescription
						: screen === "batch"
							? copy.batchDescription
							: screen === "settings"
								? copy.settingsDescription
								: screen === "receipt"
									? copy.receiptDescription
									: copy.adjustmentDescription;
	return (
		<>
			{refreshError && (
				<Alert role="alert">
					{refreshError}
					<Button
						variant="outline"
						size="sm"
						className="ms-2 h-8 rounded-lg text-xs"
						onClick={() => void refresh()}
					>
						{t.retry}
					</Button>
				</Alert>
			)}
			<header
				dir={direction(locale)}
				className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
			>
				<div dir={direction(locale)} className="min-w-0 flex-1">
					<h1 className="text-page-title font-bold text-foreground">
						{t[screen]}
					</h1>
					<p className="mt-1 max-w-2xl text-body text-muted">{description}</p>
				</div>
				<fieldset
					dir={direction(locale)}
					aria-label={t.business}
					className="m-0 w-full min-w-0 rounded-2xl border border-border bg-surface p-3 shadow-sm lg:w-72 lg:shrink-0 xl:w-80"
				>
					<div className="flex flex-wrap items-center justify-between gap-2 px-1">
						<span className="text-xs font-medium text-muted">{t.business}</span>
						{verificationBadge}
					</div>
					<div className="mt-1 [&_[role=combobox]]:border-0 [&_[role=combobox]]:bg-transparent [&_[role=combobox]]:px-1 [&_[role=combobox]]:text-base [&_[role=combobox]]:shadow-none [&_[role=combobox]]:hover:bg-info [&_[role=combobox]>svg:first-child]:size-5 [&_[role=combobox]>svg:first-child]:text-action [&_[role=combobox]>span]:whitespace-normal [&_[role=combobox]>span]:wrap-anywhere">
						<SellerSelect
							id="field-seller"
							label={t.business}
							icon="store"
							value={pendingScope ?? profile?.id ?? ""}
							options={profiles.map((p) => ({ value: p.id, label: p.name }))}
							onChange={(id) =>
								navigate(() => {
									setPendingScope(id);
									router.push(
										variant
											? sellerHref(locale, "inventory", id)
											: `${path}?seller=${encodeURIComponent(id)}`,
									);
								})
							}
						/>
					</div>
					{profile?.capabilities.read && !profile.capabilities.write && (
						<p className="mt-1 px-1 text-sm text-muted">{t.readOnly}</p>
					)}
				</fieldset>
			</header>
			{pendingScope && pendingScope !== selected ? (
				<div role="status" aria-label={t.loading}>
					<span className="sr-only">{t.loading}</span>
					{screen === "overview" ? (
						<DashboardSkeleton showHeader={false} />
					) : (
						<TableSkeleton />
					)}
				</div>
			) : !profile?.capabilities.read ? (
				<section className={panel}>
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
	const mounted = useRef(false),
		generation = useRef(0),
		inFlight = useRef<Promise<StockPosition | undefined> | null>(null);
	const scopedQuery = new URLSearchParams({ seller });
	for (const key of screen === "movements"
		? ["q", "action", "variant", "batch", "page"]
		: ["q", "state", "sort", "page"]) {
		const value = params.get(key);
		if (value) scopedQuery.set(key, value);
	}
	const queryString = scopedQuery.toString(),
		batchPage = params.get("page") ?? "1";
	const load = useCallback((): Promise<StockPosition | undefined> => {
		if (inFlight.current) return inFlight.current;
		const request = ++generation.current,
			current = () => mounted.current && request === generation.current;
		setBusy(true);
		setError("");
		const run = async () => {
			try {
				if (variant) {
					const value = await inventoryRequest<StockPosition>(
						`seller/variants/${variant}/?seller=${seller}`,
					);
					if (!current()) throw new Error("Obsolete stock request");
					if (!value.capabilities.read) {
						revoked();
						throw new Error("Stock access revoked");
					}
					if (batch) {
						const movements = await inventoryRequest<StockHistory>(
							`seller/movements/?${new URLSearchParams({ seller, variant, batch, page: batchPage })}`,
						);
						if (!current()) throw new Error("Obsolete stock request");
						setHistory(movements);
					}
					setPosition(value);
					return value;
				}
				if (screen === "movements") {
					const value = await inventoryRequest<StockHistory>(
						`seller/movements/?${queryString}`,
					);
					if (current()) setHistory(value);
				} else {
					const value = await inventoryRequest<StockOverview>(
						`seller/overview/?${queryString}`,
					);
					if (current()) setOverview(value);
				}
			} catch (e) {
				if (current()) {
					if (e instanceof AccountError && [401, 403].includes(e.status ?? 0))
						revoked();
					else
						setError(
							e instanceof AccountError && e.status === 404
								? t.notFound
								: t.unavailable,
						);
				}
				throw e;
			} finally {
				if (current()) {
					setBusy(false);
					inFlight.current = null;
				}
			}
		};
		const promise = run();
		inFlight.current = promise;
		return promise;
	}, [variant, seller, screen, queryString, t, revoked, batch, batchPage]);
	useEffect(() => {
		mounted.current = true;
		void load().catch(() => {});
		return () => {
			mounted.current = false;
			generation.current++;
			inFlight.current = null;
		};
	}, [load]);
	function change(values: Record<string, string>) {
		const next = new URLSearchParams(params);
		next.set("seller", seller);
		for (const [k, v] of Object.entries(values)) {
			if (v) next.set(k, v);
			else next.delete(k);
		}
		router.push(`${path}?${next}`, { scroll: false });
	}
	const href = (route: string, changes: Record<string, string> = {}) =>
		stockHref(locale, route, seller, params, changes);
	if (busy && !position)
		return (
			<div role="status" aria-label={t.loading}>
				<span className="sr-only">{t.loading}</span>
				{screen === "overview" ? (
					<DashboardSkeleton showHeader={false} />
				) : (
					<TableSkeleton />
				)}
			</div>
		);
	if (error && !position)
		return (
			<section className={panel}>
				<Alert role="alert">{error}</Alert>
				<Button
					className="rounded-lg"
					disabled={busy}
					onClick={() => void load().catch(() => {})}
				>
					{t.retry}
				</Button>
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
					{position.capabilities.write && (
						<Button
							asChild
							variant="outline"
							size="sm"
							className="mt-3 h-9 rounded-lg text-xs font-semibold"
						>
							<Link href={href(`inventory/${position.id}/settings`)}>
								{t.settings}
							</Link>
						</Button>
					)}
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

	if (history) {
		const copy = sellerInventoryCopy[locale];
		const movementsFiltered = ["q", "action", "variant", "batch"].some((key) =>
			params.get(key),
		);
		return (
			<section className={panel}>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h2 className="m-0 text-base font-semibold">
						{t.movements}:{" "}
						<bdi className="tabular-nums text-muted">
							{new Intl.NumberFormat(locale).format(history.count)}
						</bdi>
					</h2>
					{movementsFiltered && (
						<Button
							variant="ghost"
							size="sm"
							className="h-8 rounded-lg text-xs font-semibold"
							onClick={() => {
								setQuery("");
								change({
									q: "",
									action: "",
									variant: "",
									batch: "",
									page: "1",
								});
							}}
						>
							{copy.clear}
						</Button>
					)}
				</div>
				<form
					aria-label={t.filters}
					className="mt-4 grid min-w-0 items-end gap-3 border-b border-border pb-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
					onSubmit={(e) => {
						e.preventDefault();
						change({ q: query, page: "1" });
					}}
				>
					<div className="min-w-0 space-y-1.5">
						<label
							htmlFor="movement-q"
							className="block text-xs font-medium text-muted"
						>
							{copy.movementSearch}
						</label>
						<div className="relative">
							<Search
								className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted"
								aria-hidden="true"
							/>
							<Input
								id="movement-q"
								name="q"
								type="search"
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								maxLength={100}
								placeholder={copy.movementSearch}
								className="h-9 rounded-lg ps-9 text-sm"
							/>
						</div>
					</div>
					<div className="min-w-0 space-y-1.5">
						<label
							htmlFor="movement-action"
							className="block text-xs font-medium text-muted"
						>
							{t.action}
						</label>
						<NativeSelect
							id="movement-action"
							name="action"
							value={params.get("action") ?? ""}
							onChange={(event) =>
								change({ action: event.target.value, page: "1" })
							}
							className="rounded-lg"
						>
							<NativeSelectOption value="">
								{copy.allOperations}
							</NativeSelectOption>
							{[
								["receive", t.received],
								["adjust", t.adjusted],
								["reserve", t.reserved],
								["release", t.released],
								["consume", t.consumed],
								["cod", t.cod],
							].map(([value, label]) => (
								<NativeSelectOption key={value} value={value}>
									{label}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</div>
					<Button type="submit" className="h-9 rounded-lg text-xs font-semibold">
						<Search className="size-4" aria-hidden="true" />
						{t.filters}
					</Button>
				</form>
				<div className="mt-5">
					<MovementTable
						locale={locale}
						seller={seller}
						rows={history.results}
						params={params}
						fromHistory
					/>
				</div>
				<StockPagination
					locale={locale}
					page={history.page}
					count={history.count}
					size={history.page_size}
					href={(page) => href("inventory/movements", { page: String(page) })}
					onPage={(page) => change({ page: String(page) })}
				/>
			</section>
		);
	}
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
