let selectedFrame = $state('1s');
let showMarketCap = $state(false);
let liveAthPrice = $state(0);

export function getSelectedFrame() { return selectedFrame; }
export function setSelectedFrame(v: string) { selectedFrame = v; }
export function getShowMarketCap() { return showMarketCap; }
export function setShowMarketCap(v: boolean) { showMarketCap = v; }
export function getLiveAthPrice() { return liveAthPrice; }
export function setLiveAthPrice(v: number) { liveAthPrice = v; }
