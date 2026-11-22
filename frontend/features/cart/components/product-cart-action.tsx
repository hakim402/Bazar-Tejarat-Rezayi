"use client";
import Link from "next/link";
import { Button } from "@/components/shadcn/button";
import { displayDecimal } from "@/lib/display-decimal";
import toast from "react-hot-toast";
import { useSearchParams } from "next/navigation";
import { AccountError } from "../../../lib/api/private-client";
import {
	cartIntent,
	retainCartIntent,
	settleCartIntent,
	validCartQuantity,
	initialCartQuantity,
	type CartIntent,
} from "../recovery";
import { announceCartChange } from "../transport";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { PublicProduct } from "../../marketplace/types";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import {
	commerce,
	cartPath,
	addQuantity,
	estimate,
	stepQuantity,
	type Cart,
} from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import { marketplaceCopy } from "../../marketplace/copy";
import { Icon } from "../../../components/ui/icon";
import { action, Failure } from "../../orders/components/controls";
export function ProductCartAction({
	locale,
	product,
	variant,
}: {
	locale: Locale;
	product: PublicProduct;
	variant: string;
}) {
	const session = useCommunicationSession("buyer"),
		t = commerceCopy[locale];
	if (session.loading) return <p role="status">{t.loading}</p>;
	if (!session.session && !accessLost(session.error))
		return <Failure locale={locale} error={session.error} />;
	const context = session.session ? "buyer" : "guest";
	return (
		<ProductCartEditor
			key={`${locale}:${variant}:${session.session?.identity.id ?? "guest"}:${session.session?.accounts[0].id ?? "guest"}`}
			scope={`${context}:${session.session?.identity.id ?? "guest"}:${session.session?.accounts[0].id ?? "guest"}`}
			locale={locale}
			product={product}
			variant={variant}
			context={context}
		/>
	);
}
function ProductCartEditor({
	locale,
	product,
	variant,
	context,
	scope,
}: {
	scope: string;
	locale: Locale;
	product: PublicProduct;
	variant: string;
	context: "buyer" | "guest";
}) {
	const v = product.variants.find((x) => x.id === variant);
	const t = commerceCopy[locale],
		[tier, setTier] = useState<"retail" | "wholesale">(
			v?.retail === null && v.wholesale !== null ? "wholesale" : "retail",
		),
		[quantity, setQuantity] = useState(() =>
			displayDecimal(initialCartQuantity(v?.increment ?? "1.000")),
		),
		[error, setError] = useState<unknown>(),
		[busy, setBusy] = useState(false),
		[saved, setSaved] = useState(false),
		[guestChanged, setGuestChanged] = useState(false),
		[usingCurrentGuest, setUsingCurrentGuest] = useState(false);
	const query = useSearchParams();
	const recoverKey = query.get("cart_attempt");
	const recovery =
		query.get("cart_context") === context &&
		recoverKey &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			recoverKey,
		)
			? {
					command_id: recoverKey,
					...(context === "guest"
						? { guest_scope: query.get("cart_scope") ?? undefined }
						: {}),
				}
			: null;
	const [initialPending] = useState(
		() =>
			cartIntent(scope) ??
			(recovery ? retainCartIntent(scope, recovery) : null),
	);
	const pending = useRef<CartIntent | null>(initialPending),
		live = useRef(true),
		owned = useRef(false);
	useEffect(() => {
		live.current = true;
		return () => {
			live.current = false;
			owned.current = false;
		};
	}, []);
	function retainReference(key: string | null) {
		const url = new URL(location.href);
		if (key) {
			url.searchParams.set("cart_attempt", key);
			url.searchParams.set("cart_context", context);
			if (context === "guest" && pending.current?.guest_scope)
				url.searchParams.set("cart_scope", pending.current.guest_scope);
		} else {
			url.searchParams.delete("cart_attempt");
			url.searchParams.delete("cart_context");
			url.searchParams.delete("cart_scope");
		}
		history.replaceState(null, "", url);
	}
	async function add() {
		if (
			pending.current &&
			(!pending.current.action || pending.current.variant !== variant)
		) {
			await reconcile();
			return;
		}
		if (owned.current) return;
		owned.current = true;
		setBusy(true);
		setError(null);
		setUsingCurrentGuest(false);

		try {
			if (!pending.current) {
				if (!v || !validCartQuantity(quantity, v.increment))
					throw new AccountError(400, ["quantity"], "invalid_quantity");
				const cart = await commerce<Cart>(
					`${cartPath(context)}?locale=${locale}`,
				);
				const old = cart.lines.find(
					(x) => x.variant === variant && x.tier === tier,
				);
				if (!live.current) return;
				pending.current = retainCartIntent(scope, {
					command_id: crypto.randomUUID(),
					...(context === "guest"
						? { guest_scope: cart.guest_scope ?? "" }
						: {}),
					version: cart.version,
					action: "set",
					variant,
					tier,
					quantity: addQuantity(old?.quantity ?? "0.000", quantity),
				});
			}
			if (pending.current) retainReference(pending.current.command_id);
			await commerce(cartPath(context), pending.current);
			if (live.current) {
				settleCartIntent(scope);
				retainReference(null);
				pending.current = null;
				setSaved(true);
				toast.success(t.saved);
				announceCartChange();
			}
		} catch (e) {
			if (live.current) {
				setError(e);
				toast.error(t.actionFailed);
			}
		} finally {
			if (live.current) {
				owned.current = false;
				setBusy(false);
			}
		}
	}
	async function reconcile(useCurrentGuest = false) {
		if (owned.current || !pending.current) return;
		owned.current = true;
		setBusy(true);
		setError(null);
		try {
			if (useCurrentGuest && context === "guest") {
				// Confirm against the current cookie again: another tab may have
				// rotated it since the explanation was shown. Never replay the add.
				const current = await commerce<Cart>(cartPath("guest"));
				if (!live.current) return;
				if (
					!current.guest_scope ||
					!pending.current?.guest_scope ||
					current.guest_scope === pending.current.guest_scope
				) {
					setGuestChanged(false);
					throw new AccountError(409);
				}
				settleCartIntent(scope);
				retainReference(null);
				pending.current = null;
				setGuestChanged(false);
				setUsingCurrentGuest(true);
				setSaved(false);
				return;
			}
			const result = await commerce<{ state: "applied" | "rejected" }>(
				`cart/${context}/commands/reconcile/`,
				pending.current,
			);
			if (!live.current) return;
			settleCartIntent(scope);
			retainReference(null);
			pending.current = null;
			setSaved(result.state === "applied");
			if (result.state === "applied") {
				announceCartChange();
				toast.success(t.saved);
			}
		} catch (e) {
			if (!live.current) return;
			setError(e);
			if (
				context === "guest" &&
				e instanceof AccountError &&
				e.status === 409
			) {
				try {
					const current = await commerce<Cart>(cartPath("guest"));
					if (!live.current) return;
					const changed =
						!!current.guest_scope &&
						!!pending.current?.guest_scope &&
						current.guest_scope !== pending.current.guest_scope;
					setGuestChanged(changed);
					if (changed) setError(null);
					else toast.error(t.actionFailed);
				} catch (currentError) {
					if (live.current) {
						setError(currentError);
						toast.error(t.actionFailed);
					}
				}
			} else toast.error(t.actionFailed);
		} finally {
			if (live.current) {
				owned.current = false;
				setBusy(false);
			}
		}
	}
	if (!v) return null;
	const market = marketplaceCopy[locale],
		unit = v.unit_labels[locale] || v.unit,
		price = tier === "retail" ? v.retail : v.wholesale,
		// estimate expects canonical 3-decimal quantities; normalize raw input.
		total =
			price != null && validCartQuantity(quantity, v.increment)
				? estimate(price, addQuantity(quantity, "0"))
				: null,
		locked = busy || !!pending.current,
		step = (delta: 1 | -1) => {
			setSaved(false);
			try {
				setQuantity(displayDecimal(stepQuantity(quantity, v.increment, delta)));
			} catch {
				setQuantity(displayDecimal(initialCartQuantity(v.increment)));
			}
		};
	return (
		<section className="space-y-3" data-testid="product-cart-action">
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					void add();
				}}
			>
				{v.retail !== null && v.wholesale !== null && (
					<fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
						<legend className="mb-2 text-sm font-semibold">{t.tier}</legend>
						{(["retail", "wholesale"] as const).map((row) => (
							<Button
								key={row}
								type="button"
								aria-pressed={tier === row}
								disabled={locked}
								variant={tier === row ? "secondary" : "outline"}
								onClick={() => {
									setTier(row);
									setSaved(false);
								}}
							>
								{t[row]}
							</Button>
						))}
					</fieldset>
				)}
				<div className="space-y-1.5">
					<span
						id={`quantity-label-${v.id}`}
						className="block text-sm font-semibold"
					>
						{t.quantity} · {unit}
					</span>
					<div className="flex w-full max-w-52 items-stretch overflow-hidden rounded-control border border-border bg-surface focus-within:border-action">
						<button
							type="button"
							aria-label={market.decreaseQuantity}
							title={market.decreaseQuantity}
							disabled={locked}
							onClick={() => step(-1)}
							className="flex w-11 shrink-0 items-center justify-center border-e border-border text-foreground transition-colors hover:bg-info hover:text-action active:bg-info disabled:opacity-50"
						>
							<Icon name="minus" className="size-4" />
						</button>
						<input
							inputMode="decimal"
							dir="ltr"
							aria-labelledby={`quantity-label-${v.id}`}
							className="min-h-11 w-full min-w-0 border-0 bg-transparent px-2 text-center font-bold text-foreground"
							value={quantity}
							maxLength={20}
							disabled={locked}
							onChange={(e) => {
								setQuantity(e.target.value);
								setSaved(false);
							}}
							required
						/>
						<button
							type="button"
							aria-label={market.increaseQuantity}
							title={market.increaseQuantity}
							disabled={locked}
							onClick={() => step(1)}
							className="flex w-11 shrink-0 items-center justify-center border-s border-border text-foreground transition-colors hover:bg-info hover:text-action active:bg-info disabled:opacity-50"
						>
							<Icon name="plus" className="size-4" />
						</button>
					</div>
				</div>
				{total !== null && (
					<p className="flex items-baseline justify-between gap-3 text-sm">
						<span className="text-muted">{market.subtotal}</span>
						<bdi dir="ltr" className="text-base font-extrabold">
							{displayDecimal(total)} {product.currency}
						</bdi>
					</p>
				)}
				<p className="text-xs text-muted">
					{t.increment}: <bdi>{displayDecimal(v.increment)}</bdi>
					{tier === "wholesale" && (
						<>
							{" "}
							· {t.minimum}: <bdi>{displayDecimal(v.minimum)}</bdi>
						</>
					)}
				</p>
				{tier === "wholesale" && (
					<p className="text-xs text-muted">{t.wholesaleHelp}</p>
				)}
				<Failure locale={locale} error={error} />

				{pending.current && (
					<div className="space-y-2">
						<p role="status" className="text-sm">
							{guestChanged ? t.guestCartChanged : t.retryHelp}
						</p>
						<button
							type="button"
							className={`${action} w-full gap-2`}
							disabled={busy}
							onClick={() => void reconcile(guestChanged)}
						>
							<Icon name="history" className="size-4" />
							{guestChanged ? t.useCurrentCart : t.reconcile}
						</button>
					</div>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						type="submit"
						size="lg"
						className="min-h-11"
						disabled={busy || guestChanged}
					>
						<Icon name="cart" className="size-4" />
						{busy ? t.loading : pending.current ? t.retry : t.add}
					</Button>
					<Button asChild variant="outline" size="lg" className="min-h-11">
						<Link href={`/${locale}/cart`}>{t.cart}</Link>
					</Button>
				</div>
				{saved && (
					<p
						role="status"
						className="flex items-center gap-1.5 text-sm font-semibold text-success"
					>
						<Icon name="check-circle" className="size-4" />
						{t.saved}
					</p>
				)}
				{usingCurrentGuest && (
					<p role="status" className="text-sm text-muted">
						{t.guestCartReady}
					</p>
				)}
			</form>
		</section>
	);
}
