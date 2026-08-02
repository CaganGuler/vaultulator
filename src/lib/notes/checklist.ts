/**
 * Checklists inside a note body.
 *
 * A markdown convention (`- [ ]` / `- [x]`) rather than a structured format:
 * the body stays an opaque string, so nothing about encryption, the schema or
 * the migration story changes. A note written elsewhere as plain text still
 * reads correctly, and a checklist degrades to legible text if this ever goes
 * away.
 */

const LINE = /^(\s*)- \[( |x|X)\] ?(.*)$/;

export interface ChecklistLine {
  index: number;
  checked: boolean;
  text: string;
}

/** Every checklist line in the body, with its line index. */
export function parseChecklist(body: string): ChecklistLine[] {
  return body.split('\n').flatMap((line, index) => {
    const match = LINE.exec(line);
    if (!match) return [];
    return [{ index, checked: match[2]!.toLowerCase() === 'x', text: match[3] ?? '' }];
  });
}

export function hasChecklist(body: string): boolean {
  return body.split('\n').some((line) => LINE.test(line));
}

/** Flips one line's checkbox, leaving indentation and everything else intact. */
export function toggleChecklistLine(body: string, lineIndex: number): string {
  const lines = body.split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return body;
  const match = LINE.exec(line);
  if (!match) return body;
  const [, indent = '', mark = ' ', text = ''] = match;
  lines[lineIndex] = `${indent}- [${mark.toLowerCase() === 'x' ? ' ' : 'x'}] ${text}`;
  return lines.join('\n');
}

/** Appends an empty checklist item, for the editor's toolbar button. */
export function appendChecklistItem(body: string): string {
  const needsNewline = body.length > 0 && !body.endsWith('\n');
  return `${body}${needsNewline ? '\n' : ''}- [ ] `;
}

export type BodyLine =
  | { kind: 'check'; index: number; checked: boolean; text: string }
  | { kind: 'text'; index: number; text: string };

/**
 * Every line of the body, checklist items tagged. The editor's list mode shows
 * the surrounding prose too, so ticking an item off never hides context.
 */
export function splitBodyLines(body: string): BodyLine[] {
  return body.split('\n').map((line, index) => {
    const match = LINE.exec(line);
    if (!match) return { kind: 'text', index, text: line };
    return { kind: 'check', index, checked: match[2]!.toLowerCase() === 'x', text: match[3] ?? '' };
  });
}

/** Progress summary for the notes list, or null when there is no checklist. */
export function checklistProgress(body: string): { done: number; total: number } | null {
  const lines = parseChecklist(body);
  if (lines.length === 0) return null;
  return { done: lines.filter((line) => line.checked).length, total: lines.length };
}
