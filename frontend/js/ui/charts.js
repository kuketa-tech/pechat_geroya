// Обёртки над Chart.js в цветах текущей темы.

import { cssVar } from '../core/utils.js';

export const chartsAvailable = () => typeof window.Chart !== 'undefined';

export function palette() {
  return {
    text: cssVar('--text'),
    text2: cssVar('--text-2'),
    text3: cssVar('--text-3'),
    grid: cssVar('--border'),
    surface: cssVar('--surface'),
    surface3: cssVar('--surface-3'),
    accent: cssVar('--accent'),
    gold: cssVar('--accent-2'),
    ok: cssVar('--ok'),
    info: cssVar('--info'),
    err: cssVar('--err'),
    epic: cssVar('--rar-epic'),
  };
}

export function alpha(hex, a) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

export function baseOptions(p, { unit = '', suggestedMin, suggestedMax, compact = false, stacked = false } = {}) {
  const font = { family: "'Manrope', system-ui, sans-serif", size: 11.5, weight: 600 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 700, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 6, right: 4 } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: p.surface3,
        borderColor: p.grid,
        borderWidth: 1,
        titleColor: p.text,
        bodyColor: p.text2,
        titleFont: { ...font, size: 12.5, weight: 800 },
        bodyFont: font,
        padding: 12,
        cornerRadius: 12,
        boxPadding: 5,
        usePointStyle: true,
        callbacks: {
          label: (ctx) => (ctx.parsed.y == null ? null : ` ${ctx.dataset.label}: ${String(ctx.parsed.y).replace('.', ',')}${unit}`),
        },
      },
    },
    scales: {
      x: {
        stacked,
        display: !compact,
        grid: { display: false },
        border: { display: false },
        ticks: { color: p.text3, font, maxRotation: 0, autoSkipPadding: 14 },
      },
      y: {
        stacked,
        display: !compact,
        suggestedMin,
        suggestedMax,
        grid: { color: alpha(p.grid, 0.9), drawTicks: false },
        border: { display: false },
        ticks: { color: p.text3, font, padding: 10, maxTicksLimit: 5 },
      },
    },
  };
}

/**
 * datasets: [{ label, data, color: 'accent'|'ok'|..., fill?, dash?, points? }]
 */
export function lineChart(canvas, { labels, datasets, ...opts }) {
  if (!chartsAvailable() || !canvas) return null;
  const p = palette();
  const ctx = canvas.getContext('2d');
  const h = canvas.parentElement?.clientHeight || 260;
  const data = {
    labels,
    datasets: datasets.map((d) => {
      const color = p[d.color] || d.color;
      let bg = 'transparent';
      if (d.fill) {
        bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, alpha(color, 0.3));
        bg.addColorStop(1, alpha(color, 0));
      }
      return {
        label: d.label,
        data: d.data,
        borderColor: color,
        backgroundColor: bg,
        fill: !!d.fill,
        tension: 0.38,
        borderWidth: d.width || 2.5,
        borderDash: d.dash || [],
        pointRadius: d.points ?? 0,
        pointHoverRadius: 5,
        pointBackgroundColor: color,
        pointBorderColor: p.surface,
        pointBorderWidth: 2,
        spanGaps: true,
      };
    }),
  };
  return new window.Chart(canvas, { type: 'line', data, options: baseOptions(p, opts) });
}

export function barChart(canvas, { labels, datasets, ...opts }) {
  if (!chartsAvailable() || !canvas) return null;
  const p = palette();
  const data = {
    labels,
    datasets: datasets.map((d) => {
      const color = p[d.color] || d.color;
      return {
        label: d.label,
        data: d.data,
        backgroundColor: alpha(color, 0.85),
        hoverBackgroundColor: color,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 22,
      };
    }),
  };
  return new window.Chart(canvas, { type: 'bar', data, options: baseOptions(p, opts) });
}
