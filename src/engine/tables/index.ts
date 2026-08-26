/**
 * Which boards exist, and how to build one.
 *
 * The registry is deliberately the only place that knows the full list. The
 * game takes an id, the page takes an id, the tests loop over `TABLE_IDS`, and
 * adding a third board is one import and one line here rather than a search for
 * everywhere the second one was special-cased.
 *
 * It lives here rather than in `../table.ts` so the dependency runs one way:
 * each board imports the shared parts, and only this file imports the boards.
 * The other arrangement is a cycle, and a cycle between a type module and the
 * data that implements it is the kind of thing that works until the day the
 * bundler changes.
 */

import type { Table, TableId } from '../table.js';
import { buildSiege } from './siege.js';

export interface TableEntry {
  readonly id: TableId;
  /** The wordmark, as it goes on the cabinet. */
  readonly name: string;
  readonly build: () => Table;
}

export const TABLES: readonly TableEntry[] = [
  { id: 'siege', name: 'SIEGE', build: buildSiege },
];

export const TABLE_IDS: readonly TableId[] = TABLES.map((t) => t.id);

export const DEFAULT_TABLE: TableId = 'siege';

export function tableEntry(id: TableId): TableEntry {
  const found = TABLES.find((t) => t.id === id);
  if (!found) throw new Error(`no such table: ${id}`);
  return found;
}

/** Build a fresh copy of a board. Never share one: colliders carry mutable state. */
export function buildTable(id: TableId = DEFAULT_TABLE): Table {
  return tableEntry(id).build();
}
