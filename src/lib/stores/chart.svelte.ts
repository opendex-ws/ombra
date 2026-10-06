import { getShowMarketCap as readShowMarketCap, setShowMarketCap as writeShowMarketCap } from './feSettings.svelte';

let selectedFrame = $state('1s');
let liveAthPrice = $state(0);

export function getSelectedFrame() { return selectedFrame; }
export function setSelectedFrame(v: string) { selectedFrame = v; }
export function getShowMarketCap() { return readShowMarketCap(); }
export function setShowMarketCap(v: boolean) { writeShowMarketCap(v); }
export function getLiveAthPrice() { return liveAthPrice; }
export function setLiveAthPrice(v: number) { liveAthPrice = v; }
