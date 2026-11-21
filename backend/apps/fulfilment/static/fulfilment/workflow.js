"use strict";
(() => {
  const form = document.querySelector("[data-fulfilment-form]");
  if (!form) return;
  const action = form.querySelector('[name="action"]');
  const actionFields = {
    case_assign: ["assigned_to"], case_clear: ["disposition"],
    arrange: ["provider", "arranger", "self_delivery", "instructions"], charge: ["amount"],
    tracking: ["occurred_at", "reference"], deliver: ["occurred_at"], blocker: ["kind"],
  };
  function showActionFields() {
    const fields = new Set(["action", "reason", ...(actionFields[action?.value] || [])]);
    for (const element of form.children) {
      if (element.hasAttribute("data-action-field")) {
        element.hidden = !fields.has(element.dataset.actionField) && !element.hasAttribute("data-has-errors");
      }
    }
    const stockRows = form.querySelector("[data-stock-rows]");
    if (stockRows) stockRows.hidden = action?.value !== "prepare" && !stockRows.hasAttribute("data-has-errors");
  }
  action?.addEventListener("change", showActionFields);
  showActionFields();
  let dirty = false;
  form.addEventListener("input", () => { dirty = true; });
  form.addEventListener("change", () => { dirty = true; });
  form.addEventListener("submit", () => { dirty = false; });
  window.addEventListener("beforeunload", event => {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });
  const stock = form.querySelector("[data-stock-rows]");
  if (!stock) return;
  const forms = stock.querySelector("[data-stock-forms]");
  const total = stock.querySelector('[name="stock-TOTAL_FORMS"]');
  stock.querySelector("[data-stock-add]").addEventListener("click", () => {
    const index = Number(total.value);
    if (index >= 100) return;
    const template = stock.querySelector("[data-stock-template]");
    const holder = document.createElement("template");
    holder.innerHTML = template.innerHTML.replaceAll("__prefix__", String(index));
    forms.append(holder.content.cloneNode(true));
    total.value = String(index + 1); dirty = true;
  });
  let page = 1, busy = false;
  const status = stock.querySelector("[data-stock-status]");
  function displayQuantity(value) {
    const text = String(value);
    return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
  }
  async function load(next) {
    if (busy) return;
    busy = true;
    const target = next ? page + 1 : 1;
    const url = new URL(stock.dataset.stockUrl, window.location.origin);
    url.searchParams.set("page", String(target));
    const query = stock.querySelector("[data-stock-search]").value.trim();
    if (query) url.searchParams.set("q", query);
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      for (const select of stock.querySelectorAll('select[name$="-bucket"]')) {
        const selected = select.selectedOptions[0];
        select.replaceChildren(new Option(stock.dataset.selectLabel, ""));
        if (selected?.value) select.add(new Option(selected.textContent, selected.value, true, true));
        for (const row of data.results) {
          if (row.bucket === selected?.value) continue;
          select.add(new Option(`${row.sku} · ${row.batch_code || stock.dataset.standardLabel} · ${row.expires_on || stock.dataset.expiryLabel} · ${stock.dataset.availableLabel} ${displayQuantity(row.available)}`, row.bucket));
        }
      }
      page = target;
      status.textContent = `${stock.dataset.pageLabel} ${data.page} · ${data.count} ${stock.dataset.countLabel}`;
    } catch {
      status.textContent = stock.dataset.unavailableLabel;
    } finally { busy = false; }
  }
  stock.querySelector("[data-stock-load]").addEventListener("click", () => load(false));
  stock.querySelector("[data-stock-next]").addEventListener("click", () => load(true));
})();
