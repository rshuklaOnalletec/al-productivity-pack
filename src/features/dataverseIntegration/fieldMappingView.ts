import * as vscode from 'vscode';

export interface FieldPairing {
    bcFieldName: string;
    dataverseFieldName: string;
    direction: 'Bidirectional' | 'FromBC' | 'FromDV';
}

export async function showFieldMappingWebview(
    availableBCFields: string[],
    availableDVFields: string[]
): Promise<FieldPairing[]> {
    // Pre-compute auto-matched pairs based on name similarity
    const autoMatches = computeAutoMatches(availableBCFields, availableDVFields);

    return new Promise((resolve) => {
        const panel = vscode.window.createWebviewPanel(
            'fieldMapping',
            'Field Mapping',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        panel.webview.html = getWebviewContent(availableBCFields, availableDVFields, autoMatches);

        panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'save') {
                resolve(message.mappings || []);
                panel.dispose();
            } else if (message.command === 'cancel') {
                resolve([]);
                panel.dispose();
            }
        });

        panel.onDidDispose(() => {
            resolve([]);
        });
    });
}

/**
 * Smart auto-matching: compare normalized field names.
 */
function computeAutoMatches(bcFields: string[], dvFields: string[]): FieldPairing[] {
    const matches: FieldPairing[] = [];
    const usedDv = new Set<string>();

    const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const bc of bcFields) {
        const bcNorm = normalize(bc);
        // Exact normalized match
        let match = dvFields.find(dv => !usedDv.has(dv) && normalize(dv) === bcNorm);
        // Contains match (bc contains dv or dv contains bc)
        if (!match) {
            match = dvFields.find(dv => !usedDv.has(dv) && (
                normalize(dv).includes(bcNorm) || bcNorm.includes(normalize(dv))
            ) && normalize(dv).length > 2 && bcNorm.length > 2);
        }
        if (match) {
            matches.push({ bcFieldName: bc, dataverseFieldName: match, direction: 'Bidirectional' });
            usedDv.add(match);
        }
    }
    return matches;
}

function getWebviewContent(bcFields: string[], dvFields: string[], autoMatches: FieldPairing[]): string {
    const autoMatchMap: Record<string, string> = {};
    for (const m of autoMatches) {
        autoMatchMap[m.bcFieldName] = m.dataverseFieldName;
    }

    const rowsHtml = bcFields.map(bc => {
        const matched = autoMatchMap[bc] || '';
        return `
            <tr class="mapping-row" data-bc="${bc}">
                <td class="field-name">${bc}</td>
                <td class="direction-cell">
                    <select class="direction-select" data-bc="${bc}">
                        <option value="Bidirectional" selected>↔ Bi</option>
                        <option value="FromBC">→ To DV</option>
                        <option value="FromDV">← From DV</option>
                    </select>
                </td>
                <td>
                    <select class="dv-select" data-bc="${bc}">
                        <option value="">— Not mapped —</option>
                        ${dvFields.map(f => `<option value="${f}" ${f === matched ? 'selected' : ''}>${f}</option>`).join('')}
                    </select>
                </td>
                <td class="status-cell">${matched ? '✓' : ''}</td>
            </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Field Mapping</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); margin: 0; }
        h1 { font-size: 1.3em; margin: 0 0 4px 0; }
        .subtitle { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-bottom: 16px; }
        .stats { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-editorWidget-border); padding: 10px 14px; border-radius: 4px; margin-bottom: 16px; font-size: 0.85em; display: flex; gap: 20px; }
        .stats .stat { display: flex; align-items: center; gap: 6px; }
        .stats .dot { width: 8px; height: 8px; border-radius: 50%; }
        .dot-matched { background: #4caf50; }
        .dot-unmatched { background: var(--vscode-descriptionForeground); }
        table { width: 100%; border-collapse: collapse; }
        thead th { text-align: left; padding: 8px 10px; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.5px; color: var(--vscode-descriptionForeground); border-bottom: 2px solid var(--vscode-editorWidget-border); }
        tbody tr { border-bottom: 1px solid var(--vscode-editorWidget-border); }
        tbody tr:hover { background: var(--vscode-list-hoverBackground); }
        td { padding: 6px 10px; vertical-align: middle; }
        .field-name { font-weight: 500; white-space: nowrap; }
        select { padding: 5px 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; font-size: 0.9em; }
        .dv-select { width: 100%; min-width: 200px; }
        .direction-select { width: 80px; }
        .direction-cell { width: 90px; }
        .status-cell { width: 30px; text-align: center; font-size: 1.1em; color: #4caf50; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .toolbar-actions { display: flex; gap: 8px; }
        .search-box { padding: 6px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 3px; width: 220px; font-size: 0.85em; }
        .buttons { margin-top: 20px; display: flex; gap: 12px; justify-content: flex-end; position: sticky; bottom: 0; background: var(--vscode-editor-background); padding: 12px 0; border-top: 1px solid var(--vscode-editorWidget-border); }
        button { padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9em; }
        .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
        .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
        .btn-link { background: none; color: var(--vscode-textLink-foreground); padding: 4px 8px; font-size: 0.8em; }
    </style>
</head>
<body>
    <h1>Field Mapping</h1>
    <p class="subtitle">Map Business Central fields to Dataverse columns. Auto-matched fields are pre-selected.</p>

    <div class="stats" id="stats"></div>

    <div class="toolbar">
        <input type="text" class="search-box" id="search" placeholder="Filter fields..." oninput="filterRows()" />
        <div class="toolbar-actions">
            <button class="btn-link" onclick="clearAll()">Clear All</button>
            <button class="btn-link" onclick="autoMatch()">Auto-Match</button>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>BC Field</th>
                <th>Direction</th>
                <th>Dataverse Column</th>
                <th></th>
            </tr>
        </thead>
        <tbody id="mappingBody">
            ${rowsHtml}
        </tbody>
    </table>

    <div class="buttons">
        <button class="btn-secondary" onclick="cancel()">Cancel</button>
        <button class="btn-primary" onclick="save()">Save Mappings</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const dvFields = ${JSON.stringify(dvFields)};

        updateStats();

        // Listen for DV select changes to update status
        document.querySelectorAll('.dv-select').forEach(sel => {
            sel.addEventListener('change', () => {
                const row = sel.closest('tr');
                const statusCell = row.querySelector('.status-cell');
                statusCell.textContent = sel.value ? '✓' : '';
                updateStats();
            });
        });

        function updateStats() {
            const total = document.querySelectorAll('.dv-select').length;
            const mapped = document.querySelectorAll('.dv-select').length > 0
                ? Array.from(document.querySelectorAll('.dv-select')).filter(s => s.value).length
                : 0;
            document.getElementById('stats').innerHTML =
                '<div class="stat"><span class="dot dot-matched"></span> ' + mapped + ' mapped</div>' +
                '<div class="stat"><span class="dot dot-unmatched"></span> ' + (total - mapped) + ' unmapped</div>' +
                '<div class="stat">Total: ' + total + ' BC fields, ' + dvFields.length + ' DV columns</div>';
        }

        function filterRows() {
            const query = document.getElementById('search').value.toLowerCase();
            document.querySelectorAll('.mapping-row').forEach(row => {
                const bc = row.dataset.bc.toLowerCase();
                const dvSel = row.querySelector('.dv-select');
                const dv = dvSel.value.toLowerCase();
                row.style.display = (bc.includes(query) || dv.includes(query)) ? '' : 'none';
            });
        }

        function clearAll() {
            document.querySelectorAll('.dv-select').forEach(sel => { sel.value = ''; });
            document.querySelectorAll('.status-cell').forEach(cell => { cell.textContent = ''; });
            updateStats();
        }

        function autoMatch() {
            const normalize = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');
            const used = new Set();
            document.querySelectorAll('.mapping-row').forEach(row => {
                const bc = row.dataset.bc;
                const bcNorm = normalize(bc);
                const sel = row.querySelector('.dv-select');
                let match = dvFields.find(dv => !used.has(dv) && normalize(dv) === bcNorm);
                if (!match) {
                    match = dvFields.find(dv => !used.has(dv) &&
                        (normalize(dv).includes(bcNorm) || bcNorm.includes(normalize(dv))) &&
                        normalize(dv).length > 2 && bcNorm.length > 2);
                }
                if (match) {
                    sel.value = match;
                    used.add(match);
                    row.querySelector('.status-cell').textContent = '✓';
                }
            });
            updateStats();
        }

        function save() {
            const mappings = [];
            document.querySelectorAll('.mapping-row').forEach(row => {
                const bc = row.dataset.bc;
                const dvSel = row.querySelector('.dv-select');
                const dirSel = row.querySelector('.direction-select');
                if (dvSel.value) {
                    mappings.push({
                        bcFieldName: bc,
                        dataverseFieldName: dvSel.value,
                        direction: dirSel.value
                    });
                }
            });
            vscode.postMessage({ command: 'save', mappings });
        }

        function cancel() {
            vscode.postMessage({ command: 'cancel' });
        }
    </script>
</body>
</html>`;
}
