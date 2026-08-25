// Mandalart's DataStore Preferences file wraps one big JSON string inside a
// small protobuf envelope. Rather than depending on a protobuf library for a
// one-off extraction, this scans the raw bytes for the longest balanced-brace
// run that parses as valid JSON, which is exactly the encoded snapshot string.
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Usage: node extract-snapshot-from-datastore.js <input.preferences_pb> <output.json>');
  process.exit(1);
}

const buf = await readFile(inputPath);
const text = buf.toString('utf-8');

let best = null;
for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
  if (best && start < best.start + best.text.length) continue; // inside an already-found blob
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        try {
          JSON.parse(candidate);
          if (!best || candidate.length > best.text.length) best = { start, text: candidate };
        } catch {
          // not valid JSON at this boundary, keep scanning
        }
        break;
      }
    }
  }
}

if (!best) {
  console.error('No valid JSON object found in the file.');
  process.exit(1);
}

await writeFile(outputPath, best.text, 'utf-8');
console.log(`Extracted ${best.text.length} bytes of JSON to ${outputPath}`);
