/**
 * The three constructors every answer composer uses: a section, an empty
 * note, a typed item with its nature and the record ids it rests on.
 */

import type { JarvisItem, JarvisSection, NoteKind, SectionKey } from './answer'

export function section(key: SectionKey, items: JarvisItem[]): JarvisSection {
  return { key, items }
}

export function note(kind: NoteKind): JarvisItem {
  return { kind: 'note', note: kind, nature: 'fact', sourceIds: [] }
}

/** A typed item with its nature and sources; the shape is the union's, checked at the call. */
export function item<K extends JarvisItem['kind']>(
  kind: K,
  fields: Omit<Extract<JarvisItem, { kind: K }>, 'kind' | 'nature' | 'sourceIds'>,
  nature: JarvisItem['nature'],
  sourceIds: readonly string[],
): JarvisItem {
  return { kind, ...fields, nature, sourceIds } as unknown as JarvisItem
}
