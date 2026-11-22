'use strict';

const normalize = text => text.replace(/\r\n/g, '\n');

function prepareHunks(text, edits, range) {
  if (!Array.isArray(edits) || !edits.length || edits.length > 12) {
    throw new Error('Provide between 1 and 12 replacements.');
  }
  const [lower, upper] = range ?? [0, text.length];
  const hunks = edits.map(({ old_text, new_text }, id) => {
    if (typeof old_text !== 'string' || !old_text || typeof new_text !== 'string'
        || old_text.length + new_text.length > 30000) {
      throw new Error('Each replacement needs an exact nonempty anchor and replacement text.');
    }
    const before = normalize(old_text);
    const after = normalize(new_text);
    const start = text.indexOf(before, lower);
    const end = start + before.length;
    const duplicate = text.indexOf(before, start + 1);
    if (start < lower || end > upper || (duplicate >= 0 && duplicate + before.length <= upper)) {
      throw new Error('The anchor is missing or ambiguous. Read the latest text and provide a unique anchor.');
    }
    if (before === after) throw new Error('The replacement has no changes.');
    return { id, start, end, line: text.slice(0, start).split('\n').length, before, after };
  }).sort((a, b) => a.start - b.start);
  if (hunks.some((hunk, i) => i > 0 && hunk.start < hunks[i - 1].end)) {
    throw new Error('Replacements overlap.');
  }
  return hunks;
}

function materialize(text, hunks) {
  for (const { start, end, after } of [...hunks].reverse()) {
    text = text.slice(0, start) + after + text.slice(end);
  }
  return text;
}

module.exports = { normalize, prepareHunks, materialize };
