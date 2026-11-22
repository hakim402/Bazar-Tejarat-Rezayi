"use strict";

(() => {
    const form = document.getElementById("commerce-period");
    if (form) {
        const preset = form.querySelector("#commerce-preset");
        const start = form.elements.namedItem("start");
        const end = form.elements.namedItem("end");
        form.querySelector("[data-period-control]").hidden = false;
        preset.addEventListener("change", () => {
            const option = preset.selectedOptions[0];
            if (option.dataset.start) {
                start.value = option.dataset.start;
                end.value = option.dataset.end;
            }
        });
        for (const input of [start, end]) {
            input.addEventListener("change", () => { preset.value = ""; });
        }
    }

    const exportMenu = document.querySelector("[data-commerce-export]");
    exportMenu?.addEventListener("keydown", event => {
        if (event.key === "Escape" && exportMenu.open) {
            event.preventDefault();
            exportMenu.open = false;
            exportMenu.querySelector("summary").focus();
        }
    });

    const chartRoot = document.getElementById("commerce-chart");
    if (!chartRoot) return;
    const data = JSON.parse(document.getElementById("commerce-trend-data").textContent);
    // Exact amounts stay on the server-rendered table. The chart uses numbers only for plotting.
    const current = data.current.map(Number);
    const previous = data.previous.map(Number);
    if (![...current, ...previous].some(Boolean)) {
        chartRoot.querySelector("[data-chart-empty]").hidden = false;
        return;
    }
    if (!window.Chart) return;

    const container = chartRoot.querySelector("[data-chart-container]");
    const locale = document.documentElement.lang || "en";
    const currency = chartRoot.dataset.currency;
    const date = new Intl.DateTimeFormat(locale, {calendar:"gregory", month:"short", day:"numeric", timeZone:"Asia/Kabul"});
    const format = new Intl.NumberFormat(locale, {style:"currency", currency, currencyDisplay:"code", maximumFractionDigits:2, minimumFractionDigits:0});
    const compact = new Intl.NumberFormat(locale, {notation:"compact", maximumFractionDigits:1});
    const labels = data.dates.map(day => date.format(new Date(day + "T12:00:00Z")));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const style = name => getComputedStyle(chartRoot.querySelector(`[data-chart-color="${name}"]`));

    function palette() {
        const surface = style("surface");
        return {
            current: style("current").color,
            previous: style("previous").color,
            surface: surface.backgroundColor,
            line: surface.borderTopColor,
            tint: style("tint").backgroundColor,
            ink: getComputedStyle(chartRoot).color,
        };
    }

    function datasets(colors) {
        const points = {pointRadius: current.length === 1 ? 3 : 0, pointHoverRadius: 4, borderWidth: 2};
        return [
            {...points, label: chartRoot.dataset.current, data: current, borderColor: colors.current, backgroundColor: colors.tint, fill: true},
            {...points, label: chartRoot.dataset.previous, data: previous, borderColor: colors.previous, borderDash: [5, 5]},
        ];
    }

    function options(colors) {
        const ticks = {color: colors.previous, maxTicksLimit: 6};
        return {
            locale, responsive: true, maintainAspectRatio: false,
            animation: reducedMotion.matches ? false : {duration: 170},
            interaction: {mode: "index", intersect: false},
            plugins: {
                legend: {display: false},
                tooltip: {
                    backgroundColor: colors.surface,
                    titleColor: colors.ink,
                    bodyColor: colors.ink,
                    borderColor: colors.line,
                    borderWidth: 1,
                    callbacks: {label: item => `${item.dataset.label}: ${format.format(item.parsed.y)}`},
                },
            },
            scales: {
                x: {ticks: {...ticks, maxRotation: 0}, grid: {display: false}},
                y: {beginAtZero: true, ticks: {...ticks, callback: value => compact.format(value)}, grid: {color: colors.line}},
            },
        };
    }

    const colors = palette();
    container.hidden = false;
    const chart = new window.Chart(container.querySelector("canvas"), {
        type: "line",
        data: {labels, datasets: datasets(colors)},
        options: options(colors),
    });

    function refresh() {
        const next = palette();
        chart.data.datasets = datasets(next);
        chart.options = options(next);
        chart.update("none");
    }

    new MutationObserver(refresh).observe(document.documentElement, {attributes: true, attributeFilter: ["class"]});
    reducedMotion.addEventListener("change", refresh);
})();
