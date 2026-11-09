import fs from 'node:fs';
import crypto from 'node:crypto';
import { expect, test } from 'vitest';
import { venueView } from '$lib/utils/venue-attribution';
import cases from './cases/F2.json';
function check(group: number) {
 for (const c of cases.groups[group]) {
  const got=venueView(c.input as never);
  expect(got).toMatchObject(c.expect);
 }
}
test('f2_happy', () => { check(0); assets(); });
test('f2_negative_a', () => check(1));
test('f2_negative_b', () => check(2));

function assets(){
 const rows=JSON.parse(fs.readFileSync('static/router-icons/rh-venues/provenance.json','utf8')).venues;
 expect(new Set(rows.map((x:{venue:string})=>x.venue))).toEqual(new Set(['LONG','BANKR','FLYWHEEL','AERO_SLIPSTREAM','METRIC_V1','RAMSES_CL','SUSHISWAP_V3','UP_SLIPSTREAM']));
 const official:Record<string,string[]>= {LONG:['long.xyz','app.long.xyz'],BANKR:['bankr.bot'],FLYWHEEL:['flywheel.cash'],AERO_SLIPSTREAM:['aero.xyz'],METRIC_V1:['app.metric.xyz','metric.xyz'],RAMSES_CL:['old.ramses.xyz','ramses.xyz','ramses.exchange'],SUSHISWAP_V3:['www.sushi.com','sushi.com'],UP_SLIPSTREAM:['up33.xyz']};
 for(const row of rows){
  if(row.status==='LOCAL'){
   expect(official[row.venue]).toContain(new URL(row.sourceUrl).hostname);
   const content=fs.readFileSync('static/router-icons/rh-venues/'+row.localFilename);
   expect(crypto.createHash('sha256').update(content).digest('hex')).toBe(row.sha256);
   expect(row.retrievedAt).toMatch(/^2026-/);expect(row.reviewedVariant.length).toBeGreaterThan(0);
   if(row.localFilename.endsWith('.svg'))expect(content.toString()).not.toMatch(/<script|onload=|javascript:|<foreignObject/i);
  }else{expect(row.status).toBe('TEXT_FALLBACK');expect(row.reason.length).toBeGreaterThan(0);expect(row.evidence.length).toBeGreaterThan(0);}
 }
}
