"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../../lib/i18n/locales";
import { pageCopy } from "../pages/copy";
import { Icon } from "../../components/ui/icon";
import {
	categories,
	demoProducts,
	isCategory,
	isDemoProduct,
	productHref,
	productImage,
} from "./data";
import { storefrontCopy } from "./copy";
export function DemoPreview({ locale }: { locale: Locale }) {
	const t = storefrontCopy[locale],
		dialog = useRef<HTMLDialogElement>(null),
		opener = useRef<HTMLElement | null>(null);
	const [selection, setSelection] = useState("");
	const product = selection.startsWith("demo-product-")
		? selection.slice(13)
		: "";
	const category = selection.startsWith("category-") ? selection.slice(9) : "";
	const item = isDemoProduct(product) ? product : null;
	const categoryId = isCategory(category) ? category : null;
	const all = selection === "demo-categories";
	useEffect(() => {
		function update() {
			const value = location.hash.slice(1);
			const valid =
				value === "demo-categories" ||
				(value.startsWith("demo-product-") && isDemoProduct(value.slice(13))) ||
				(value.startsWith("category-") && isCategory(value.slice(9)));
			if (valid && !dialog.current?.open)
				opener.current =
					document.activeElement instanceof HTMLElement
						? document.activeElement
						: null;
			setSelection(valid ? value : "");
		}
		update();
		window.addEventListener("hashchange", update);
		return () => window.removeEventListener("hashchange", update);
	}, []);
	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		if (selection && !element.open) element.showModal();
		else if (!selection && element.open) element.close();
	}, [selection]);
	function close() {
		dialog.current?.close();
		history.replaceState(null, "", location.pathname + location.search);
		setSelection("");
		if (opener.current?.isConnected) opener.current.focus();
		else document.querySelector<HTMLElement>("header a")?.focus();
	}
	return (
		<dialog
			ref={dialog}
			aria-labelledby="demo-preview-title"
			onKeyDown={(event) => {
				if (event.key !== "Tab") return;
				const targets = [
					...event.currentTarget.querySelectorAll<HTMLElement>(
						'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
					),
				].filter((element) => element.getClientRects().length > 0);
				const first = targets[0],
					last = targets.at(-1);
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}}
			onCancel={(event) => {
				event.preventDefault();
				close();
			}}
			className="fixed m-auto max-h-[90dvh] w-[min(94vw,42rem)] overflow-y-auto rounded-3xl border border-border bg-surface p-6 text-foreground shadow-card backdrop:bg-foreground/45 desktop:p-8"
		>
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="mb-2 text-xs font-bold text-action">{t.demo}</p>
					<h2 id="demo-preview-title" className="text-xl">
						{item
							? t.products[item].title
							: categoryId
								? t.categoryNames[categoryId]
								: t.allCategories}
					</h2>
				</div>
				<button
					type="button"
					aria-label={t.close}
					onClick={close}
					className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-page text-foreground"
				>
					<Icon name="close" />
				</button>
			</div>
			{item ? (
				<div className="mt-5 space-y-4">
					<div className="rounded-3xl bg-linear-to-br from-campaign-start to-campaign-end p-5">
						<Image
							src={productImage(item)}
							alt={t.products[item].alt}
							width={1280}
							height={1280}
							sizes="(max-width: 767px) 320px, 500px"
							className="mx-auto h-64 w-full object-contain"
						/>
					</div>
					<p className="text-sm leading-8 text-muted">
						{t.products[item].description}
					</p>
					<a
						href={`/${locale}/how-it-works`}
						className="inline-flex min-h-11 items-center gap-2 font-bold"
					>
						{pageCopy[locale]["how-it-works"].title}
						<Icon name="arrow" className="size-4 rtl:rotate-180" />
					</a>
				</div>
			) : all ? (
				<div className="mt-5 grid grid-cols-1 gap-2 desktop:grid-cols-2">
					{categories.map(({ id, icon }) => (
						<a
							href={`#category-${id}`}
							key={id}
							className="flex min-h-12 items-center gap-3 rounded-xl bg-page px-4 text-sm text-foreground no-underline hover:bg-info"
						>
							<Icon name={icon} className="size-4" />
							{t.categoryNames[id]}
						</a>
					))}
				</div>
			) : (
				<div className="mt-5 grid grid-cols-2 gap-4">
					{demoProducts
						.filter((id) => id === categoryId)
						.map((id) => (
							<a
								key={id}
								href={productHref(locale, id)}
								className="col-span-2 rounded-2xl bg-page p-4 text-center text-foreground no-underline"
							>
								<Image
									src={productImage(id)}
									alt={t.products[id].alt}
									width={1280}
									height={1280}
									sizes="320px"
									className="mx-auto h-52 w-full object-contain"
								/>
								<h3 className="mt-3 text-base">{t.products[id].title}</h3>
								<span className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-action">
									{t.preview}
								</span>
							</a>
						))}
				</div>
			)}
			<p className="mt-5 border-t border-border pt-4 text-xs leading-6 text-muted">
				{t.demoNotice}
			</p>
		</dialog>
	);
}
