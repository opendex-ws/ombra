import { expect, test } from 'vitest';
import { poolSafetyView } from '$lib/utils/pool-safety';
import cases from './cases/H4.json';
function check(group: number) {
 for (const c of cases.groups[group]) {
  const got=poolSafetyView(c.input as never);
  expect(got).toMatchObject(c.expect);
 }
}
test('h4_happy', () => check(0));
test('h4_negative_a', () => check(1));
test('h4_negative_b', () => check(2));
