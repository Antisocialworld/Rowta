// markdown — the small, fixed-subset renderer the web build uses (ADR 0006).
// Sources are the author-controlled files in docs/legal/. Supported on purpose:
//   # ## ### #### headings (auto id slugs for anchors), paragraphs, - and 1. lists (no nesting),
//   | pipe tables, [links](url), **bold**, *em*, `code`, --- rules, and raw HTML lines (authors only).
// Anything else renders as plain text, so an unsupported construct can never inject markup (all text is
// escaped; only the constructs above produce tags, and raw lines are the authors' own).

const SLUG = (text) =>
  text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Inline: `code`, **bold**, *em*, [text](url). Input already escaped except the tag characters we add. */
export function inline(raw) {
  let out = escapeHtml(raw);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = /^(https:\/\/|mailto:|\/|#)/.test(href) ? href : '#';
    const external = /^https:\/\//.test(safe) ? ' rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(safe)}"${external}>${label}</a>`;
  });
  return out;
}

function tableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '');
}

export function renderMarkdown(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const html = [];
  let i = 0;
  let list = null; // 'ul' | 'ol' | null

  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      closeList();
      i += 1;
      continue;
    }

    // Raw HTML line (authors' own): pass through until the blank line.
    if (/^\s*</.test(line)) {
      closeList();
      while (i < lines.length && lines[i].trim() !== '') {
        html.push(lines[i]);
        i += 1;
      }
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const text = heading[2].trim();
      html.push(`<h${level} id="${SLUG(text)}">${inline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^---\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      i += 1;
      continue;
    }

    // Table: header row + separator row.
    if (/^\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s|:-]+\|\s*$/.test(lines[i + 1])) {
      closeList();
      const header = tableRow(line).split('|').map((cell) => inline(cell.trim()));
      html.push('<table><thead><tr>');
      for (const cell of header) html.push(`<th scope="col">${cell}</th>`);
      html.push('</tr></thead><tbody>');
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = tableRow(lines[i]).split('|').map((cell) => inline(cell.trim()));
        html.push('<tr>');
        for (const cell of cells) html.push(`<td>${cell}</td>`);
        html.push('</tr>');
        i += 1;
      }
      html.push('</tbody></table>');
      continue;
    }

    const unordered = /^-\s+(.*)$/.exec(line);
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (unordered || ordered) {
      const kind = unordered ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        list = kind;
        html.push(`<${kind}>`);
      }
      html.push(`<li>${inline((unordered ?? ordered)[1])}</li>`);
      i += 1;
      continue;
    }

    // Paragraph: gather until blank line / next construct.
    closeList();
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,4}\s|-\s|\d+\.\s|\||---\s|<)/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    html.push(`<p>${inline(paragraph.join(' ').trim())}</p>`);
  }
  closeList();
  return html.join('\n');
}

/** The leading draft banner blockquote is stripped: the layout renders the same banner under the flag (L1). */
export function stripBanner(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  if (lines[0] && /^>\s*\*?\*?DRAFT/.test(lines[0])) {
    let i = 0;
    while (i < lines.length && lines[i].startsWith('>')) i += 1;
    while (i < lines.length && lines[i].trim() === '') i += 1;
    return lines.slice(i).join('\n');
  }
  return markdown;
}
