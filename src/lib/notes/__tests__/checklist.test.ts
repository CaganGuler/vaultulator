import {
  appendChecklistItem,
  checklistProgress,
  hasChecklist,
  parseChecklist,
  splitBodyLines,
  toggleChecklistLine,
} from '../checklist';

describe('parseChecklist', () => {
  it('finds unchecked and checked items with their line indexes', () => {
    const body = 'Alışveriş\n- [ ] süt\n- [x] ekmek\nnot satırı\n- [X] peynir';
    expect(parseChecklist(body)).toEqual([
      { index: 1, checked: false, text: 'süt' },
      { index: 2, checked: true, text: 'ekmek' },
      { index: 4, checked: true, text: 'peynir' },
    ]);
  });

  it('accepts indented items and empty item text', () => {
    expect(parseChecklist('  - [ ] girintili\n- [ ]')).toEqual([
      { index: 0, checked: false, text: 'girintili' },
      { index: 1, checked: false, text: '' },
    ]);
  });

  it('ignores lines that only look like checklist items', () => {
    const body = '- [] eksik boşluk\n-[ ] eksik boşluk\n* [ ] yıldız\n- [y] geçersiz işaret';
    expect(parseChecklist(body)).toEqual([]);
    expect(hasChecklist(body)).toBe(false);
  });

  it('reports no checklist for an empty body', () => {
    expect(parseChecklist('')).toEqual([]);
    expect(checklistProgress('')).toBeNull();
  });
});

describe('toggleChecklistLine', () => {
  it('checks an unchecked item and leaves every other line alone', () => {
    const body = 'başlık\n- [ ] süt\n- [ ] ekmek';
    expect(toggleChecklistLine(body, 1)).toBe('başlık\n- [x] süt\n- [ ] ekmek');
  });

  it('unchecks a checked item, normalising an uppercase mark', () => {
    expect(toggleChecklistLine('- [X] süt', 0)).toBe('- [ ] süt');
  });

  it('preserves indentation', () => {
    expect(toggleChecklistLine('    - [ ] süt', 0)).toBe('    - [x] süt');
  });

  it('returns the body unchanged for a non-checklist or out-of-range line', () => {
    const body = 'düz metin\n- [ ] süt';
    expect(toggleChecklistLine(body, 0)).toBe(body);
    expect(toggleChecklistLine(body, 9)).toBe(body);
    expect(toggleChecklistLine(body, -1)).toBe(body);
  });

  // A note body is an opaque encrypted string; a toggle that dropped a trailing
  // blank line would silently rewrite content the user did not touch.
  it('keeps trailing empty lines', () => {
    expect(toggleChecklistLine('- [ ] süt\n\n', 0)).toBe('- [x] süt\n\n');
  });
});

describe('appendChecklistItem', () => {
  it('starts a checklist in an empty note without a leading newline', () => {
    expect(appendChecklistItem('')).toBe('- [ ] ');
  });

  it('adds a newline when the body does not end with one', () => {
    expect(appendChecklistItem('- [ ] süt')).toBe('- [ ] süt\n- [ ] ');
  });

  it('does not double the newline when the body already ends with one', () => {
    expect(appendChecklistItem('- [ ] süt\n')).toBe('- [ ] süt\n- [ ] ');
  });
});

describe('checklistProgress', () => {
  it('counts checked items', () => {
    expect(checklistProgress('- [x] a\n- [ ] b\n- [x] c')).toEqual({ done: 2, total: 3 });
  });
});

describe('splitBodyLines', () => {
  it('tags checklist lines and keeps the prose around them in order', () => {
    expect(splitBodyLines('Alışveriş\n- [ ] süt\n\n- [x] ekmek')).toEqual([
      { kind: 'text', index: 0, text: 'Alışveriş' },
      { kind: 'check', index: 1, checked: false, text: 'süt' },
      { kind: 'text', index: 2, text: '' },
      { kind: 'check', index: 3, checked: true, text: 'ekmek' },
    ]);
  });

  // The indexes it emits are fed straight back to toggleChecklistLine.
  it('emits indexes that address the same line in the original body', () => {
    const body = 'x\n- [ ] a\ny\n- [ ] b';
    for (const line of splitBodyLines(body).filter((l) => l.kind === 'check')) {
      expect(toggleChecklistLine(body, line.index).split('\n')[line.index]).toMatch(/- \[x\]/);
    }
  });
});
