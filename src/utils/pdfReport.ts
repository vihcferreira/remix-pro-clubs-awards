import type { PlayerProfile, VoteRecord, VotingQuestion } from '../data/awardsData.ts';

export interface ReportDashboardData {
  questions: VotingQuestion[];
  players?: PlayerProfile[];
  votes: VoteRecord[];
  activeSessionsCount: number;
  tallies: Record<
    string,
    {
      totalVotes: number;
      byCandidate: Record<string, { total: number; squadVotes: number; publicVotes: number }>;
      textResponses: Array<{
        voterProfile: string;
        token: string;
        text: string;
        submittedAt: string;
      }>;
    }
  >;
}

const PAGE_WIDTH = 595.28; // A4 width in pt
const PAGE_HEIGHT = 841.89; // A4 height in pt
const MARGIN_X = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const BOTTOM_LIMIT = 58;

/**
 * Converts a UTF-8 string into a PDF literal string (...) using WinAnsiEncoding (Windows-1252 / Latin-1)
 * with octal escapes for non-ASCII characters so Portuguese accents render natively in Helvetica.
 */
export function toPdfString(input: string): string {
  const normalized = (input || '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '*');

  let out = '(';
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code === 0x28) {
      out += '\\(';
    } else if (code === 0x29) {
      out += '\\)';
    } else if (code === 0x5c) {
      out += '\\\\';
    } else if (code >= 0x20 && code <= 0x7e) {
      out += normalized[i];
    } else if (code >= 0xa0 && code <= 0xff) {
      out += '\\' + code.toString(8).padStart(3, '0');
    } else {
      out += ' ';
    }
  }
  out += ')';
  return out;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const clean = (text || '').replace(/\r?\n/g, ' ').trim();
  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function formatRgb(r: number, g: number, b: number): string {
  return `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)}`;
}

/**
 * Generates a complete, multi-page A4 PDF binary (Uint8Array) with the Pro Clubs Awards voting results.
 */
export function buildVotingPdfBytes(
  data: ReportDashboardData,
  players: PlayerProfile[],
  generatedAt: Date = new Date()
): Uint8Array {
  const pages: string[][] = [];
  let currentOps: string[] = [];
  let y = PAGE_HEIGHT - 40;

  const startNewPage = () => {
    if (currentOps.length > 0) {
      pages.push(currentOps);
    }
    currentOps = [];
    y = PAGE_HEIGHT - 42;
  };

  const ensureSpace = (neededHeight: number) => {
    if (y - neededHeight < BOTTOM_LIMIT) {
      startNewPage();
    }
  };

  const drawRect = (
    x: number,
    topY: number,
    w: number,
    h: number,
    fillRgb: [number, number, number],
    strokeRgb?: [number, number, number]
  ) => {
    const bottomY = topY - h;
    currentOps.push('q');
    currentOps.push(`${formatRgb(...fillRgb)} rg`);
    if (strokeRgb) {
      currentOps.push(`${formatRgb(...strokeRgb)} RG`);
      currentOps.push('0.75 w');
      currentOps.push(`${x.toFixed(2)} ${bottomY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re B`);
    } else {
      currentOps.push(`${x.toFixed(2)} ${bottomY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }
    currentOps.push('Q');
  };

  const drawText = (
    text: string,
    x: number,
    baselineY: number,
    fontSize: number,
    bold: boolean = false,
    colorRgb: [number, number, number] = [15, 23, 42]
  ) => {
    const fontKey = bold ? '/F2' : '/F1';
    currentOps.push('BT');
    currentOps.push(`${formatRgb(...colorRgb)} rg`);
    currentOps.push(`${fontKey} ${fontSize} Tf`);
    currentOps.push(`1 0 0 1 ${x.toFixed(2)} ${baselineY.toFixed(2)} Tm`);
    currentOps.push(`${toPdfString(text)} Tj`);
    currentOps.push('ET');
  };

  const totalVotesCount = data.votes.length;
  const squadVotesCount = data.votes.filter((v) => v.voterProfile !== 'Outro').length;
  const publicVotesCount = data.votes.filter((v) => v.voterProfile === 'Outro').length;
  const votableQuestions = data.questions.filter((q) => q.type !== 'stat_info');
  const dateStr = generatedAt.toLocaleString('pt-BR');

  // ==========================================================================
  // HEADER BANNER (PAGE 1)
  // ==========================================================================
  drawRect(MARGIN_X, y, CONTENT_WIDTH, 76, [15, 21, 33]);
  drawRect(MARGIN_X, y, 5, 76, [245, 158, 11]); // Gold left bar

  drawText('PRO CLUBS AWARDS', MARGIN_X + 18, y - 24, 18, true, [245, 158, 11]);
  drawText(
    'Relatório Oficial de Apuração e Auditoria de Votos',
    MARGIN_X + 18,
    y - 43,
    11,
    true,
    [255, 255, 255]
  );
  drawText(
    `Emitido em: ${dateStr}  ·  Integrantes no Elenco: ${players.length}`,
    MARGIN_X + 18,
    y - 60,
    8.5,
    false,
    [148, 163, 184]
  );

  y -= 88;

  // ==========================================================================
  // SUMMARY METRIC BOXES
  // ==========================================================================
  const boxGap = 10;
  const boxWidth = (CONTENT_WIDTH - boxGap * 3) / 4;
  const metrics = [
    { label: 'TOTAL DE VOTOS', value: String(totalVotesCount) },
    { label: 'VOTOS DO ELENCO', value: String(squadVotesCount) },
    { label: 'VOTOS DO PÚBLICO', value: String(publicVotesCount) },
    { label: 'CATEGORIAS', value: String(votableQuestions.length) },
  ];

  metrics.forEach((m, idx) => {
    const bx = MARGIN_X + idx * (boxWidth + boxGap);
    drawRect(bx, y, boxWidth, 46, [248, 250, 252], [226, 232, 240]);
    drawText(m.label, bx + 10, y - 16, 7.5, true, [100, 116, 139]);
    drawText(m.value, bx + 10, y - 35, 15, true, [15, 23, 42]);
  });

  y -= 62;

  // ==========================================================================
  // SECTION 1: RESULTS BY CATEGORY
  // ==========================================================================
  drawText('1. APURAÇÃO POR CATEGORIA', MARGIN_X, y, 12, true, [15, 23, 42]);
  y -= 14;

  for (let qIdx = 0; qIdx < votableQuestions.length; qIdx++) {
    const q = votableQuestions[qIdx];
    const tally = data.tallies[q.id];
    const totalCatVotes = tally?.totalVotes || 0;

    if (q.type === 'choice') {
      const rankedPlayers = [...players].sort((a, b) => {
        const countA = tally?.byCandidate[a.id]?.total || 0;
        const countB = tally?.byCandidate[b.id]?.total || 0;
        return countB - countA;
      });

      const headerHeight = 36;
      const rowHeight = 20;
      const blockHeight = headerHeight + rankedPlayers.length * rowHeight + 14;
      ensureSpace(Math.min(blockHeight, 140));

      // Category Title Bar
      drawRect(MARGIN_X, y, CONTENT_WIDTH, headerHeight, [21, 28, 40]);
      const scopeLabel = q.publicVisible ? 'Aberta ao Público + Elenco' : 'Exclusivo Elenco';
      drawText(
        `${String(qIdx + 1).padStart(2, '0')}. ${q.title}`,
        MARGIN_X + 12,
        y - 15,
        10.5,
        true,
        [255, 255, 255]
      );
      drawText(
        `${q.subtitle || 'Sem descrição'}  ·  ${scopeLabel}`,
        MARGIN_X + 12,
        y - 28,
        8,
        false,
        [148, 163, 184]
      );
      drawText(
        `Total: ${totalCatVotes} ${totalCatVotes === 1 ? 'voto' : 'votos'}`,
        MARGIN_X + CONTENT_WIDTH - 95,
        y - 21,
        9,
        true,
        [245, 158, 11]
      );

      y -= headerHeight;

      rankedPlayers.forEach((player, pIdx) => {
        ensureSpace(rowHeight + 6);
        const stats = tally?.byCandidate[player.id] || {
          total: 0,
          squadVotes: 0,
          publicVotes: 0,
        };
        const pct = totalCatVotes > 0 ? Math.round((stats.total / totalCatVotes) * 100) : 0;
        const isLeader = pIdx === 0 && stats.total > 0;

        const rowBg: [number, number, number] = isLeader
          ? [254, 243, 199]
          : pIdx % 2 === 0
            ? [255, 255, 255]
            : [248, 250, 252];
        const rowBorder: [number, number, number] = isLeader
          ? [245, 158, 11]
          : [226, 232, 240];

        drawRect(MARGIN_X, y, CONTENT_WIDTH, rowHeight, rowBg, rowBorder);

        // Rank & Player Name
        drawText(
          `${pIdx + 1}º`,
          MARGIN_X + 10,
          y - 13,
          8.5,
          true,
          isLeader ? [180, 83, 9] : [100, 116, 139]
        );
        const leaderTag = isLeader ? ' [VENCEDOR / LÍDER]' : '';
        drawText(
          `${player.name} (${player.gamertag})${leaderTag}`,
          MARGIN_X + 32,
          y - 13,
          8.5,
          isLeader,
          [15, 23, 42]
        );

        // Progress Bar
        const barX = MARGIN_X + 225;
        const barW = 105;
        drawRect(barX, y - 6, barW, 7, [226, 232, 240]);
        if (pct > 0) {
          const fillW = Math.max(3, (barW * pct) / 100);
          drawRect(
            barX,
            y - 6,
            fillW,
            7,
            isLeader ? [217, 119, 6] : [100, 116, 139]
          );
        }

        // Breakdown & Total
        drawText(
          `${stats.squadVotes} elenco · ${stats.publicVotes} público`,
          MARGIN_X + 340,
          y - 13,
          7.5,
          false,
          [71, 85, 105]
        );
        drawText(
          `${stats.total} (${pct}%)`,
          MARGIN_X + CONTENT_WIDTH - 65,
          y - 13,
          8.5,
          true,
          isLeader ? [180, 83, 9] : [15, 23, 42]
        );

        y -= rowHeight;
      });

      y -= 14;
    } else if (q.type === 'text') {
      ensureSpace(64);
      drawRect(MARGIN_X, y, CONTENT_WIDTH, 34, [21, 28, 40]);
      drawText(
        `${String(qIdx + 1).padStart(2, '0')}. ${q.title}`,
        MARGIN_X + 12,
        y - 14,
        10.5,
        true,
        [255, 255, 255]
      );
      drawText(
        `${q.subtitle || 'Respostas abertas'}`,
        MARGIN_X + 12,
        y - 26,
        7.5,
        false,
        [148, 163, 184]
      );
      drawText(
        `${totalCatVotes} relatos`,
        MARGIN_X + CONTENT_WIDTH - 75,
        y - 20,
        9,
        true,
        [245, 158, 11]
      );
      y -= 34;

      const responses = tally?.textResponses || [];
      if (responses.length === 0) {
        drawRect(MARGIN_X, y, CONTENT_WIDTH, 22, [248, 250, 252], [226, 232, 240]);
        drawText(
          'Nenhuma resposta escrita registrada nesta categoria.',
          MARGIN_X + 12,
          y - 14,
          8,
          false,
          [100, 116, 139]
        );
        y -= 34;
      } else {
        for (const item of responses) {
          const wrapped = wrapText(`"${item.text}"`, 88);
          const cardH = 22 + wrapped.length * 11;
          ensureSpace(cardH + 6);
          drawRect(MARGIN_X, y, CONTENT_WIDTH, cardH, [255, 255, 255], [226, 232, 240]);

          wrapped.forEach((line, lIdx) => {
            drawText(line, MARGIN_X + 12, y - 13 - lIdx * 11, 8.5, false, [15, 23, 42]);
          });
          drawText(
            `Enviado por: ${item.voterProfile}  ·  Token: ${item.token}`,
            MARGIN_X + 12,
            y - cardH + 6,
            7.5,
            true,
            [100, 116, 139]
          );
          y -= cardH;
        }
        y -= 14;
      }
    }
  }

  // ==========================================================================
  // SECTION 2: VOTERS & TOKENS AUDIT LOG
  // ==========================================================================
  ensureSpace(70);
  y -= 6;
  drawText(
    `2. AUDITORIA DE VOTOS E TOKENS VALIDADOS (${data.votes.length})`,
    MARGIN_X,
    y,
    11.5,
    true,
    [15, 23, 42]
  );
  y -= 12;

  if (data.votes.length === 0) {
    drawRect(MARGIN_X, y, CONTENT_WIDTH, 24, [248, 250, 252], [226, 232, 240]);
    drawText(
      'Nenhum voto foi registrado até o momento da emissão deste relatório.',
      MARGIN_X + 12,
      y - 15,
      8.5,
      false,
      [100, 116, 139]
    );
    y -= 24;
  } else {
    // Table Header
    drawRect(MARGIN_X, y, CONTENT_WIDTH, 20, [21, 28, 40]);
    drawText('PERFIL', MARGIN_X + 10, y - 13, 8, true, [255, 255, 255]);
    drawText('TOKEN ÚNICO', MARGIN_X + 140, y - 13, 8, true, [255, 255, 255]);
    drawText('IP HASH', MARGIN_X + 265, y - 13, 8, true, [255, 255, 255]);
    drawText('DATA / HORA', MARGIN_X + 385, y - 13, 8, true, [255, 255, 255]);
    y -= 20;

    data.votes.forEach((v, idx) => {
      ensureSpace(20);
      const bg: [number, number, number] = idx % 2 === 0 ? [255, 255, 255] : [248, 250, 252];
      drawRect(MARGIN_X, y, CONTENT_WIDTH, 18, bg, [226, 232, 240]);
      drawText(v.voterProfile, MARGIN_X + 10, y - 12, 8, true, [15, 23, 42]);
      drawText(v.token, MARGIN_X + 140, y - 12, 8, false, [180, 83, 9]);
      drawText(v.ipHash, MARGIN_X + 265, y - 12, 8, false, [71, 85, 105]);
      drawText(
        new Date(v.submittedAt).toLocaleString('pt-BR'),
        MARGIN_X + 385,
        y - 12,
        7.5,
        false,
        [71, 85, 105]
      );
      y -= 18;
    });
  }

  if (currentOps.length > 0) {
    pages.push(currentOps);
  }

  // Add footer with page numbers on every page
  const totalPages = pages.length;
  pages.forEach((ops, pageIdx) => {
    const footerText = `Pro Clubs Awards — Relatório Oficial de Votação  |  Página ${pageIdx + 1} de ${totalPages}`;
    ops.push('BT');
    ops.push(`${formatRgb(100, 116, 139)} rg`);
    ops.push('/F1 8 Tf');
    ops.push(`1 0 0 1 ${MARGIN_X.toFixed(2)} 26.00 Tm`);
    ops.push(`${toPdfString(footerText)} Tj`);
    ops.push('ET');
  });

  // ==========================================================================
  // ASSEMBLE PDF 1.4 OBJECTS
  // ==========================================================================
  const objects: string[] = [];
  // Obj 1: Catalog
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
  // Obj 2: Pages placeholder (filled after page objects are created)
  objects.push('');
  // Obj 3: Helvetica Font
  objects.push(
    '3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj'
  );
  // Obj 4: Helvetica-Bold Font
  objects.push(
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj'
  );

  const pageObjIds: number[] = [];
  for (const ops of pages) {
    const streamContent = ops.join('\n');
    const contentObjId = objects.length + 1;
    objects.push(
      `${contentObjId} 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`
    );

    const pageObjId = objects.length + 1;
    pageObjIds.push(pageObjId);
    objects.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>\nendobj`
    );
  }

  const kidsRef = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  objects[1] = `2 0 obj\n<< /Type /Pages /Kids [${kidsRef}] /Count ${pageObjIds.length} >>\nendobj`;

  let pdfText = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (const obj of objects) {
    offsets.push(pdfText.length);
    pdfText += obj + '\n';
  }

  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n`;
  pdfText += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdfText += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }

  pdfText += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdfText.length);
  for (let i = 0; i < pdfText.length; i++) {
    bytes[i] = pdfText.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/**
 * Triggers a direct browser download of the generated PDF voting report.
 */
export function downloadVotingPdfReport(
  data: ReportDashboardData,
  players: PlayerProfile[]
): void {
  const pdfBytes = buildVotingPdfBytes(data, players);
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const dateStamp = new Date().toISOString().slice(0, 10);

  const link = document.createElement('a');
  link.href = url;
  link.download = `relatorio-pro-clubs-awards-${dateStamp}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 3000);
}
