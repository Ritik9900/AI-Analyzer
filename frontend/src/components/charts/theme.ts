// Validated chart palette (dataviz reference palette, checked against the white card surface):
//   categorical pair series1/series2 and diverging poles series1/negative pass CVD + contrast gates.
export const CHART = {
  series1: "#2a78d6", // blue — primary series / positive pole
  series1Light: "#86b6ef", // same hue, lighter step (second shade for before→after marks)
  series2: "#eb6834", // orange — second series
  negative: "#e34948", // red — negative pole of diverging scales
  context: "#898781", // de-emphasised comparison series (benchmark)
  grid: "#e7e5e4", // hairline gridlines
  axis: "#c3c2b7", // baselines
  mid: "#f0efec", // diverging midpoint ("nothing")
} as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Diverging colour for v in [-1, 1]: blue (−) ← grey (0) → red (+). */
export function divergingColor(v: number, negativePole: string = CHART.series1, positivePole: string = CHART.negative): string {
  const t = Math.min(1, Math.abs(v));
  const [a, b] = [hexToRgb(CHART.mid), hexToRgb(v >= 0 ? positivePole : negativePole)];
  const mix = a.map((c, i) => Math.round(c + (b[i] - c) * t));
  return `rgb(${mix.join(",")})`;
}

/** Ink that clears contrast on a given background colour ("rgb(r,g,b)" or "#rrggbb"). */
export function inkOn(color: string): string {
  const rgb = color.startsWith("#") ? hexToRgb(color) : (color.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  const lin = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return lum < 0.36 ? "#ffffff" : "#171717";
}
