export type SparklineData = {
	d: string;
	fillD: string;
	color: string;
	up: boolean;
	gradId: string;
	w: number;
	h: number;
};

export function buildSparkline(
	pts: { value: number }[] | undefined | null,
	w: number,
	h: number,
	gradPrefix: string
): SparklineData | null {
	if (!pts || pts.length < 2) return null;
	const vals = pts.map((p) => p.value).filter((v) => !isNaN(v));
	if (vals.length < 2) return null;
	const min = Math.min(...vals);
	const max = Math.max(...vals);
	const range = max - min || 1;
	const pad = 2;
	const step = w / (vals.length - 1);
	const points = vals.map((v, i) => {
		const x = i * step;
		const y = pad + (h - 2 * pad) - ((v - min) / range) * (h - 2 * pad);
		return [x, y] as [number, number];
	});
	let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
	for (let i = 1; i < points.length; i++) {
		const [px, py] = points[i - 1];
		const [cx, cy] = points[i];
		const cpx = (px + cx) / 2;
		d += ` C${cpx.toFixed(1)},${py.toFixed(1)} ${cpx.toFixed(1)},${cy.toFixed(1)} ${cx.toFixed(1)},${cy.toFixed(1)}`;
	}
	const last = points[points.length - 1];
	const fillD = d + ` L${last[0].toFixed(1)},${h} L0,${h} Z`;
	const up = vals[vals.length - 1] >= vals[0];
	const color = up ? 'var(--t-grn)' : 'var(--t-red)';
	const gradId = gradPrefix;
	return { d, fillD, color, up, gradId, w, h };
}
