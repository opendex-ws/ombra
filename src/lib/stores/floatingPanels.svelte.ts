const BASE_Z = 150;

let counter = $state(0);
let zMap = $state<Record<string, number>>({});

export function bringToFront(id: string) {
	counter += 1;
	zMap[id] = counter;
}

export function getPanelZ(id: string): number {
	return BASE_Z + (zMap[id] ?? 0);
}

export function ensurePanel(id: string) {
	if (!(id in zMap)) {
		counter += 1;
		zMap[id] = counter;
	}
}

export function dropPanel(id: string) {
	if (id in zMap) {
		const next = { ...zMap };
		delete next[id];
		zMap = next;
	}
}
