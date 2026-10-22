import { createDefaultSRSData } from './srs.js';

export function parseCSV(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes('\t') ? '\t' : ',';

  function parseLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rows = lines.map(parseLine);
  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
  const isHeader = header.some(h => ['word', 'meaning', 'tanngo', 'imi', '単語', '意味'].includes(h));

  let startIndex = 0;
  let colMap = { word: 0, meaning: 1, phonetic: -1, example: -1, exampleJa: -1, category: -1 };

  if (isHeader) {
    startIndex = 1;
    header.forEach((h, idx) => {
      if (h.includes('word') || h.includes('単語')) colMap.word = idx;
      else if (h.includes('mean') || h.includes('訳') || h.includes('意味')) colMap.meaning = idx;
      else if (h.includes('phone') || h.includes('発音')) colMap.phonetic = idx;
      else if (h.includes('exampleja') || h.includes('例文訳') || h.includes('和訳')) colMap.exampleJa = idx;
      else if (h.includes('examp') || h.includes('例文')) colMap.example = idx;
      else if (h.includes('cat') || h.includes('tag') || h.includes('カテゴリ')) colMap.category = idx;
    });
  } else {
    colMap = { word: 0, meaning: 1, phonetic: 2, example: 3, exampleJa: 4, category: 5 };
  }

  const parsedWords = [];
  for (let i = startIndex; i < rows.length; i++) {
    const r = rows[i];
    const wordStr = (r[colMap.word] || '').trim();
    const meaningStr = (r[colMap.meaning] || '').trim();

    if (!wordStr || !meaningStr) continue;

    parsedWords.push({
      word: wordStr,
      meaning: meaningStr,
      phonetic: colMap.phonetic >= 0 ? (r[colMap.phonetic] || '').trim() : '',
      example: colMap.example >= 0 ? (r[colMap.example] || '').trim() : '',
      exampleJa: colMap.exampleJa >= 0 ? (r[colMap.exampleJa] || '').trim() : '',
      category: colMap.category >= 0 ? (r[colMap.category] || 'General').trim() : 'General',
      srs: createDefaultSRSData(),
      createdAt: Date.now()
    });
  }

  return parsedWords;
}

export function exportWordsToCSV(words) {
  const header = ['Word', 'Meaning', 'Phonetic', 'Example', 'ExampleTranslation', 'Category', 'Interval', 'EaseFactor', 'State', 'DueDate'];
  const lines = [header.join(',')];

  for (const w of words) {
    const srs = w.srs || {};
    const dueStr = srs.dueDate ? new Date(srs.dueDate).toISOString().split('T')[0] : '';
    const cols = [
      escapeCSV(w.word),
      escapeCSV(w.meaning),
      escapeCSV(w.phonetic || ''),
      escapeCSV(w.example || ''),
      escapeCSV(w.exampleJa || ''),
      escapeCSV(w.category || 'General'),
      srs.interval || 0,
      srs.easeFactor || 2.5,
      srs.state || 'new',
      dueStr
    ];
    lines.push(cols.join(','));
  }

  return lines.join('\r\n');
}

export function exportWordsToJSON(words) {
  return JSON.stringify(words, null, 2);
}

function escapeCSV(str) {
  if (typeof str !== 'string') return `"${str}"`;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
