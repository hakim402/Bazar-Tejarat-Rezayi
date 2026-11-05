"use strict";
(() => {
  const form = document.querySelector("[data-fulfilment-form]");
  if (!form) return;
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
        select.replaceChildren(new Option("Select stock bucket", ""));
        if (selected?.value) select.add(new Option(selected.textContent, selected.value, true, true));
        for (const row of data.results) {
          if (row.bucket === selected?.value) continue;
          select.add(new Option(`${row.sku} · ${row.batch_code || "Non-batch"} · ${row.expires_on || "No expiry"} · Available ${row.available}`, row.bucket));
        }
      }
      page = target;
      status.textContent = `Page ${data.page} · ${data.count} stock buckets. Current selections retained.`;
    } catch {
      status.textContent = "Stock options unavailable. Existing fields are retained; retry after checking access and connectivity.";
    } finally { busy = false; }
  }
  stock.querySelector("[data-stock-load]").addEventListener("click", () => load(false));
  stock.querySelector("[data-stock-next]").addEventListener("click", () => load(true));
})();
