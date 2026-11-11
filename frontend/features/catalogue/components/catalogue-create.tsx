"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import Link from "next/link";
import { Button } from "../../../components/ui/button";
import { Icon } from "../../../components/ui/icon";
import { SectionCard } from "../../../components/ui/section-card";
import { AccountError } from "../../../lib/api/private-client";
import {
	accountSession,
	ACCOUNT_SESSION_CHANGED,
} from "../../identity/api/accounts";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import {
	productFlowCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import type { Locale } from "../../../lib/i18n/locales";
import { catalogueRequest as api } from "../api/catalogue";
import type { Operation, ProductList } from "../types";
import {
	CatalogueValidation,
	Control,
	Feedback,
	failure,
} from "./catalogue-fields";
import {
	ProductsPage,
	productHref,
	productLink,
	useProductGuard,
} from "./seller-products-ui";

import { ProductSteps } from "./product-steps";

export function CatalogueCreate({
	locale,
	identity,
}: {
	locale: Locale;
	identity: string;
}) {
	const t = catalogueCopy[locale],
		copy = sellerProductsCopy[locale],
		router = useRouter(),
		query = useSearchParams();
	const [list, setList] = useState<ProductList | null>(null),
		[feedback, setFeedback] = useState<ReturnType<typeof failure> | null>(null);
	const [seller, setSeller] = useState(""),
		[currency, setCurrency] = useState("AFN"),
		[mode, setMode] = useState("fixed"),
		[baseline, setBaseline] = useState("");
	const [busy, setBusy] = useState(false),
		[blocked, setBlocked] = useState(false),
		[created, setCreated] = useState<Operation | null>(null);
	const generation = useRef(0),
		write = useRef<symbol | null>(null);
	const values = JSON.stringify({ seller, currency, mode });
	const dirty = !!baseline && values !== baseline && !created;
	const guard = useProductGuard(locale, dirty);
	const resetGuard = guard.reset;
	useEffect(() => {
		let current = true;
		const refresh = () => {
			const mine = ++generation.current;
			resetGuard();
			setList(null);
			setFeedback(null);
			setSeller("");
			setCurrency("AFN");
			setMode("fixed");
			setBaseline("");
			setBusy(false);
			void api<ProductList>("seller", "products/?page=1")
				.then((value) => {
					if (!current || mine !== generation.current) return;
					const business = query.get("seller");
					const initial = business
						? (value.sellers.find((row) => row.id === business)?.id ?? "")
						: (value.sellers[0]?.id ?? "");
					setList(value);
					setSeller(initial);
					setBaseline(
						JSON.stringify({ seller: initial, currency: "AFN", mode: "fixed" }),
					);
				})
				.catch((error) => {
					if (current && mine === generation.current)
						setFeedback(failure(error, locale));
				});
		};
		refresh();
		window.addEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		return () => {
			current = false;
			++generation.current;
			window.removeEventListener(ACCOUNT_SESSION_CHANGED, refresh);
		};
	}, [locale, query, resetGuard]);
	useEffect(() => {
		if (created)
			router.push(
				productHref(locale, `catalogue/${created.id}`, seller, query),
			);
	}, [created, locale, router, seller, query]);
	async function create() {
		if (
			write.current ||
			busy ||
			blocked ||
			!list?.sellers.some((row) => row.id === seller)
		)
			return;
		const owner = Symbol();
		write.current = owner;
		const mine = generation.current;
		setBusy(true);
		setFeedback(null);
		try {
			const session = await accountSession("seller");
			if (mine !== generation.current) return;
			if (`${session.identity.id}:${session.accounts[0].id}` !== identity) {
				setList(null);
				setFeedback({ message: t.denied, issues: [] });
				return;
			}
			const result = await api<Operation>("seller", "products/", {
				seller,
				currency,
				pricing_mode: mode,
			});
			if (mine === generation.current) {
				toast.success(productFlowCopy[locale].savedToast);
				setCreated(result);
			}
		} catch (error) {
			if (mine !== generation.current) return;
			toast.error(productFlowCopy[locale].errorToast);
			setFeedback(failure(error, locale));
			if (
				error instanceof AccountError &&
				[401, 403, 404].includes(error.status ?? 0)
			)
				setList(null);
			else if (!(error instanceof AccountError) || (error.status ?? 0) >= 500)
				setBlocked(true);
		} finally {
			if (write.current === owner) write.current = null;
			if (mine === generation.current) setBusy(false);
		}
	}
	return (
		<CatalogueValidation.Provider
			value={{ locale, issues: feedback?.issues ?? [] }}
		>
			<ProductsPage
				narrow
				locale={locale}
				title={copy.setupTitle}
				description={productFlowCopy[locale].steps[0]}
				back={productHref(locale, "catalogue", query.get("seller"), query)}
			>
				<ProductSteps locale={locale} current={0} />
				{guard.feedback}
				{feedback && <Feedback locale={locale} value={feedback} />}
				{blocked && (
					<p
						role="status"
						className="rounded-xl bg-warning-surface p-4 text-warning"
					>
						{copy.reloadRequired}{" "}
						<Link
							className="text-inherit underline"
							href={productHref(
								locale,
								"catalogue",
								query.get("seller"),
								query,
							)}
						>
							{copy.title}
						</Link>
					</p>
				)}
				{list ? (
					<SectionCard
						className="mx-auto max-w-4xl rounded-2xl"
						title={productFlowCopy[locale].steps[0]}
					>
						<form
							noValidate
							onSubmit={(event) => {
								event.preventDefault();
								void create();
							}}
							aria-busy={busy}
							className="space-y-5"
						>
							<fieldset
								disabled={busy || blocked || !!created}
								className="m-0 min-w-0 space-y-5 border-0 p-0"
							>
								<Control
									path="seller"
									label={t.seller}
									value={seller}
									options={[
										{ value: "", label: t.seller },
										...list.sellers.map((row) => ({
											value: row.id,
											label: row.name,
										})),
									]}
									onChange={setSeller}
								/>
								<div className="grid gap-5 sm:grid-cols-2">
									<Control
										path="currency"
										label={t.currency}
										value={currency}
										options={["AFN", "USD"].map((value) => ({
											value,
											label: value,
										}))}
										onChange={setCurrency}
									/>
									<Control
										path="pricing_mode"
										label={t.mode}
										value={mode}
										options={[
											{ value: "fixed", label: t.fixed },
											{ value: "negotiable", label: t.negotiable },
										]}
										onChange={setMode}
									/>
								</div>
								<p className="rounded-xl bg-info p-4 text-sm leading-relaxed text-foreground">
									{copy.setupRule}
								</p>
								{!list.sellers.length && (
									<p role="status" className="text-sm text-muted">
										{copy.creationDenied}
									</p>
								)}
								<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
									<Link
										className={productLink}
										href={productHref(
											locale,
											"catalogue",
											query.get("seller"),
											query,
										)}
									>
										{copy.cancel}
									</Link>
									<Button
										type="submit"
										className="mt-0!"
										disabled={busy || blocked || !seller || !!created}
									>
										{busy || created ? copy.busy : productFlowCopy[locale].next}
										<Icon name="arrow" className="size-4 rtl:rotate-180" />
									</Button>
								</div>
							</fieldset>
						</form>
					</SectionCard>
				) : (
					!feedback && <p role="status">{t.loading}</p>
				)}
			</ProductsPage>
		</CatalogueValidation.Provider>
	);
}
