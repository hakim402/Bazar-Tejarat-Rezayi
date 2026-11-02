"use client";
import Link from "next/link";
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
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locales";
import type { PublicProduct } from "../../marketplace/types";
import { useCommunicationSession, accessLost } from "../../messaging/hooks";
import { commerce, cartPath, addQuantity, type Cart } from "../../orders/api";
import { commerceCopy } from "../../orders/copy";
import {
	action,
	control,
	Failure,
	panel,
} from "../../orders/components/controls";
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
		[tier, setTier] = useState<"retail" | "wholesale">("retail"),
		[quantity, setQuantity] = useState(() =>
			initialCartQuantity(v?.increment ?? "1.000"),
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
					cartPath(context) + `?locale=${locale}`,
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
			}
		} catch (e) {
			if (live.current) setError(e);
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
				} catch (currentError) {
					if (live.current) setError(currentError);
				}
			}
		} finally {
			if (live.current) {
				owned.current = false;
				setBusy(false);
			}
		}
	}
	if (!v) return null;
	return (
		<section className={panel} data-testid="product-cart-action">
			<form
				className="space-y-3"
				onSubmit={(e) => {
					e.preventDefault();
					void add();
				}}
			>
				<label className="block space-y-2">
					{t.tier}
					<select
						aria-label={t.tier}
						className={control}
						value={tier}
						disabled={busy || !!pending.current}
						onChange={(e) => {
							setTier(e.target.value as typeof tier);
							setSaved(false);
						}}
					>
						<option value="retail">{t.retail}</option>
						<option value="wholesale">{t.wholesale}</option>
					</select>
				</label>
				<label className="block space-y-2">
					{t.quantity} · {v.unit_labels[locale] || v.unit}
					<input
						inputMode="decimal"
						dir="ltr"
						className={control}
						value={quantity}
						maxLength={20}
						disabled={busy || !!pending.current}
						onChange={(e) => {
							setQuantity(e.target.value);
							setSaved(false);
						}}
						required
					/>
				</label>
				<p className="text-sm text-muted">
					{t.increment}: <bdi>{v.increment}</bdi> · {t.minimum}:{" "}
					<bdi>{v.minimum}</bdi>
				</p>
				{tier === "wholesale" && (
					<p className="text-sm text-muted">{t.wholesaleHelp}</p>
				)}
				{product.pricing_mode === "negotiable" && <p>{t.negotiable}</p>}
				<Failure locale={locale} error={error} />

				{pending.current && (
					<div className="space-y-2">
						<p role="status">
							{guestChanged ? t.guestCartChanged : t.retryHelp}
						</p>
						<button
							type="button"
							className={action}
							disabled={busy}
							onClick={() => void reconcile(guestChanged)}
						>
							{guestChanged ? t.useCurrentCart : t.reconcile}
						</button>
					</div>
				)}
				<button
					className={action}
					disabled={busy || guestChanged}
					type="submit"
				>
					{busy ? t.loading : pending.current ? t.retry : t.add}
				</button>
				{saved && <p role="status">{t.saved}</p>}
				{usingCurrentGuest && <p role="status">{t.guestCartReady}</p>}
			</form>
			<Link className={action} href={`/${locale}/cart`}>
				{t.cart}
			</Link>
		</section>
	);
}
