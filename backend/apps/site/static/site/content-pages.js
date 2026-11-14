/* Content pages: Trix image uploads into the SiteMedia library and per-locale direction. */
(() => {
	"use strict";

	const rowOf = (editor) => editor.closest(".inline-related") || editor.closest("fieldset") || document;

	function applyDirection(editor) {
		const select = rowOf(editor).querySelector('select[name$="-locale"]');
		const code = select ? select.value : "";
		const dir = code === "en" ? "ltr" : "rtl";
		editor.setAttribute("dir", dir);
		editor.setAttribute("lang", code || "fa-AF");
		for (const field of rowOf(editor).querySelectorAll('input[name$="-title"], textarea[name$="-intro"], textarea[name$="-meta_description"]')) {
			field.setAttribute("dir", dir);
			field.setAttribute("lang", code || "fa-AF");
		}
	}

	function addImageButton(editor) {
		const toolbar = editor.toolbarElement;
		const url = editor.getAttribute("data-upload-url");
		if (!toolbar || !url || toolbar.querySelector("[data-content-image]")) return;
		const row = toolbar.firstElementChild;
		if (!row) return;
		const group = document.createElement("div");
		group.setAttribute("data-content-image", "");
		group.className = "bg-white border border-base-200 border-md flex flex-row rounded-default shadow-xs shrink-0 dark:bg-base-900 dark:border-base-700 dark:text-font-default-dark";
		const button = document.createElement("button");
		button.type = "button";
		button.tabIndex = -1;
		button.title = editor.getAttribute("data-image-label") || "Insert image";
		button.className = "cursor-pointer flex items-center h-8 justify-center w-8 hover:text-primary-600";
		const icon = document.createElement("span");
		icon.className = "material-symbols-outlined";
		icon.textContent = "image";
		button.appendChild(icon);
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/png,image/jpeg,image/webp";
		input.multiple = true;
		input.className = "hidden";
		button.addEventListener("click", () => input.click());
		input.addEventListener("change", () => {
			if (input.files && input.files.length) editor.insertFiles(input.files);
			input.value = "";
		});
		group.append(button, input);
		row.insertBefore(group, row.lastElementChild);
	}

	function wire(editor) {
		// Cloned inline rows keep the empty-form input id; rebind to this row's hidden input.
		const hidden = rowOf(editor).querySelector('input[type="hidden"][name$="-body"]');
		if (hidden && hidden.id && editor.getAttribute("input") !== hidden.id) {
			editor.setAttribute("input", hidden.id);
		}
		if (editor.dataset.contentPageWired) return;
		editor.dataset.contentPageWired = "1";
		applyDirection(editor);
		const select = rowOf(editor).querySelector('select[name$="-locale"]');
		if (select) select.addEventListener("change", () => applyDirection(editor));
	}

	document.addEventListener("trix-initialize", (event) => {
		wire(event.target);
		addImageButton(event.target);
	});

	document.addEventListener("trix-attachment-add", (event) => {
		const attachment = event.attachment;
		if (!attachment.file) return;
		const editor = event.target;
		const fail = () => {
			attachment.remove();
			window.alert(editor.getAttribute("data-image-error") || "The image could not be uploaded. Try again.");
		};
		const url = editor.getAttribute("data-upload-url");
		const token = editor.closest("form")?.querySelector("[name=csrfmiddlewaretoken]");
		if (!url || !token) return fail();
		const data = new FormData();
		data.append("file", attachment.file);
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url, true);
		xhr.setRequestHeader("X-CSRFToken", token.value);
		xhr.upload.addEventListener("progress", (progress) => {
			if (progress.lengthComputable) attachment.setUploadProgress(Math.round((progress.loaded / progress.total) * 100));
		});
		xhr.addEventListener("load", () => {
			if (xhr.status === 200) {
				try {
					const payload = JSON.parse(xhr.responseText);
					if (payload.url) {
						attachment.setAttributes({ url: payload.url, href: payload.url });
						return;
					}
				} catch {
					/* fall through to failure */
				}
			}
			fail();
		});
		xhr.addEventListener("error", fail);
		xhr.send(data);
	});

	const scan = () => {
		for (const editor of document.querySelectorAll("trix-editor")) {
			if (editor.toolbar) {
				wire(editor);
				addImageButton(editor);
			}
		}
	};
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
	else scan();
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				if (node.nodeType === 1 && (node.matches("trix-editor, .inline-related") || node.querySelector("trix-editor"))) {
					scan();
					return;
				}
			}
		}
	}).observe(document.documentElement, { childList: true, subtree: true });
})();