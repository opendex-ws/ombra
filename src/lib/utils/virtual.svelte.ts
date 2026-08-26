// Windowed list state for high-churn feeds.
//
// Rendering a whole feed means Svelte keeps mutating the DOM of rows nobody can
// see: `content-visibility` skips their paint, but not their effects, props or
// style work. These lists mount only the rows in view (plus an overscan buffer).
//
// Two modes:
//   • fixed    — every row is the same height (memescope cards, scanner rows).
//                Set `count`; offsets are pure arithmetic, nothing is measured.
//   • measured — rows vary (watchlist calls: wallet rows carry an extra line).
//                Set `keys` to the ordered row ids and attach
//                `use:vl.measureRow={id}`. Heights are stored per ID, never per
//                index, because these feeds PREPEND — index-keyed measurements
//                would be attributed to the wrong row after every new item.

export type VirtualListOptions = {
	/** Row height (fixed mode) or starting guess per row (measured mode). */
	estimate: number;
	/** Gap between rows, in px. Included in every row's stride. */
	gap?: number;
	/** Extra rows rendered above and below the viewport. */
	overscan?: number;
	/** Measure rendered rows instead of trusting `estimate`. */
	measured?: boolean;
};

export class VirtualList {
	#estimate: number;
	#gap: number;
	#overscan: number;
	#measured: boolean;

	/** Heights reported by rendered rows, keyed by row id (measured mode). */
	#heights = new Map<string, number>();
	/** Bumped when a measurement changes, to invalidate the offset table. */
	#measureVersion = $state(0);
	#scrollPending = false;

	/** Row count (fixed mode). */
	count = $state(0);
	/** Ordered row ids (measured mode). */
	keys = $state<string[]>([]);

	scrollTop = $state(0);
	viewport = $state(0);

	constructor(options: VirtualListOptions) {
		this.#estimate = options.estimate;
		this.#gap = options.gap ?? 0;
		this.#overscan = options.overscan ?? 4;
		this.#measured = options.measured ?? false;
	}

	/** Row stride in fixed mode. */
	get stride(): number {
		return this.#estimate + this.#gap;
	}

	get length(): number {
		return this.#measured ? this.keys.length : this.count;
	}

	/** Cumulative offset table; `offsets[i]` is the top of row `i`. */
	#offsets = $derived.by(() => {
		if (!this.#measured) return null;
		void this.#measureVersion;
		const keys = this.keys;
		const out = new Float64Array(keys.length + 1);
		for (let i = 0; i < keys.length; i++) {
			out[i + 1] = out[i] + (this.#heights.get(keys[i]) ?? this.#estimate) + this.#gap;
		}
		return out;
	});

	get totalHeight(): number {
		const offsets = this.#offsets;
		if (offsets) return Math.max(0, offsets[this.keys.length] - this.#gap);
		return Math.max(0, this.count * this.stride - this.#gap);
	}

	offsetOf(index: number): number {
		const offsets = this.#offsets;
		if (offsets) return offsets[Math.min(Math.max(index, 0), this.keys.length)];
		return index * this.stride;
	}

	/** First row whose bottom sits below `top`. */
	#indexAt(top: number): number {
		const offsets = this.#offsets;
		if (!offsets) return Math.floor(top / this.stride);
		let lo = 0;
		let hi = this.keys.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (offsets[mid + 1] <= top) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	start = $derived.by(() => {
		if (this.length === 0) return 0;
		return Math.max(0, this.#indexAt(this.scrollTop) - this.#overscan);
	});

	end = $derived.by(() => {
		if (this.length === 0) return 0;
		// A container that hasn't been laid out yet (or a mis-wired `viewport_`)
		// reports 0, which would pin the window to a handful of rows and look like
		// the list is broken. Fall back to a generous height so the failure mode is
		// "renders too much" rather than "renders almost nothing".
		const height = this.viewport > 0 ? this.viewport : 900;
		const last = this.#indexAt(this.scrollTop + height) + 1 + this.#overscan;
		return Math.min(this.length, Math.max(last, this.start + 1));
	});

	/** rAF-throttled: `onscroll={(e) => vl.handleScroll(e.currentTarget)}` */
	handleScroll(el: HTMLElement) {
		if (this.#scrollPending) return;
		this.#scrollPending = true;
		requestAnimationFrame(() => {
			this.#scrollPending = false;
			this.scrollTop = el.scrollTop;
			this.viewport = el.clientHeight;
		});
	}

	/**
	 * `use:vl.viewport_` on the scroll container — seeds the viewport height and
	 * keeps it correct when the container is resized (the X Feed overlay can be
	 * dragged, mobile sheets open, panes collapse).
	 */
	viewport_ = (node: HTMLElement) => {
		const sync = () => {
			this.viewport = node.clientHeight;
			this.scrollTop = node.scrollTop;
		};
		sync();
		const ro = new ResizeObserver(sync);
		ro.observe(node);
		return {
			destroy() {
				ro.disconnect();
			}
		};
	};

	/** `use:vl.measureRow={id}` — measured mode only; no-op when fixed. */
	measureRow = (node: HTMLElement, key: string) => {
		if (!this.#measured) return {};
		let current = key;
		const record = () => {
			const h = node.offsetHeight;
			if (h > 0 && this.#heights.get(current) !== h) {
				this.#heights.set(current, h);
				this.#measureVersion++;
			}
		};
		record();
		const ro = new ResizeObserver(record);
		ro.observe(node);
		return {
			update: (next: string) => {
				current = next;
				record();
			},
			destroy() {
				ro.disconnect();
			}
		};
	};

	/** Drop measurements when the list identity changes (tab/filter switch). */
	reset() {
		this.#heights.clear();
		this.#measureVersion++;
		this.scrollTop = 0;
	}
}
