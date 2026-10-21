"use client";
import type { ChangeEvent } from "react";
import { Button } from "../../../components/ui/button";
import { Select } from "../../../components/ui/form-field";
import { catalogueCopy } from "../../../lib/i18n/catalogue";
import { locales, type Locale } from "../../../lib/i18n/locales";
import type { ProductBody, ProductDetail, Taxonomy } from "../types";
import { Control, Attributes } from "./catalogue-fields";
import { VariantEditor } from "./variant-editor";
export function ProductEditor({
	locale,
	body,
	item,
	taxonomy,
	busy,
	onChange,
	onSave,
	onUpload,
}: {
	locale: Locale;
	body: ProductBody;
	item: ProductDetail;
	taxonomy: Taxonomy;
	busy: boolean;
	onChange: (b: ProductBody) => void;
	onSave: () => void;
	onUpload: (file: File) => void;
}) {
	const t = catalogueCopy[locale];
	const category = taxonomy.categories.find((c) => c.code === body.category);
	const update = (values: Partial<ProductBody>) =>
		onChange({ ...body, ...values });
	function fileChanged(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (file) onUpload(file);
		e.target.value = "";
	}
	return (
		<form
			className="space-y-6"
			aria-busy={busy}
			onSubmit={(e) => {
				e.preventDefault();
				onSave();
			}}
			noValidate
		>
			<fieldset disabled={busy} className="space-y-5 min-w-0 border-0 p-0">
				<div className="grid gap-4 desktop:grid-cols-2">
					<Control
						path="body.title"
						label={t.productTitle}
						value={body.title}
						onChange={(title) => update({ title })}
					/>
					<Control
						path="body.brand"
						label={t.brand}
						value={body.brand}
						onChange={(brand) => update({ brand })}
					/>
					<Control
						path="body.locale"
						label={t.language}
						value={body.locale}
						options={locales.map((l) => ({ value: l, label: l }))}
						onChange={(l) => update({ locale: l as Locale })}
					/>
					<Control
						path="body.category"
						label={t.category}
						value={body.category}
						options={[
							{ value: "", label: "—" },
							...taxonomy.categories
								.filter((c) => c.active)
								.map((c) => ({ value: c.code, label: c.labels[locale] })),
						]}
						onChange={(code) => update({ category: code, attributes: {} })}
					/>
				</div>
				<Control
					path="body.description"
					label={t.description}
					textarea
					value={body.description}
					onChange={(description) => update({ description })}
				/>
				<h2 className="text-xl">{t.attributes}</h2>
				<Attributes
					fields={category?.attributes.filter((a) => !a.variant) ?? []}
					values={body.attributes}
					path="body.attributes"
					onChange={(attributes) => update({ attributes })}
				/>
				<VariantEditor
					locale={locale}
					variants={body.variants}
					category={category}
					taxonomy={taxonomy}
					onChange={(variants) => update({ variants })}
				/>
				<section className="space-y-4">
					<h2 className="text-xl">{t.images}</h2>
					<p className="text-muted">{t.imageRule}</p>
					<label className="block min-h-11 font-bold" htmlFor="catalogue-file">
						{t.upload}
					</label>
					<input
						className="block w-full min-w-0 max-w-full text-sm file:me-2 file:min-h-11"
						id="catalogue-file"
						type="file"
						accept="image/jpeg,image/png,image/webp"
						onChange={fileChanged}
					/>
					{body.images.map((image, index) => (
						<div
							key={image.id}
							className="rounded-control border border-border p-3 space-y-3"
						>
							<p>{index === 0 ? t.cover : index + 1}</p>
							<Control
								path={`body.images.${index}.alt`}
								label={t.alt}
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
								label={t.variants}
								value={image.variant ?? ""}
								options={[
									{ value: "", label: "—" },
									...body.variants
										.filter((v) => v.id)
										.map((v) => ({ value: v.id as string, label: v.sku })),
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
											images: body.images.filter((ref) => ref.id !== image.id),
										})
									}
								>
									{t.remove}
								</Button>
							</div>
						</div>
					))}
					<label htmlFor="catalogue-image-add">{t.imageSelect}</label>
					<Select
						id="catalogue-image-add"
						value=""
						disabled={body.images.length >= 12}
						onChange={(e) => {
							if (e.target.value)
								update({
									images: [
										...body.images,
										{ id: e.target.value, alt: "", variant: null },
									],
								});
						}}
					>
						<option value="">—</option>
						{item.images
							.filter((img) => !body.images.some((ref) => ref.id === img.id))
							.map((image, index) => (
								<option key={image.id} value={image.id}>
									{t.images} {index + 1} · {image.width} × {image.height}
								</option>
							))}
					</Select>
				</section>
				<Button type="submit" disabled={busy}>
					{t.save}
				</Button>
			</fieldset>
		</form>
	);
}
