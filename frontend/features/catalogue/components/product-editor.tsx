"use client";
import {
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ChangeEvent,
	type ReactNode,
} from "react";
import Image from "next/image";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Icon } from "../../../components/ui/icon";
import { SectionCard } from "../../../components/ui/section-card";
import { apiOrigin } from "../../../lib/api/client";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { languageNames, locales, type Locale } from "../../../lib/i18n/locales";
import {
	productFlowCopy,
	sellerProductsCopy,
} from "../../../lib/i18n/seller-products";
import type { ProductBody, ProductDetail, Taxonomy } from "../types";
import { CatalogueValidation, Control, Attributes } from "./catalogue-fields";
import { VariantEditor, VariantPrices } from "./variant-editor";
import { ProductSteps, productStepForIssue } from "./product-steps";

export function ProductEditor({
	locale,
	body,
	item,
	taxonomy,
	busy,
	dirty = true,
	onReload,
	onChange,
	onSave,
	onSubmit,
	step,
	onStepChange,
	canSubmit,
	prices,
	onUpload,
}: {
	locale: Locale;
	body: ProductBody;
	item: ProductDetail;
	taxonomy: Taxonomy;
	busy: boolean;
	dirty?: boolean;
	onReload?: () => void;
	onChange: (b: ProductBody) => void;
	onSave: () => void;
	onSubmit: () => void;
	canSubmit: boolean;
	step: number;
	onStepChange: (step: number) => void;
	prices?: ReactNode;
	onUpload: (file: File) => void;
}) {
	const t = catalogueCopy[locale];
	const s = sellerProductsCopy[locale];
	const category = taxonomy.categories.find((c) => c.code === body.category);
	const [dropping, setDropping] = useState(false);
	const flow = productFlowCopy[locale];
	const form = useRef<HTMLFormElement>(null);
	const { issues } = useContext(CatalogueValidation);
	useEffect(() => {
		const target = issues
			.map((issue) => productStepForIssue(issue.path))
			.find((value) => value !== undefined);
		if (target !== undefined) onStepChange(target);
	}, [issues, onStepChange]);
	useLayoutEffect(() => {
		form.current
			?.querySelector<HTMLElement>(`[data-product-step="${step}"]`)
			?.focus({ preventScroll: true });
	}, [step]);
	function changeStep(next: number) {
		if (busy || next < 1 || next > 3) return;
		if (next > step) {
			const controls = form.current?.querySelectorAll<
				HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
			>(
				`[data-product-step="${step}"] input, [data-product-step="${step}"] select, [data-product-step="${step}"] textarea`,
			);
			if (
				controls &&
				Array.from(controls).some((control) => !control.reportValidity())
			)
				return;
		}
		onStepChange(next);
	}

	const update = (values: Partial<ProductBody>) =>
		onChange({ ...body, ...values });
	function fileChanged(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (file && !busy) onUpload(file);
	}
	const staged = (id: string) => item.images.find((image) => image.id === id);
	const availableImages = item.images.filter(
		(image) => !body.images.some((ref) => ref.id === image.id),
	);
	return (
		<div className="mx-auto w-full max-w-4xl space-y-6">
			<ProductSteps
				locale={locale}
				current={step}
				onChange={changeStep}
				disabled={busy}
			/>
			<form
				ref={form}
				id="product-source-form"
				className="min-w-0 space-y-5 text-base"
				aria-busy={busy}
				onSubmit={(e) => {
					e.preventDefault();
					if (!busy && dirty) onSave();
				}}
				noValidate
			>
				<fieldset
					disabled={busy}
					className="m-0 min-w-0 space-y-5 border-0 p-0"
				>
					<div
						hidden={step !== 1}
						data-product-step="1"
						tabIndex={-1}
						className="min-w-0 outline-none"
					>
						<SectionCard
							id="product-details"
							className="scroll-mt-28"
							title={s.details}
							description={s.detailsHelp}
						>
							<div className="space-y-5">
								<div className="grid gap-4 desktop:grid-cols-2">
									<Control
										path="body.title"
										required
										label={t.productTitle}
										maxLength={200}
										hint={t.basicInfoHelp}
										value={body.title}
										onChange={(title) => update({ title })}
									/>
									<Control
										path="body.category"
										required
										label={t.category}
										hint={
											taxonomy.categories.some((category) => category.active)
												? undefined
												: s.noCategories
										}
										value={body.category}
										options={[
											{ value: "", label: s.chooseCategory },
											...taxonomy.categories
												.filter((c) => c.active)
												.map((c) => ({
													value: c.code,
													label: c.labels[locale],
												})),
										]}
										onChange={(code) =>
											update({ category: code, attributes: {} })
										}
									/>
									<Control
										path="body.brand"
										label={t.brand}
										maxLength={100}
										value={body.brand}
										onChange={(brand) => update({ brand })}
									/>
									<Control
										path="body.locale"
										label={t.language}
										value={body.locale}
										options={locales.map((l) => ({
											value: l,
											label: languageNames[l],
										}))}
										onChange={(l) => update({ locale: l as Locale })}
									/>
								</div>
								<Control
									path="body.description"
									required
									label={t.description}
									textarea
									maxLength={6000}
									hint={t.plainText}
									value={body.description}
									onChange={(description) => update({ description })}
								/>
								<div className="space-y-3">
									<h3 className="text-body font-semibold text-foreground">
										{t.attributes}
									</h3>
									<p className="text-caption text-muted">{t.attributesHelp}</p>
									<Attributes
										fields={
											category?.attributes.filter((a) => !a.variant) ?? []
										}
										values={body.attributes}
										path="body.attributes"
										onChange={(attributes) => update({ attributes })}
									/>
								</div>
							</div>
						</SectionCard>
					</div>
					<div
						hidden={step !== 2}
						data-product-step="2"
						tabIndex={-1}
						className="min-w-0 outline-none"
					>
						<SectionCard
							id="product-options"
							className="scroll-mt-28"
							title={s.options}
							description={s.optionsHelp}
						>
							<VariantEditor
								locale={locale}
								variants={body.variants}
								category={category}
								taxonomy={taxonomy}
								onChange={(variants) => update({ variants })}
							/>
						</SectionCard>
						<SectionCard
							id="product-prices-new"
							className="scroll-mt-28"
							title={s.newPrices}
							description={s.pricesHelp}
						>
							<VariantPrices
								locale={locale}
								variants={body.variants}
								onChange={(variants) => update({ variants })}
							/>
						</SectionCard>
					</div>
					<div
						hidden={step !== 3}
						data-product-step="3"
						tabIndex={-1}
						className="min-w-0 outline-none"
					>
						<SectionCard
							id="product-photos"
							className="scroll-mt-28"
							title={s.photos}
							description={s.photosHelp}
						>
							<p className="mb-3 text-caption text-muted">{t.imageRule}</p>
							<label
								htmlFor="catalogue-file"
								className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 rounded-card border border-dashed p-5 text-center transition-colors duration-150 motion-reduce:transition-none ${
									dropping
										? "border-action bg-info"
										: "border-control bg-page hover:border-action"
								}`}
								onDragOver={(e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = busy ? "none" : "copy";
									setDropping(!busy);
								}}
								onDragLeave={() => setDropping(false)}
								onDrop={(e) => {
									e.preventDefault();
									setDropping(false);
									const file = e.dataTransfer.files?.[0];
									if (file && !busy) onUpload(file);
								}}
							>
								<span className="mb-1 flex size-11 items-center justify-center rounded-control bg-info text-action">
									<Icon name="image" />
								</span>
								<span className="text-body font-bold text-foreground">
									{t.upload}
								</span>
								<p className="text-caption text-muted">{t.dropHint}</p>
								<input
									className="mt-2 block min-h-11 w-full min-w-0 max-w-full text-base file:me-2 file:min-h-11"
									id="catalogue-file"
									type="file"
									accept="image/jpeg,image/png,image/webp"
									onChange={fileChanged}
								/>
							</label>
							{body.images.length ? (
								<div className="mt-4 grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2">
									{body.images.map((image, index) => (
										<div
											key={image.id}
											className="min-w-0 space-y-3 rounded-card border border-border bg-page p-3"
										>
											<div className="flex min-w-0 items-center gap-3">
												<span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-border bg-surface">
													{staged(image.id) ? (
														<Image
															unoptimized
															loading="lazy"
															className="h-full w-full object-contain"
															src={
																apiOrigin(process.env.NEXT_PUBLIC_API_URL) +
																staged(image.id)?.url
															}
															alt=""
															width={64}
															height={64}
														/>
													) : (
														<Icon name="image" className="size-6 text-muted" />
													)}
												</span>
												<p className="min-w-0 text-sm font-bold text-foreground wrap-anywhere">
													{index === 0
														? t.cover
														: `${t.imageLabel} ${index + 1}`}
												</p>
											</div>
											<Control
												path={`body.images.${index}.alt`}
												label={t.alt}
												maxLength={200}
												hint={t.plainText}
												value={image.alt}
												onChange={(alt) =>
													update({
														images: body.images.map((ref) =>
															ref.id === image.id ? { ...ref, alt } : ref,
														),
													})
												}
											/>
											<Control
												path={`body.images.${index}.variant`}
												label={s.options}
												value={image.variant ?? ""}
												options={[
													{ value: "", label: s.allOptions },
													...body.variants
														.filter((v) => v.id)
														.map((v) => ({
															value: v.id as string,
															label: v.sku,
														})),
												]}
												onChange={(variant) =>
													update({
														images: body.images.map((ref) =>
															ref.id === image.id
																? { ...ref, variant: variant || null }
																: ref,
														),
													})
												}
											/>
											<div className="flex flex-wrap gap-3">
												{index > 0 && (
													<Button
														variant="secondary"
														onClick={() =>
															update({
																images: [
																	image,
																	...body.images.filter(
																		(ref) => ref.id !== image.id,
																	),
																],
															})
														}
													>
														{t.cover}
													</Button>
												)}
												<Button
													variant="secondary"
													disabled={index === 0}
													onClick={() => {
														const images = [...body.images];
														[images[index - 1], images[index]] = [
															images[index],
															images[index - 1],
														];
														update({ images });
													}}
												>
													{t.up}
												</Button>
												<Button
													variant="secondary"
													onClick={() =>
														update({
															images: body.images.filter(
																(ref) => ref.id !== image.id,
															),
														})
													}
												>
													{t.remove}
												</Button>
											</div>
										</div>
									))}
								</div>
							) : (
								<EmptyState
									className="mt-4"
									borderless
									icon="image"
									title={t.noImages}
									description={t.noImagesHelp}
								/>
							)}
							<div className="mt-5 space-y-3 border-t border-border pt-4">
								<h3 className="text-body font-semibold text-foreground">
									{s.readyPhotos}
								</h3>
								<p className="text-caption text-muted">{s.photoLimit}</p>
								{availableImages.length ? (
									<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
										{availableImages.map((image, index) => (
											<div
												key={image.id}
												className="min-w-0 space-y-2 rounded-card border border-border bg-page p-3"
											>
												<div className="flex h-32 items-center justify-center overflow-hidden rounded-control bg-surface">
													<Image
														unoptimized
														loading="lazy"
														className="h-full w-full object-contain"
														src={
															apiOrigin(process.env.NEXT_PUBLIC_API_URL) +
															image.url
														}
														alt={`${t.imageLabel} ${index + 1}`}
														width={image.width}
														height={image.height}
													/>
												</div>
												<p className="text-caption text-muted">
													<bdi dir="ltr">
														{image.width} × {image.height}
													</bdi>
												</p>
												<Button
													variant="secondary"
													className="w-full"
													disabled={busy || body.images.length >= 12}
													aria-label={`${s.attachPhoto} · ${t.imageLabel} ${index + 1}`}
													onClick={() => {
														if (
															!busy &&
															body.images.length < 12 &&
															!body.images.some((ref) => ref.id === image.id)
														) {
															update({
																images: [
																	...body.images,
																	{ id: image.id, alt: "", variant: null },
																],
															});
														}
													}}
												>
													{s.attachPhoto}
												</Button>
											</div>
										))}
									</div>
								) : (
									<p className="text-caption text-muted">{s.noStaged}</p>
								)}
							</div>
						</SectionCard>
					</div>
				</fieldset>
			</form>

			<div hidden={step !== 2} className="space-y-5">
				{prices}
			</div>
			{step === 3 && (
				<p className="rounded-2xl bg-info/60 p-4 text-sm leading-relaxed text-muted">
					{flow.submitHelp}
				</p>
			)}
			<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 pb-5">
				<Button
					variant="secondary"
					className="mt-0!"
					disabled={busy || step === 1}
					onClick={() => changeStep(step - 1)}
				>
					<Icon name="arrow" className="size-4 rotate-180 rtl:rotate-0" />
					{flow.previous}
				</Button>
				<div className="flex flex-wrap gap-3">
					{onReload && (
						<Button
							className="mt-0!"
							variant="secondary"
							disabled={busy}
							onClick={onReload}
						>
							{t.reload}
						</Button>
					)}
					<Button
						className="mt-0!"
						variant="secondary"
						form="product-source-form"
						type="submit"
						disabled={busy || !dirty}
					>
						{s.saveDraft}
					</Button>
					{step < 3 ? (
						<Button
							className="mt-0!"
							disabled={busy}
							onClick={() => changeStep(step + 1)}
						>
							{flow.next}
							<Icon name="arrow" className="size-4 rtl:rotate-180" />
						</Button>
					) : (
						<Button
							className="mt-0!"
							disabled={busy || !canSubmit}
							onClick={onSubmit}
						>
							{flow.submit}
						</Button>
					)}
				</div>
			</footer>
		</div>
	);
}
