// Checkpoints always end after a complete CSV record, including quoted newlines.
export async function* csvRecords(chunks, startByte = 0) {
  let quoted = false;
  let pieces = [];
  let offset = startByte;
  const decode = (bytes) => {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const row = [];
    let field = '', inside = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (inside && text[i + 1] === '"') { field += '"'; i++; }
        else inside = !inside;
      } else if (c === ',' && !inside) { row.push(field); field = ''; }
      else if (inside || (c !== '\r' && c !== '\n')) field += c;
    }
    row.push(field);
    return row;
  };
  const combine = () => {
    const bytes = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const piece of pieces) { bytes.set(piece, at); at += piece.length; }
    pieces = [];
    return bytes;
  };
  for await (const bytes of chunks) {
    let from = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 34) quoted = !quoted;
      if (bytes[i] === 10 && !quoted) {
        pieces.push(bytes.subarray(from, i + 1));
        yield { row: decode(combine()), nextByte: offset + i + 1 };
        from = i + 1;
      }
    }
    if (from < bytes.length) pieces.push(bytes.slice(from));
    offset += bytes.length;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field');
  if (pieces.length) yield { row: decode(combine()), nextByte: offset };
}
